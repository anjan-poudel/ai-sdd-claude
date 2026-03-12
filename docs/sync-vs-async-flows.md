# How ai-sdd Distinguishes Sync vs Async Flows

## The switch: `mode` on a task

```yaml
# SYNC (default) — engine blocks until agent completes, then moves on
implement:
  use: standard-implement
  depends_on: [plan-tasks]

# ASYNC — engine posts to Slack and waits for human replies before proceeding
review-implementation:
  use: review-implementation
  depends_on: [implement]
  mode: async              # ← this is the only difference in YAML
  min_approvals: 2         # optional: require N distinct stakeholders
  approval_timeout_seconds: 86400  # optional: auto-expire after 24h
```

## What happens under the hood

```
SYNC flow                          ASYNC flow
───────────────────────────────    ──────────────────────────────────────────
PENDING                            PENDING
  ↓                                  ↓
RUNNING (agent executes)           RUNNING (agent executes)
  ↓                                  ↓
COMPLETED                          AWAITING_APPROVAL  ← new state
                                     │
                                     ├─ Slack message posted:
                                     │    "@ai-sdd approve <task-id>"
                                     │
                                     ├─ Jira issue created (if configured)
                                     │
                                     ├─ Confluence page published (if configured)
                                     │
                                     └─ Slack polling loop starts (every 5s)
                                          │
                                    user replies in Slack
                                          │
                                     ApprovalManager counts signals
                                          │
                                    threshold_met? → COMPLETED
                                    rejected?      → NEEDS_REWORK
                                    timed out?     → FAILED
```

## Where each tool is used

| Tool | Sync flow | Async flow |
|------|-----------|------------|
| **Slack** | Not used | Posts approval request; polls for `@ai-sdd approve/reject` replies |
| **Jira** | Issues synced via `AsCodeSyncEngine` at task start | Same, plus issue status updated when approval resolves |
| **Confluence** | Pages published when agent writes artifact | Pages published; URL included in Slack notification |
| **GitHub** | PR opened for implement tasks | PR review awaited as an approval signal |

## The key types in code

```typescript
// src/collaboration/types.ts

interface AsyncTaskConfig {
  mode: "sync" | "async";    // the switch
  min_approvals: number;      // default 1
  approval_timeout_seconds: number; // default 0 = no timeout
}

interface AsyncTaskState {
  async_phase: number;         // approval cycle count
  approval_signals: ApprovalSignal[];
  rejection_signals: RejectionSignal[];
  collaboration_refs: {        // cross-system refs persisted in state
    slack_message_ts?: string;
    confluence_page_id?: string;
    jira_issue_key?: string;
    pr_id?: string;
  };
  approval_timeout_at?: string; // ISO deadline
}
```

## `AWAITING_APPROVAL` is a real task state

It sits between `RUNNING` and `COMPLETED` in the state machine and is **persisted to disk** — so if you restart `ai-sdd run` mid-approval, the engine resumes polling Slack rather than re-running the agent. The `collaboration_refs` block in `workflow-state.json` tells it which Slack message to watch, which Jira issue to update, etc.

## Making tasks async in the quickstart

The `workflow.yaml` defaults to `mode: sync` everywhere. To make `review-implementation` and `final-sign-off` require Slack approval:

```yaml
review-implementation:
  use: review-implementation
  depends_on: [implement]
  mode: async
  min_approvals: 1
  approval_timeout_seconds: 86400

final-sign-off:
  use: final-sign-off
  depends_on: [review-implementation]
  mode: async
  min_approvals: 2   # require two stakeholders
```
