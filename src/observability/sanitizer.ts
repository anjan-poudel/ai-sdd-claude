/**
 * Log sanitizer — replaces secrets with [REDACTED:TYPE] in log/event strings.
 * Non-blocking: sanitization runs synchronously but does NOT throw on failure.
 * Applies to observability/logging only — NOT to task outputs.
 */

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

// Default secret patterns
const DEFAULT_PATTERNS: SecretPattern[] = [
  { name: "AWS_KEY", pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED:AWS_KEY]" },
  { name: "AWS_SECRET", pattern: /(?<=['">\s])[A-Za-z0-9/+=]{40}(?=['"<\s])/g, replacement: "[REDACTED:AWS_SECRET]" },
  { name: "GITHUB_TOKEN", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: "[REDACTED:GITHUB_TOKEN]" },
  { name: "ANTHROPIC_KEY", pattern: /sk-ant-[a-zA-Z0-9\-_]{93}/g, replacement: "[REDACTED:ANTHROPIC_KEY]" },
  { name: "OPENAI_KEY", pattern: /sk-[a-zA-Z0-9]{48}/g, replacement: "[REDACTED:OPENAI_KEY]" },
  { name: "BEARER_TOKEN", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED:TOKEN]" },
  { name: "PRIVATE_KEY", pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: "[REDACTED:PRIVATE_KEY]" },
  { name: "JWT", pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, replacement: "[REDACTED:JWT]" },
  { name: "PASSWORD_FIELD", pattern: /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, replacement: "[REDACTED:PASSWORD_FIELD]" },
  { name: "CONNECTION_STRING", pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+/gi, replacement: "[REDACTED:CONNECTION_STRING]" },
];

export class LogSanitizer {
  private patterns: SecretPattern[];

  constructor(additionalPatterns?: SecretPattern[]) {
    this.patterns = [...DEFAULT_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /**
   * Sanitize a string for logging. Returns the sanitized string.
   * Never throws — returns original if sanitization fails.
   */
  sanitize(input: string): string {
    try {
      let result = input;
      for (const { pattern, replacement } of this.patterns) {
        // Reset regex state (in case global flag)
        pattern.lastIndex = 0;
        result = result.replace(pattern, replacement);
      }
      return result;
    } catch {
      return input;
    }
  }

  /**
   * Sanitize all string values in an object (deep).
   */
  sanitizeObject<T>(obj: T): T {
    if (typeof obj === "string") {
      return this.sanitize(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item)) as unknown as T;
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.sanitizeObject(val);
      }
      return result as T;
    }
    return obj;
  }

  /**
   * Add a custom pattern.
   */
  addPattern(pattern: SecretPattern): void {
    this.patterns.push(pattern);
  }
}

export const defaultSanitizer = new LogSanitizer();
