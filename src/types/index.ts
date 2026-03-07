/**
 * Shared types for the ai-sdd framework.
 * This is the canonical source of truth for all enums, interfaces, and type definitions.
 */

// ─── Task States ────────────────────────────────────────────────────────────

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NEEDS_REWORK"
  | "HIL_PENDING"
  | "FAILED"
  | "CANCELLED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],   // terminal — no outgoing transitions
};

// ─── HIL Queue States ────────────────────────────────────────────────────────

export type HilStatus = "PENDING" | "ACKED" | "RESOLVED" | "REJECTED";

// ─── Evidence Gate Risk Tiers ────────────────────────────────────────────────

export type RiskTier = "T0" | "T1" | "T2";

// ─── Adapter Types ───────────────────────────────────────────────────────────

export type AdapterType = "claude_code" | "openai" | "roo_code" | "mock";
export type DispatchMode = "direct" | "delegation";

// ─── Config Merge ────────────────────────────────────────────────────────────

export type CostEnforcement = "warn" | "pause" | "stop";
export type InjectionDetectionLevel = "pass" | "warn" | "quarantine";
export type ObservabilityLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

// ─── Agent Types ─────────────────────────────────────────────────────────────

export interface AgentLLMConfig {
  provider: string;
  model: string;
  hyperparameters?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    [key: string]: unknown;
  };
}

export interface AgentRole {
  description: string;
  expertise?: string[];
  responsibilities?: string[];
}

export interface AgentConfig {
  name: string;
  display_name: string;
  version: string;
  extends?: string | null;
  llm: AgentLLMConfig;
  role: AgentRole;
  commands?: Record<string, string>;
}

// ─── Workflow Types ───────────────────────────────────────────────────────────

export interface TaskOutput {
  path: string;
  contract?: string;
}

export interface TaskOverlays {
  hil?: {
    enabled?: boolean;
    risk_tier?: RiskTier;
  };
  policy_gate?: {
    risk_tier?: RiskTier;
    enabled?: boolean;
  };
  confidence?: {
    enabled?: boolean;
    threshold?: number;
  };
  paired?: {
    enabled?: boolean;
  };
  review?: {
    enabled?: boolean;
  };
}

export interface TaskDefinition {
  id: string;
  use?: string;
  agent: string;
  description: string;
  depends_on?: string[];
  outputs?: TaskOutput[];
  exit_conditions?: string[];
  overlays?: TaskOverlays;
  max_rework_iterations?: number;
  [key: string]: unknown;
}

/** Fields allowed in workflow-level defaults: block. */
export interface WorkflowDefaults {
  overlays?: TaskOverlays;
  max_rework_iterations?: number;
  exit_conditions?: string[];
}

/** Engine built-in task defaults — applied before workflow defaults or task overrides. */
export const ENGINE_TASK_DEFAULTS: WorkflowDefaults = {
  overlays: {
    hil:         { enabled: true },
    policy_gate: { risk_tier: "T1" },
  },
  max_rework_iterations: 3,
};

export interface WorkflowConfig {
  version: string;
  name: string;
  description?: string;
  defaults?: WorkflowDefaults;
  tasks: Record<string, Omit<TaskDefinition, "id">>;
}

// ─── State File Types ─────────────────────────────────────────────────────────

export interface TaskState {
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  outputs: TaskOutput[];
  iterations: number;
  rework_feedback?: string;
  hil_item_id?: string;
  error?: string;
  overlay_evidence?: import("./overlay-protocol.ts").OverlayEvidence;
}

export interface WorkflowState {
  schema_version: "1";
  workflow: string;
  project: string;
  started_at: string;
  updated_at: string;
  tasks: Record<string, TaskState>;
}

// ─── Adapter Types ────────────────────────────────────────────────────────────

export interface AgentContext {
  constitution: string;
  handover_state: Record<string, unknown>;
  task_definition: TaskDefinition;
  dispatch_mode: DispatchMode;
  /** Absolute path to the project root. Used by direct-mode adapters that write output files. */
  project_path?: string;
}

