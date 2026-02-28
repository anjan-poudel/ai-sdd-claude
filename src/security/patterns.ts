/**
 * Security patterns — 20+ injection patterns + secret pattern registry.
 */

export interface InjectionPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface SecretPattern {
  id: string;
  name: string;
  pattern: RegExp;
  description: string;
}

// ─── Injection Detection Patterns (≥20) ──────────────────────────────────────

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: "INJ-001",
    name: "prompt_override",
    pattern: /ignore (?:all |previous |prior )*(?:instructions|rules|constraints)/i,
    severity: "critical",
    description: "Attempt to override system instructions",
  },
  {
    id: "INJ-002",
    name: "role_override",
    pattern: /you are (now |actually |really )?(a |an )?(different |new )?(assistant|ai|bot|model|llm)/i,
    severity: "high",
    description: "Attempt to reassign AI role",
  },
  {
    id: "INJ-003",
    name: "jailbreak_dan",
    pattern: /do anything now|DAN mode|jailbreak|unrestricted mode/i,
    severity: "critical",
    description: "DAN jailbreak attempt",
  },
  {
    id: "INJ-004",
    name: "system_prompt_leak",
    pattern: /print (your |the |all )?(system |original |initial )?(prompt|instructions|rules)/i,
    severity: "high",
    description: "Attempt to extract system prompt",
  },
  {
    id: "INJ-005",
    name: "instruction_injection",
    pattern: /\[SYSTEM\]|\[INST\]|<\|system\|>|<\|im_start\|>system/i,
    severity: "critical",
    description: "LLM instruction format injection",
  },
  {
    id: "INJ-006",
    name: "hidden_instruction",
    pattern: /<!--.*?(ignore|instruction|system|prompt).*?-->/is,
    severity: "high",
    description: "Hidden instruction in HTML comment",
  },
  {
    id: "INJ-007",
    name: "whitespace_injection",
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{3,}/,
    severity: "medium",
    description: "Suspicious control character sequence",
  },
  {
    id: "INJ-008",
    name: "unicode_injection",
    pattern: /[\u202A-\u202E\u2066-\u2069]/,
    severity: "high",
    description: "Unicode bidirectional text injection",
  },
  {
    id: "INJ-009",
    name: "base64_payload",
    pattern: /(?:execute|eval|run|decode).*?[A-Za-z0-9+/]{50,}={0,2}/i,
    severity: "high",
    description: "Base64-encoded payload execution",
  },
  {
    id: "INJ-010",
    name: "code_execution",
    pattern: /(?:exec|eval|system|popen|subprocess|os\.system)\s*\(/i,
    severity: "critical",
    description: "Code execution function call",
  },
  {
    id: "INJ-011",
    name: "shell_injection",
    pattern: /[;&|`$]\s*(?:rm|cat|wget|curl|nc|bash|sh|python|node)\s/i,
    severity: "critical",
    description: "Shell command injection",
  },
  {
    id: "INJ-012",
    name: "path_traversal",
    pattern: /(?:\.\.[\/\\]){2,}/,
    severity: "high",
    description: "Path traversal attempt",
  },
  {
    id: "INJ-013",
    name: "data_exfiltration",
    pattern: /(?:send|post|upload|exfiltrate|transmit).*?(?:to|via).*?(?:http|ftp|smtp|dns)/i,
    severity: "critical",
    description: "Data exfiltration instruction",
  },
  {
    id: "INJ-014",
    name: "file_read_injection",
    pattern: /(?:read|cat|type|open)\s+(?:\/etc\/passwd|\/etc\/shadow|~\/\.ssh|\.env)/i,
    severity: "critical",
    description: "Sensitive file read instruction",
  },
  {
    id: "INJ-015",
    name: "template_injection",
    pattern: /\{\{.*?(?:__class__|__mro__|__subclasses__|config|self).*?\}\}/,
    severity: "high",
    description: "Server-side template injection",
  },
  {
    id: "INJ-016",
    name: "sql_injection",
    pattern: /(?:'|")\s*(?:OR|AND)\s+(?:'|")?\d+(?:'|")?\s*=\s*(?:'|")?\d+/i,
    severity: "high",
    description: "SQL injection pattern",
  },
  {
    id: "INJ-017",
    name: "xml_injection",
    pattern: /<!ENTITY\s+\w+\s+SYSTEM\s+/i,
    severity: "high",
    description: "XML external entity injection",
  },
  {
    id: "INJ-018",
    name: "repeated_override",
    pattern: /(?:forget|disregard|discard|bypass|override).*?(?:above|previous|prior|earlier)/i,
    severity: "high",
    description: "Instruction override via forget/disregard",
  },
  {
    id: "INJ-019",
    name: "role_play_injection",
    pattern: /pretend (?:you are|to be)|act as (?:if you are|a (?:hacker|malware|virus))/i,
    severity: "medium",
    description: "Roleplay-based injection",
  },
  {
    id: "INJ-020",
    name: "indirect_injection",
    pattern: /when you (see|read|process) this.*?(?:ignore|do|execute|run)/i,
    severity: "high",
    description: "Indirect/deferred injection trigger",
  },
];

// ─── Secret Detection Patterns ─────────────────────────────────────────────────

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: "SEC-001", name: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g, description: "AWS Access Key ID" },
  { id: "SEC-002", name: "aws_secret_key", pattern: /(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])/g, description: "AWS Secret Access Key" },
  { id: "SEC-003", name: "github_token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, description: "GitHub token" },
  { id: "SEC-004", name: "anthropic_key", pattern: /sk-ant-[a-zA-Z0-9\-_]{93}/g, description: "Anthropic API key" },
  { id: "SEC-005", name: "openai_key", pattern: /sk-[a-zA-Z0-9]{48}/g, description: "OpenAI API key" },
  { id: "SEC-006", name: "generic_api_key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-_]{20,}["']?/gi, description: "Generic API key" },
  { id: "SEC-007", name: "private_key_pem", pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g, description: "PEM private key" },
  { id: "SEC-008", name: "jwt_token", pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, description: "JWT token" },
  { id: "SEC-009", name: "bearer_token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, description: "HTTP Bearer token" },
  { id: "SEC-010", name: "password_field", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, description: "Password in config/code" },
  { id: "SEC-011", name: "connection_string", pattern: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"']+/gi, description: "Database connection string" },
  { id: "SEC-012", name: "slack_token", pattern: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g, description: "Slack token" },
  { id: "SEC-013", name: "stripe_key", pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{24,}/g, description: "Stripe API key" },
  { id: "SEC-014", name: "google_api_key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, description: "Google API key" },
  { id: "SEC-015", name: "ssh_private_key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, description: "SSH private key" },
];

/**
 * Check if content contains injection patterns.
 * Returns matched patterns.
 */
export function detectInjection(content: string): InjectionPattern[] {
  const matches: InjectionPattern[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    pattern.pattern.lastIndex = 0;
    if (pattern.pattern.test(content)) {
      matches.push(pattern);
    }
  }
  return matches;
}

/**
 * Check if content contains secrets.
 * Returns matched patterns (by name only — never log content).
 */
export function detectSecrets(content: string): SecretPattern[] {
  const matches: SecretPattern[] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.pattern.lastIndex = 0;
    if (pattern.pattern.test(content)) {
      matches.push(pattern);
    }
  }
  return matches;
}
