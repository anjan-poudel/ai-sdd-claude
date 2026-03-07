/**
 * Transport-agnostic overlay protocol types.
 * Canonical home for all OverlayProvider, OverlayDecision, and wire-format types.
 */
import { z } from "zod";
import type { AgentContext, TaskResult, TaskDefinition } from "./index.ts";

export type OverlayRuntime = "local" | "cli" | "mcp";
export type OverlayHook = "pre_task" | "post_task";

// String union (not enum keyword) — ensures TypeScript exhaustiveness checks
// compile-fail if a new value is added without a handler in switch statements.
export type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

export interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}

export interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  /** Engine MUST strip identity fields (task_id, status, workflow_id, run_id) before applying. */
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}

export interface OverlayContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_definition: TaskDefinition;
  agent_context: AgentContext;
}

export interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];
  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}

// Zod schema for MCP wire format — only schema used to validate remote responses
export const OverlayInvokeOutputSchema = z.object({
  protocol_version: z.literal("1"),
  verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
  feedback: z.string().optional(),
  evidence: z.object({
    overlay_id: z.string(),
    checks: z.array(z.string()).optional(),
    report_ref: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  }).optional(),
});

export type OverlayInvokeOutput = z.infer<typeof OverlayInvokeOutputSchema>;

export interface OverlayInvokeInput {
  protocol_version: "1";
  overlay_id: string;
  hook: OverlayHook;
  workflow: { id: string; run_id: string };
  task: {
    id: string;
    phase?: string;
    requirement_ids?: string[];
    acceptance_criteria?: unknown[];
    scope_excluded?: string[];
  };
  artifacts?: {
    requirements_lock_path?: string;
    state_path?: string;
    outputs?: Array<{ path: string; contract?: string }>;
  };
  result?: {
    outputs?: Array<{ path: string; contract?: string }>;
    handover_state?: Record<string, unknown>;
  };
  config?: Record<string, unknown>;
}
