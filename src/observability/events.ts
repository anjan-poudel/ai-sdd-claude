/**
 * Zod schemas for all 18 observability event types.
 */
import { z } from "zod";

const BaseEventSchema = z.object({
  type: z.string(),
  run_id: z.string(),
  workflow_id: z.string(),
  timestamp: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
});

export const WorkflowStartedEvent = BaseEventSchema.extend({
  type: z.literal("workflow.started"),
  data: z.object({
    workflow_name: z.string(),
    task_count: z.number(),
    adapter_type: z.string(),
  }).passthrough(),
});

export const WorkflowCompletedEvent = BaseEventSchema.extend({
  type: z.literal("workflow.completed"),
  data: z.object({
    duration_ms: z.number(),
    tasks_completed: z.number(),
    total_cost_usd: z.number().optional(),
  }).passthrough(),
});

export const WorkflowFailedEvent = BaseEventSchema.extend({
  type: z.literal("workflow.failed"),
  data: z.object({
    error: z.string(),
    failed_task: z.string().optional(),
  }).passthrough(),
});

export const TaskStartedEvent = BaseEventSchema.extend({
  type: z.literal("task.started"),
  data: z.object({
    task_id: z.string(),
    agent: z.string(),
    operation_id: z.string(),
    attempt_id: z.string(),
    iteration: z.number(),
  }).passthrough(),
});

export const TaskCompletedEvent = BaseEventSchema.extend({
  type: z.literal("task.completed"),
  data: z.object({
    task_id: z.string(),
    duration_ms: z.number(),
    tokens_used: z.object({
      input: z.number(),
      output: z.number(),
      total: z.number(),
      cost_usd: z.number().optional(),
    }).optional(),
  }).passthrough(),
});

export const TaskFailedEvent = BaseEventSchema.extend({
  type: z.literal("task.failed"),
  data: z.object({
    task_id: z.string(),
    error: z.string(),
    error_type: z.string().optional(),
  }).passthrough(),
});

export const TaskReworkEvent = BaseEventSchema.extend({
  type: z.literal("task.rework"),
  data: z.object({
    task_id: z.string(),
    iteration: z.number(),
    feedback: z.string(),
  }).passthrough(),
});

export const TaskRetryingEvent = BaseEventSchema.extend({
  type: z.literal("task.retrying"),
  data: z.object({
    task_id: z.string(),
    attempt: z.number(),
    operation_id: z.string(),
    attempt_id: z.string(),
    error_type: z.string().optional(),
  }).passthrough(),
});

export const HilCreatedEvent = BaseEventSchema.extend({
  type: z.literal("hil.created"),
  data: z.object({
    hil_id: z.string(),
    task_id: z.string(),
    reason: z.string(),
  }).passthrough(),
});

export const HilAckedEvent = BaseEventSchema.extend({
  type: z.literal("hil.acked"),
  data: z.object({
    hil_id: z.string(),
    task_id: z.string(),
  }).passthrough(),
});

export const HilResolvedEvent = BaseEventSchema.extend({
  type: z.literal("hil.resolved"),
  data: z.object({
    hil_id: z.string(),
    task_id: z.string(),
    notes: z.string().optional(),
  }).passthrough(),
});

export const HilRejectedEvent = BaseEventSchema.extend({
  type: z.literal("hil.rejected"),
  data: z.object({
    hil_id: z.string(),
    task_id: z.string(),
    reason: z.string().optional(),
  }).passthrough(),
});

export const GatePassEvent = BaseEventSchema.extend({
  type: z.literal("gate.pass"),
  data: z.object({
    task_id: z.string(),
    risk_tier: z.enum(["T0", "T1", "T2"]),
    confidence_score: z.number().optional(),
  }).passthrough(),
});

export const GateFailEvent = BaseEventSchema.extend({
  type: z.literal("gate.fail"),
  data: z.object({
    task_id: z.string(),
    risk_tier: z.enum(["T0", "T1", "T2"]),
    failures: z.array(z.string()),
  }).passthrough(),
});

export const ConfidenceComputedEvent = BaseEventSchema.extend({
  type: z.literal("confidence.computed"),
  data: z.object({
    task_id: z.string(),
    score: z.number().min(0).max(1),
    metrics: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
});

export const ContextAssembledEvent = BaseEventSchema.extend({
  type: z.literal("context.assembled"),
  data: z.object({
    task_id: z.string(),
    token_count: z.number(),
  }).passthrough(),
});

export const ContextWarningEvent = BaseEventSchema.extend({
  type: z.literal("context.warning"),
  data: z.object({
    task_id: z.string(),
    usage_pct: z.number(),
    threshold_pct: z.number(),
  }).passthrough(),
});

export const CostWarningEvent = BaseEventSchema.extend({
  type: z.literal("cost.warning"),
  data: z.object({
    current_cost_usd: z.number(),
    budget_usd: z.number(),
    enforcement: z.enum(["warn", "pause", "stop"]),
  }).passthrough(),
});

export const SecurityViolationEvent = BaseEventSchema.extend({
  type: z.literal("security.violation"),
  data: z.object({
    task_id: z.string().optional(),
    violation_type: z.enum(["injection", "secret", "path_traversal"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    // Content is NEVER included in events — only metadata
    pattern_matched: z.string().optional(),
  }).passthrough(),
});

export const OverlayRemoteConnectingEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connecting"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    workflow_id: z.string(),
    run_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteConnectedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connected"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteInvokedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.invoked"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteDecisionEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.decision"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFailedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.failed"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_tier: z.enum(["transport", "schema"]),
    error_message: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFallbackEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.fallback"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_policy: z.enum(["skip", "warn"]),
  }).passthrough(),
});

export const TaskHilResumingEvent = BaseEventSchema.extend({
  type: z.literal("task.hil_resuming"),
  data: z.object({
    task_id: z.string(),
    hil_id: z.string(),
  }).passthrough(),
});

export const TaskHilPendingEvent = BaseEventSchema.extend({
  type: z.literal("task.hil_pending"),
  data: z.object({
    task_id: z.string(),
    hil_id: z.string().optional(),
    feedback: z.string().optional(),
  }).passthrough(),
});

export const HilNotifyFailedEvent = BaseEventSchema.extend({
  type: z.literal("hil.notify_failed"),
  data: z.object({
    hil_id: z.string(),
    task_id: z.string(),
    command: z.string().optional(),
    exit_code: z.number().optional(),
    error: z.string().optional(),
  }).passthrough(),
});

export const PairedNotImplementedEvent = BaseEventSchema.extend({
  type: z.literal("paired.not_implemented"),
  data: z.object({
    task_id: z.string(),
    message: z.string(),
  }).passthrough(),
});

export type AnyEvent = {
  type: string;
  run_id: string;
  workflow_id: string;
  timestamp: string;
  data: Record<string, unknown>;
};
