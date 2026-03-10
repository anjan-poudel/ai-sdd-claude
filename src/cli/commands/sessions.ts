/**
 * ai-sdd sessions — manage workflow sessions.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { StateManager } from "../../core/state-manager.ts";
import {
  getActiveSession,
  setActiveSession,
  listSessions,
  ensureSessionDirs,
} from "../../core/session-resolver.ts";
import { join } from "path";

export function registerSessionsCommand(program: Command): void {
  const sessions = program
    .command("sessions")
    .description("Manage workflow sessions");

  // sessions list
  sessions
    .command("list")
    .description("List all sessions")
    .option("--json", "Output as JSON")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const names = listSessions(projectPath);
      const active = getActiveSession(projectPath);

      if (options.json) {
        const entries = names.map((name) => {
          const sessionDir = join(projectPath, ".ai-sdd", "sessions", name);
          const stateFile = join(sessionDir, "workflow-state.json");
          let taskCount = 0;
          if (existsSync(stateFile)) {
            try {
              const sm = new StateManager(sessionDir, "workflow", projectPath);
              sm.load();
              taskCount = Object.keys(sm.getState().tasks).length;
            } catch { /* ignore */ }
          }
          return { name, active: name === active, tasks: taskCount };
        });
        console.log(JSON.stringify({ sessions: entries }, null, 2));
        return;
      }

      if (names.length === 0) {
        console.log("No sessions found. Run: ai-sdd sessions create <name>");
        return;
      }

      console.log("\nSessions:\n");
      for (const name of names) {
        const marker = name === active ? " (active)" : "";
        const sessionDir = join(projectPath, ".ai-sdd", "sessions", name);
        const stateFile = join(sessionDir, "workflow-state.json");
        let taskInfo = "";
        if (existsSync(stateFile)) {
          try {
            const sm = new StateManager(sessionDir, "workflow", projectPath);
            sm.load();
            const state = sm.getState();
            const total = Object.keys(state.tasks).length;
            const completed = Object.values(state.tasks).filter(
              (t) => t.status === "COMPLETED",
            ).length;
            taskInfo = ` — ${completed}/${total} tasks completed`;
          } catch { /* ignore */ }
        }
        console.log(`  ${name}${marker}${taskInfo}`);
      }
      console.log();
    });

  // sessions active
  sessions
    .command("active")
    .description("Show the active session name")
    .option("--json", "Output as JSON")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const active = getActiveSession(projectPath);

      if (options.json) {
        console.log(JSON.stringify({ active_session: active }));
        return;
      }

      console.log(active);
    });

  // sessions switch <name>
  sessions
    .command("switch <name>")
    .description("Switch to a different session")
    .option("--project <path>", "Project directory", process.cwd())
    .action((name: string, options) => {
      const projectPath = resolve(options.project as string);
      const sessionDir = join(projectPath, ".ai-sdd", "sessions", name);

      if (!existsSync(sessionDir)) {
        console.log(`Session '${name}' does not exist. Creating it now...`);
        ensureSessionDirs(sessionDir);
      }

      setActiveSession(projectPath, name);
      console.log(`Switched to session: ${name}`);
    });

  // sessions create <name>
  sessions
    .command("create <name>")
    .description("Create a new session")
    .option("--project <path>", "Project directory", process.cwd())
    .action((name: string, options) => {
      const projectPath = resolve(options.project as string);
      const sessionDir = join(projectPath, ".ai-sdd", "sessions", name);

      if (existsSync(sessionDir)) {
        console.log(`Session '${name}' already exists.`);
        return;
      }

      ensureSessionDirs(sessionDir);
      console.log(`Session '${name}' created.`);
    });
}
