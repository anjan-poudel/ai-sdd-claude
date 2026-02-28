/**
 * Input sanitizer — injection detection + quarantine for task inputs.
 */

import { detectInjection } from "./patterns.ts";
import type { InjectionDetectionLevel } from "../types/index.ts";

export interface SanitizationResult {
  safe: boolean;
  violations: Array<{
    pattern_id: string;
    pattern_name: string;
    severity: string;
  }>;
  action: "pass" | "warn" | "quarantine";
}

export class InputSanitizer {
  private level: InjectionDetectionLevel;

  constructor(level: InjectionDetectionLevel = "warn") {
    this.level = level;
  }

  /**
   * Scan input content for injection patterns.
   * Performance target: < 50ms p95 for inputs < 100KB.
   */
  sanitize(content: string): SanitizationResult {
    const matches = detectInjection(content);

    if (matches.length === 0) {
      return { safe: true, violations: [], action: "pass" };
    }

    const violations = matches.map((m) => ({
      pattern_id: m.id,
      pattern_name: m.name,
      severity: m.severity,
    }));

    switch (this.level) {
      case "pass":
        return { safe: true, violations, action: "pass" };
      case "warn":
        return { safe: true, violations, action: "warn" };
      case "quarantine":
        return { safe: false, violations, action: "quarantine" };
    }
  }

  setLevel(level: InjectionDetectionLevel): void {
    this.level = level;
  }
}
