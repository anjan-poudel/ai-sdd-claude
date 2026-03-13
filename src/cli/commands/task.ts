/**
 * ai-sdd task — task management utilities.
 *
 * Commands:
 *   task reset <id>         — reset a FAILED/terminal task back to PENDING for rerun
 *   task replay-hooks <id>  — re-fire collaboration hooks (Confluence/Jira) for a repaired task
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { StateManager } from "../../core/state-manager.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import type { TaskStatus } from "../../types/index.ts";
import { resolveSession } from "../../core/session-resolver.ts";

export function registerTaskCommand(program: Command): void {
  const task = program
    .command("task")
    .description("Task management utilities")
    .option("--feature <name>", "Feature/session name");

  // task reset <id>
  // Resets a FAILED or otherwise-stuck task back to PENDING so the next
  // `ai-sdd run` will re-execute it. This bypasses VALID_TRANSITIONS by
  // writing the state file directly — it is intentionally an escape hatch
  // for manual recovery (ISSUE-010).
  task
    .command("reset <id>")
    .description("Reset a FAILED/stuck task to PENDING (manual recovery)")
    .option("--project <path>", "Project directory", process.cwd())
    .option("--to <status>", "Target status (default: PENDING)", "PENDING")
    .action((id: string, options) => {
      const projectPath = resolve(options.project as string);
      const featureName = task.opts().feature as string | undefined;
      const targetStatus = (options.to as string).toUpperCase();

      const allowed = ["PENDING", "RUNNING", "NEEDS_REWORK"];
      if (!allowed.includes(targetStatus)) {
        console.error(`--to must be one of: ${allowed.join(", ")}`);
        process.exit(1);
      }

      const session = resolveSession({ projectPath, featureName });

      let workflowName = "workflow";
      if (session.workflowPath && existsSync(session.workflowPath)) {
        try {
          const wf = WorkflowLoader.loadFile(session.workflowPath);
          workflowName = wf.config.name;
        } catch { /* malformed yaml — use default */ }
      }

      // Load raw state and patch directly to bypass VALID_TRANSITIONS.
      const stateManager = new StateManager(session.stateDir, workflowName, projectPath);
      try {
        stateManager.load();
      } catch {
        console.error("No workflow state found. Run: ai-sdd run");
        process.exit(1);
      }

      const state = stateManager.getState();
      const taskState = state.tasks[id];
      if (!taskState) {
        console.error(`Task '${id}' not found in workflow state.`);
        process.exit(1);
      }

      const prevStatus = taskState.status;

      // Directly mutate the state JSON (bypasses the state machine guard).
      const statePath = stateManager.statePath;
      if (!existsSync(statePath)) {
        console.error(`State file not found at: ${statePath}`);
        process.exit(1);
      }

      const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
      const tasks = raw["tasks"] as Record<string, Record<string, unknown>>;
      if (!tasks[id]) {
        console.error(`Task '${id}' not found in state file.`);
        process.exit(1);
      }

      tasks[id]["status"] = targetStatus as TaskStatus;
      tasks[id]["error"] = undefined;
      // Clear rework feedback so the agent gets a clean slate, unless resetting to NEEDS_REWORK.
      if (targetStatus !== "NEEDS_REWORK") {
        tasks[id]["rework_feedback"] = undefined;
      }
      raw["updated_at"] = new Date().toISOString();

      const tmp = `${statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(raw, null, 2), "utf-8");
      renameSync(tmp, statePath);

      console.log(`Task '${id}' reset: ${prevStatus} → ${targetStatus}`);
      console.log(`Run 'ai-sdd run' to execute it.`);
    });

  // task replay-hooks <id>
  // Re-fires collaboration post-task hooks (Confluence publish, Jira status sync)
  // for a task whose state was manually repaired by bypassing the engine (ISSUE-011).
  // Uses the stored collaboration_refs from async_state to target the correct external objects.
  task
    .command("replay-hooks <id>")
    .description("Re-fire post-task collaboration hooks (Confluence/Jira) for a manually repaired task")
    .option("--project <path>", "Project directory", process.cwd())
    .option("--dry-run", "Print what would be replayed without making external calls")
    .action(async (id: string, options) => {
      const projectPath = resolve(options.project as string);
      const featureName = task.opts().feature as string | undefined;
      const dryRun = options.dryRun as boolean;

      const session = resolveSession({ projectPath, featureName });

      let workflowName = "workflow";
      if (session.workflowPath && existsSync(session.workflowPath)) {
        try {
          const wf = WorkflowLoader.loadFile(session.workflowPath);
          workflowName = wf.config.name;
        } catch { /* malformed yaml — use default */ }
      }

      const stateManager = new StateManager(session.stateDir, workflowName, projectPath);
      try {
        stateManager.load();
      } catch {
        console.error("No workflow state found. Run: ai-sdd run");
        process.exit(1);
      }

      const state = stateManager.getState();
      const taskState = state.tasks[id];
      if (!taskState) {
        console.error(`Task '${id}' not found in workflow state.`);
        process.exit(1);
      }

      // Extract collaboration refs from async_state (if present).
      const asyncState = taskState.async_state as
        | { collaboration_refs?: { confluence_page_id?: string; jira_issue_key?: string } }
        | undefined;
      const refs = asyncState?.collaboration_refs ?? {};

      console.log(`Replaying hooks for task '${id}' (status: ${taskState.status})`);
      console.log(`  Collaboration refs: ${JSON.stringify(refs)}`);

      if (!refs.confluence_page_id && !refs.jira_issue_key) {
        console.log(`  No collaboration refs stored — nothing to replay.`);
        console.log(`  (Refs are set when the task runs with async collaboration adapters.)`);
        process.exit(0);
      }

      if (dryRun) {
        if (refs.confluence_page_id) {
          console.log(`  [dry-run] Would update Confluence page: ${refs.confluence_page_id}`);
        }
        if (refs.jira_issue_key) {
          console.log(`  [dry-run] Would sync Jira issue: ${refs.jira_issue_key} → DONE`);
        }
        process.exit(0);
      }

      // Re-fire Confluence page update if a page_id is stored.
      if (refs.confluence_page_id) {
        const confluenceToken = process.env["CONFLUENCE_API_TOKEN"];
        const confluenceEmail = process.env["CONFLUENCE_USER_EMAIL"];
        const confluenceBase = process.env["CONFLUENCE_BASE_URL"];

        if (!confluenceToken || !confluenceEmail || !confluenceBase) {
          console.warn(
            `  [confluence] Skipping — CONFLUENCE_API_TOKEN, CONFLUENCE_USER_EMAIL, ` +
            `or CONFLUENCE_BASE_URL not set.`,
          );
        } else {
          try {
            const { ConfluenceDocumentAdapter } = await import(
              "../../collaboration/impl/confluence-document-adapter.ts"
            ) as { ConfluenceDocumentAdapter: new (t: string, e: string, b: string) => import("../../collaboration/adapters/document-adapter.ts").DocumentAdapter };
            const adapter = new ConfluenceDocumentAdapter(confluenceToken, confluenceEmail, confluenceBase);
            const outputs = taskState.outputs ?? [];
            const content = outputs.map((o) => {
              if (o.path) {
                try { return readFileSync(resolve(projectPath, o.path), "utf-8"); } catch { return ""; }
              }
              return "";
            }).filter(Boolean).join("\n\n") || `Task '${id}' completed (status: ${taskState.status})`;

            // Reconstruct a minimal PageRef from the stored id.
            // url and version are unknown at recovery time so we pass zeroed values;
            // ConfluenceDocumentAdapter will re-fetch the page version before updating.
            const pageRef = { provider: "confluence", id: refs.confluence_page_id, url: "", version: 0 };
            const result = await adapter.updatePage(
              pageRef as import("../../collaboration/types.ts").PageRef,
              content,
            );
            if (result.ok) {
              console.log(`  [confluence] Updated page ${refs.confluence_page_id} ✓`);
            } else {
              console.warn(`  [confluence] Update failed: ${result.error.message}`);
            }
          } catch (err) {
            console.warn(`  [confluence] Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Re-fire Jira transition if an issue key is stored.
      if (refs.jira_issue_key) {
        const jiraToken = process.env["JIRA_API_TOKEN"];
        const jiraEmail = process.env["JIRA_USER_EMAIL"];
        const jiraBase = process.env["JIRA_BASE_URL"];

        if (!jiraToken || !jiraEmail || !jiraBase) {
          console.warn(
            `  [jira] Skipping — JIRA_API_TOKEN, JIRA_USER_EMAIL, or JIRA_BASE_URL not set.`,
          );
        } else {
          try {
            const { JiraTaskTrackingAdapter } = await import(
              "../../collaboration/impl/jira-task-tracking-adapter.ts"
            ) as { JiraTaskTrackingAdapter: new (t: string, e: string, b: string) => import("../../collaboration/adapters/task-tracking-adapter.ts").TaskTrackingAdapter };
            const adapter = new JiraTaskTrackingAdapter(jiraToken, jiraEmail, jiraBase);
            const targetStatus = taskState.status === "COMPLETED" ? "Done" : taskState.status;
            const issueRef = { provider: "jira", key: refs.jira_issue_key, id: refs.jira_issue_key, url: "" };
            const result = await adapter.transitionTask(
              issueRef as import("../../collaboration/types.ts").IssueRef,
              targetStatus,
            );
            if (result.ok) {
              console.log(`  [jira] Transitioned ${refs.jira_issue_key} → ${targetStatus} ✓`);
            } else {
              console.warn(`  [jira] Transition failed: ${result.error.message}`);
            }
          } catch (err) {
            console.warn(`  [jira] Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      console.log(`Done.`);
    });
}