export interface TaskResult {
  status: TaskStatus;
  outputs?: TaskOutput[];
  handover_state?: Record<string, unknown>;
  error?: string;
  error_type?: AdapterErrorType;
  tokens_used?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cost_usd?: number;
}

// ─── Adapter Error Types ──────────────────────────────────────────────────────

export type AdapterErrorType =
  | "rate_limit"
  | "context_overflow"
  | "auth_error"
  | "network_error"
  | "tool_error"
  | "timeout"
  | "provider_error"
  | "unknown";

// ─── HIL Queue Item ───────────────────────────────────────────────────────────

export interface HilItem {
  id: string;
  task_id: string;
  workflow_id: string;
  status: HilStatus;
  reason: string;
  context: Record<string, unknown>;
  created_at: string;
  acked_at?: string;
  resolved_at?: string;
  rejected_at?: string;
  notes?: string;
  rejection_reason?: string;
}

// ─── Config Types ─────────────────────────────────────────────────────────────

export interface ProjectConfig {
  version: string;
  workflow?: string;
  adapter?: {
    type: AdapterType;
    dispatch_mode?: DispatchMode;
    [key: string]: unknown;
  };
  engine?: {
    max_concurrent_tasks?: number;
    rate_limit_requests_per_minute?: number;
    cost_budget_per_run_usd?: number;
    cost_enforcement?: CostEnforcement;
    context_warning_threshold_pct?: number;
    context_hil_threshold_pct?: number;
  };
  overlays?: {
    hil?: {
      enabled?: boolean;
      queue_path?: string;
      poll_interval_seconds?: number;
      notify?: {
        on_created?: string[];
        on_t2_gate?: string[];
      };
    };
  };
  security?: {
    secret_patterns?: string[];
    injection_detection_level?: InjectionDetectionLevel;
  };
  constitution?: {
    strict_parse?: boolean;
  };
  observability?: {
    log_level?: ObservabilityLogLevel;
  };
  governance?: {
    requirements_lock?: "off" | "warn" | "enforce";
  };
}

// ─── Artifact Contract Types ──────────────────────────────────────────────────

export interface ArtifactContractField {
  required: boolean;
  type?: string;
  description?: string;
}

export interface ArtifactContract {
  name: string;
  version: string;
  description?: string;
  fields?: Record<string, ArtifactContractField>;
  sections?: string[];
}

export interface ArtifactSchema {
  version: string;
  contracts: Record<string, ArtifactContract>;
}

// ─── Observability Event Types ────────────────────────────────────────────────

export type EventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.rework"
  | "task.retrying"
  | "hil.created"
  | "hil.acked"
  | "hil.resolved"
  | "hil.rejected"
  | "gate.pass"
  | "gate.fail"
  | "confidence.computed"
  | "context.warning"
  | "cost.warning"
  | "security.violation"
  | "overlay.remote.connecting"
  | "overlay.remote.connected"
  | "overlay.remote.invoked"
  | "overlay.remote.decision"
  | "overlay.remote.failed"
  | "overlay.remote.fallback";

export interface ObservabilityEvent {
  type: EventType;
  run_id: string;
  workflow_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Idempotency Keys ─────────────────────────────────────────────────────────

export interface IdempotencyKeys {
  operation_id: string; // workflow_id:task_id:task_run_id — stable across retries
  attempt_id: string;   // workflow_id:task_id:task_run_id:attempt_N — changes per retry
}

// ─── Parallel Group (workflow DAG) ────────────────────────────────────────────

export interface ParallelGroup {
  tasks: string[];
  level: number;
}

export interface ExecutionPlan {
  groups: ParallelGroup[];
  all_tasks: string[];
}

// ─── Remote Overlay Protocol Re-exports ───────────────────────────────────────

export * from "./overlay-protocol.ts";
