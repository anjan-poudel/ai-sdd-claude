/**
 * Output sanitizer — secret detection in task outputs (blocking).
 * If a secret is detected, the task must go to NEEDS_REWORK.
 * Secrets are never silently redacted from task output — the agent must fix them.
 */

import { detectSecrets } from "./patterns.ts";

export interface OutputSanitizationResult {
  safe: boolean;
  secrets_found: Array<{
    pattern_id: string;
    pattern_name: string;
    description: string;
  }>;
}

export class OutputSanitizer {
  /**
   * Scan task output for secrets.
   * If any secrets are found, returns safe=false.
   * The task must be sent to NEEDS_REWORK — no file write occurs.
   * Performance target: < 100ms p95 for outputs < 1MB.
   */
  sanitize(content: string): OutputSanitizationResult {
    const matches = detectSecrets(content);

    if (matches.length === 0) {
      return { safe: true, secrets_found: [] };
    }

    return {
      safe: false,
      secrets_found: matches.map((m) => ({
        pattern_id: m.id,
        pattern_name: m.name,
        description: m.description,
      })),
    };
  }
}
