/**
 * ai-sdd complete-task — atomic transaction boundary for task completion.
 *
 * Transaction steps:
 * 1. Validate output_path against project allowlist (path traversal check)
 * 2. Run security sanitization on content
 * 3. Validate artifact contract
 * 4. Write file to output_path (atomic write)
 * 5. Update workflow state: task → COMPLETED
 * 6. Update constitution manifest
 */

import type { Command } from "commander";
import { resolve, normalize, isAbsolute, relative } from "path";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
import { StateManager } from "../../core/state-manager.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import { createManifestWriter } from "../../constitution/manifest-writer.ts";
import { OutputSanitizer } from "../../security/output-sanitizer.ts";
import { InputSanitizer } from "../../security/input-sanitizer.ts";
import { ArtifactRegistry } from "../../artifacts/registry.ts";
import { ArtifactValidator } from "../../artifacts/validator.ts";
import { loadProjectConfig } from "../config-loader.ts";

export function registerCompleteTaskCommand(program: Command): void {
  program
    .command("complete-task")
    .description("Atomic task completion: validate → sanitize → write → update state")
    .requiredOption("--task <id>", "Task ID to complete")
    .requiredOption("--output-path <path>", "Declared output path (must be allowlisted)")
    .requiredOption("--content-file <tmp>", "Temp file holding artifact content")
    .option("--contract <name>", "Artifact contract to validate against")
    .option("--allow-legacy-untyped-artifacts", "Skip contract validation for untyped artifacts")
    .option("--project <path>", "Project directory", process.cwd())
    .action(async (options) => {
      const projectPath = resolve(options.project as string);
      const taskId = options.task as string;
      const outputPathRaw = options.outputPath as string;
      const contentFile = resolve(options.contentFile as string);
      const contractName = options.contract as string | undefined;
      const allowLegacy = Boolean(options.allowLegacyUntypedArtifacts);

      // ─── Step 1: Validate output path ────────────────────────────────────────
      if (!existsSync(contentFile)) {
        console.error(`Content file not found: ${contentFile}`);
        process.exit(1);
      }

      // Normalize and validate no path traversal
      const outputPath = isAbsolute(outputPathRaw)
        ? normalize(outputPathRaw)
        : resolve(projectPath, outputPathRaw);

      const rel = relative(projectPath, outputPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        console.error(`Path traversal detected in output-path: '${outputPathRaw}'`);
        process.exit(1);
      }

      // Validate output path is declared in the task definition
      const declaredOutputs = loadDeclaredOutputs(projectPath, taskId);
      if (declaredOutputs !== null && declaredOutputs.length > 0) {
        const normalizedRel = rel.replace(/\\/g, "/");
        const allowed = declaredOutputs.some((p) => {
          const normalizedDeclared = p.replace(/\\/g, "/");
          return normalizedRel === normalizedDeclared;
        });
        if (!allowed) {
          console.error(
            `Output path '${rel}' is not in the declared outputs for task '${taskId}'.\n` +
            `Declared: ${declaredOutputs.join(", ")}`,
          );
          process.exit(1);
        }
      }

      // ─── Step 2: Security sanitization ───────────────────────────────────────
      const content = readFileSync(contentFile, "utf-8");

      const outputSanitizer = new OutputSanitizer();
      const outputCheck = outputSanitizer.sanitize(content);
      if (!outputCheck.safe) {
        const names = outputCheck.secrets_found.map((s) => s.pattern_name).join(", ");
        console.error(
          `Secret detected in task output (${names}). ` +
          `Task set to NEEDS_REWORK. Remove secrets and resubmit.`,
        );
        // Mark task as NEEDS_REWORK
        const stateDir = resolve(projectPath, ".ai-sdd", "state");
        const stateManager = new StateManager(stateDir, "workflow", projectPath);
        stateManager.load();
        try {
          stateManager.transition(taskId, "NEEDS_REWORK", {
            rework_feedback: `Secret detected in output: ${names}`,
          });
        } catch {
          // Already in rework or other state — ignore
        }
        process.exit(1);
      }

      const config = loadProjectConfig(projectPath);
      const inputSanitizer = new InputSanitizer(
        config.security?.injection_detection_level ?? "warn",
      );
      const inputCheck = inputSanitizer.sanitize(content);
      if (!inputCheck.safe) {
        const names = inputCheck.violations.map((v) => v.pattern_name).join(", ");
        console.error(
          `Injection pattern detected in task output (${names}). ` +
          `Task set to NEEDS_REWORK. Remove injection patterns and resubmit.`,
        );
        // Mark task as NEEDS_REWORK (mirrors the secret detection branch above)
        const injectStateDir = resolve(projectPath, ".ai-sdd", "state");
        const injectStateManager = new StateManager(injectStateDir, "workflow", projectPath);
        injectStateManager.load();
        try {
          injectStateManager.transition(taskId, "NEEDS_REWORK", {
            rework_feedback: `Injection pattern detected in output: ${names}`,
          });
        } catch {
          // Already in rework or other state — ignore
        }
        process.exit(1);
      }

      // ─── Step 3: Artifact contract validation ─────────────────────────────────
      if (contractName) {
        const schemaPath = resolve(
          new URL("../../../data/artifacts/schema.yaml", import.meta.url).pathname,
        );
        if (existsSync(schemaPath)) {
          const registry = new ArtifactRegistry();
          registry.loadFile(schemaPath);
          const validator = new ArtifactValidator(registry);
          const validation = validator.validate(content, contractName, allowLegacy);

          if (!validation.valid) {
            console.error(
              `Artifact contract validation failed for '${contractName}':\n` +
              validation.errors.map((e) => `  - ${e}`).join("\n"),
            );
            process.exit(1);
          }

          if (validation.warnings.length > 0) {
            for (const w of validation.warnings) {
              console.warn(`  Warning: ${w}`);
            }
          }
        } else if (!allowLegacy) {
          console.error(`Artifact schema not found: ${schemaPath}`);
          process.exit(1);
        }
      }

      // ─── Step 4: Atomic write ─────────────────────────────────────────────────
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      const tmpPath = `${outputPath}.tmp`;
      writeFileSync(tmpPath, content, "utf-8");
      renameSync(tmpPath, outputPath);

      // ─── Step 5: Update workflow state ────────────────────────────────────────
      const stateDir = resolve(projectPath, ".ai-sdd", "state");
      const stateManager = new StateManager(stateDir, "workflow", projectPath);
      stateManager.load();
      stateManager.transition(taskId, "COMPLETED", {
        outputs: [{ path: rel, contract: contractName }],
      });

      // ─── Step 6: Update constitution manifest ─────────────────────────────────
      const manifestWriter = createManifestWriter(projectPath);
      manifestWriter.writeArtifactManifest(stateManager.getState());

      console.log(`Task '${taskId}' completed. Output written to: ${outputPath}`);
    });
}

/**
 * Load the declared output paths for a task from the workflow YAML.
 * Returns the list of declared paths, null if the workflow cannot be loaded,
 * or an empty array if the task has no declared outputs.
 */
function loadDeclaredOutputs(projectPath: string, taskId: string): string[] | null {
  const wfPaths = [
    resolve(projectPath, ".ai-sdd", "workflow.yaml"),
    resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml"),
  ];

  for (const wfPath of wfPaths) {
    if (!existsSync(wfPath)) continue;
    try {
      const workflow = WorkflowLoader.loadFile(wfPath);
      const task = workflow.tasks.get(taskId);
      if (!task) return null; // task not in workflow — skip validation
      return (task.outputs ?? []).map((o: { path: string }) => o.path);
    } catch {
      // Malformed YAML — skip validation gracefully
    }
  }

  return null; // no workflow found — skip validation
}
