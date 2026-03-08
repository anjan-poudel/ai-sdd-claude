/**
 * Shared output validation — called from both the engine (direct-dispatch adapters)
 * and from complete-task (delegation-dispatch adapters).
 *
 * Enforces:
 *   1. Path allowlist: output paths must match declared task output paths
 *   2. No path traversal outside the project root
 *   3. Secret detection in file content (blocks COMPLETED, forces NEEDS_REWORK)
 *
 * This centralises the safety model so it is adapter-independent.
 */

import { normalize, isAbsolute, relative, resolve } from "path";
import { OutputSanitizer } from "./output-sanitizer.ts";
import type { TaskOutput } from "../types/index.ts";

export interface OutputValidationError {
  kind: "path_traversal" | "not_declared" | "secret_detected";
  message: string;
  /** For secret_detected: names of secrets found */
  secrets?: string[];
  /** For not_declared / path_traversal: the offending path */
  path?: string;
}

export interface OutputValidationResult {
  valid: boolean;
  errors: OutputValidationError[];
}

const sanitizer = new OutputSanitizer();

/**
 * Validate a list of adapter-produced outputs against the task's declared outputs.
 *
 * @param outputs   Outputs returned by the adapter (path + optional contract).
 * @param declared  Outputs declared in the task definition (the allowlist).
 * @param projectPath  Absolute path to the project root (for traversal checks).
 * @param contentMap  Optional map of path → file content for secret scanning.
 *                    When empty/absent, secret scanning is skipped (content was
 *                    already written and scanned elsewhere, e.g. complete-task).
 */
export function validateAdapterOutputs(
  outputs: TaskOutput[],
  declared: TaskOutput[],
  projectPath: string,
  contentMap: Map<string, string> = new Map(),
): OutputValidationResult {
  const errors: OutputValidationError[] = [];

  // When there are no declared outputs, skip path allowlist check.
  // Tasks with no declared outputs legitimately return outputs: [].
  const hasDeclared = declared.length > 0;

  for (const output of outputs) {
    // ── 1. Resolve and check for path traversal ─────────────────────────────
    const absPath = isAbsolute(output.path)
      ? normalize(output.path)
      : resolve(projectPath, output.path);

    const rel = relative(projectPath, absPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      errors.push({
        kind: "path_traversal",
        message: `Path traversal detected in adapter output: '${output.path}'`,
        path: output.path,
      });
      continue;
    }

    // ── 2. Check against declared outputs allowlist ──────────────────────────
    if (hasDeclared) {
      const normalizedRel = rel.replace(/\\/g, "/");
      const allowed = declared.some((d) => {
        // Normalize declared path the same way — handle absolute declared paths too
        const declaredAbs = isAbsolute(d.path) ? normalize(d.path) : resolve(projectPath, d.path);
        const declaredRel = relative(projectPath, declaredAbs).replace(/\\/g, "/");
        if (declaredRel.endsWith("/")) return normalizedRel.startsWith(declaredRel);
        return normalizedRel === declaredRel;
      });
      if (!allowed) {
        errors.push({
          kind: "not_declared",
          message:
            `Output path '${rel}' is not in the declared outputs for this task. ` +
            `Declared: ${declared.map((d) => d.path).join(", ")}`,
          path: output.path,
        });
        continue;
      }
    }

    // ── 3. Secret scanning (when content is provided) ────────────────────────
    const content = contentMap.get(output.path) ?? contentMap.get(rel);
    if (content !== undefined) {
      const check = sanitizer.sanitize(content);
      if (!check.safe) {
        const names = check.secrets_found.map((s) => s.pattern_name);
        errors.push({
          kind: "secret_detected",
          message:
            `Secret detected in adapter output '${rel}' (${names.join(", ")}). ` +
            `Task must be sent to NEEDS_REWORK.`,
          path: output.path,
          secrets: names,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
