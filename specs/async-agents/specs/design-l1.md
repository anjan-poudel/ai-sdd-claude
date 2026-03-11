# L1 Architecture -- Async/Hybrid Workflow Collaboration for ai-sdd

## Summary

This document defines the Level 1 architecture for extending the ai-sdd framework with async/hybrid workflow execution, collaboration tool integration (Slack, Confluence, Jira, Bitbucket), and a Jira-as-Code sync engine. The design extends the existing engine state machine with new async-specific states rather than running a parallel state machine, introduces four pluggable collaboration adapter interfaces (Notification, Document, TaskTracking, CodeReview), and uses Slack as the primary coordination bus for inter-agent and stakeholder communication. MVP 1 targets the Atlassian stack; MVP 2 adds GitHub adapters behind the same interfaces. The architecture preserves full backward compatibility: existing synchronous workflows run without modification.

## Overview

### System Context

ai-sdd is a workflow orchestration framework that dispatches tasks to LLM agents, manages state transitions, and enforces quality gates (HIL, evidence, confidence, traceability). Today it operates synchronously: the engine dispatches a task, blocks until the agent returns, validates output, and transitions state.

This feature introduces an **async execution model** where tasks produce output, notify stakeholders via collaboration tools, and pause for external approval signals before advancing. The engine must support three workflow modes: fully synchronous, fully asynchronous, and hybrid (mixed).

### Architecture Style

The design follows the existing ai-sdd patterns:

- **Extension, not replacement** -- new async capabilities are added to the existing engine, state machine, and config system. No existing interfaces are modified in backward-incompatible ways.
- **Adapter pattern** -- each collaboration tool sits behind a typed interface. The engine and orchestrator interact only with the interface, never with vendor SDKs directly.
- **Event-driven coordination** -- a new `CollaborationEventBus` internally routes events (approval received, comment posted, PR merged) from adapters to the engine and audit log.
- **Code-as-source-of-truth** -- the Jira-as-Code (and GitHub-as-Code) sync engine derives tickets from workflow YAML; manual Jira/GitHub edits are overwritten on the next sync cycle.

### How This Extends Existing ai-sdd

| Existing Concern | Extension |
|---|---|
| `TaskStatus` enum (6 states) | Add 3 new states: `AWAITING_APPROVAL`, `APPROVED`, `DOING` (existing `COMPLETED` maps to `DONE`) |
| `TaskConfig` interface | Add `mode: "sync" \| "async"`, `min_approvals`, `approval_timeout_seconds`, `collaboration` config block |
| `WorkflowDefaults` | Add async defaults (`mode`, `min_approvals`, `approval_timeout_seconds`) |
| `RuntimeAdapter` (LLM dispatch) | Unchanged. Collaboration adapters are a separate adapter layer (not LLM adapters) |
| Overlay chain | Unchanged. The async approval gate runs **after** overlays complete, as a distinct engine concern |
| State persistence (`workflow-state.json`) | Extended `TaskState` with `approval_signals[]`, `async_phase`, `collaboration_refs` |
| Observability events | New event types: `async.awaiting`, `async.approved`, `async.rejected`, `async.timeout`, `collab.*` |
| CLI | New subcommand `ai-sdd sync` for Jira-as-Code. Existing `run`, `status`, `complete-task` extended |

```
                    +--------------------------------------------------+
                    |                   ai-sdd Engine                   |
                    |                                                  |
                    |  +------------+   +----------+   +------------+  |
                    |  | Task DAG   |   | State    |   | Overlay    |  |
                    |  | Scheduler  |   | Manager  |   | Chain      |  |
                    |  +-----+------+   +----+-----+   +-----+------+  |
                    |        |               |               |         |
                    |        +-------+-------+-------+-------+         |
                    |                |               |                 |
                    |    +-----------v-----------+   |                 |
                    |    | Async Execution       |   |                 |
                    |    | Controller (new)      |   |                 |
                    |    +------+--------+-------+   |                 |
                    |           |        |           |                 |
                    +-----------|--------|-----------|--+--------------+
                                |        |           |
            +-------------------+        |           +-------------------+
            |                            |                               |
    +-------v--------+      +-----------v-----------+      +------------v---------+
    | Collaboration  |      | Approval              |      | Jira-as-Code         |
    | Event Bus      |      | Manager               |      | Sync Engine          |
    +---+---+---+----+      +-----------------------+      +----------+-----------+
        |   |   |                                                     |
   +----+   |   +----+                                    +-----------+-----------+
   |        |        |                                    |                       |
+--v---+ +--v----+ +-v-------+                    +-------v------+   +-----------v---+
|Notif | |Doc    | |Code     |                    |TaskTracking  |   |TaskTracking   |
|Adapt | |Adapt  | |Review   |                    |Adapter       |   |Adapter        |
|      | |       | |Adapter  |                    |(Jira)        |   |(GitHub) MVP2  |
+--+---+ +--+----+ +---+-----+                    +--------------+   +---------------+
   |        |           |
+--v---+ +--v------+ +--v--------+
|Slack | |Conflu-  | |Bitbucket  |
|API   | |ence API | |API        |
+------+ +---------+ +-----------+
```

## Key Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| State machine approach | Extend existing `TaskStatus` with 3 new states | Avoids dual state machine complexity. The stakeholder flagged concern about excessive touch points. A single state machine with added states keeps the `VALID_TRANSITIONS` map as the single source of truth. Sync tasks never enter the new states, so backward compat is maintained. |
| Slack interaction model | Structured text commands in channel messages | Keep it simple per stakeholder instruction. No Slack App interactive features (buttons, modals, slash commands). Messages follow a parseable format: `@ai-sdd approve <task-id> [notes]`. Reactions and buttons are post-MVP enhancements. |
| Confluence Markdown-to-XHTML | Use `markdown-it` library with a Confluence storage format renderer plugin | Confluence stores pages in XHTML storage format. A lightweight Markdown parser that outputs XHTML is simpler and more testable than calling a conversion API. The renderer handles headings, tables, code blocks, and lists. Edge cases (macros, complex layouts) are out of scope for MVP. |
| Jira-as-Code conflict detection | Content hash comparison using SHA-256 | Field-level diff is complex and fragile (Jira description formatting varies). Timestamp comparison fails when clocks are skewed or API caches are stale. A SHA-256 hash of the normalized YAML task definition compared against the stored hash from last sync is deterministic, simple, and works offline. |
| Async polling vs WebSocket (Slack) | Polling with configurable interval | WebSocket (Socket Mode) requires a Slack App with additional OAuth scopes and infrastructure. Polling the conversations.history API with a configurable interval (default 5s) meets the NFR-004 latency requirement and aligns with "keep it simple" constraint. Can be upgraded to Socket Mode later without interface changes. |
| Collaboration adapter layer vs LLM adapter layer | Separate adapter hierarchy | `RuntimeAdapter` dispatches LLM tasks (Claude, OpenAI). Collaboration adapters handle tool CRUD (Slack post, Jira create). Different concerns, different interfaces, different retry semantics. Keeping them separate avoids polluting the LLM adapter contract. |
| Approval persistence | Inline in `workflow-state.json` TaskState | Approval signals are task-scoped state. Storing them in the existing state file (extended `TaskState`) avoids a second persistence file and reuses the atomic tmp+rename pattern. |
| Sync engine shared between Jira and GitHub | Single `AsCodeSyncEngine` parameterized by `TaskTrackingAdapter` | FR-018 explicitly requires the sync engine to be shared. The sync logic (diff, create, update, flag orphans) is tool-agnostic; only the API calls differ. |

## Architecture

### Extended State Machine

The existing state machine is extended with three new states for async tasks. Sync tasks never enter these states and their transitions are unchanged.

```
Extended Task State Machine
===========================

                     +----------+
                     | PENDING  |
                     +----+-----+
                          |
                     +----v-----+
                     | RUNNING  |  (agent executes + overlays run)
                     +----+-----+
                          |
           +--------------+---------------+
           |              |               |
    (sync path)    (async path)     (failure paths -- unchanged)
           |              |               |
    +------v------+  +----v-----------+   +-->  NEEDS_REWORK
    | COMPLETED   |  | AWAITING_      |   +-->  HIL_PENDING
    | (terminal)  |  | APPROVAL       |   +-->  FAILED
    +-------------+  +----+-----------+
                          |
              +-----------+-----------+
              |           |           |
         (approved)  (rejected)  (timeout)
              |           |           |
         +----v-----+    |      +----v-----------+
         | APPROVED  |    |      | FAILED         |
         +----+-----+    |      | (+ Slack notif) |
              |           |      +----------------+
         +----v-----+    |
         | DOING    |<---+  (rework: agent addresses feedback)
         +----+-----+
              |
         +----v-----------+
         | COMPLETED      |   (maps to "DONE" in Jira/GitHub boards)
         | (terminal)     |
         +-----------------+
```

**New transitions added to `VALID_TRANSITIONS`:**

```
RUNNING          --> AWAITING_APPROVAL   (async task output produced, awaiting external sign-off)
AWAITING_APPROVAL --> APPROVED           (min_approvals threshold met)
AWAITING_APPROVAL --> DOING              (rejected -- rework with feedback)
AWAITING_APPROVAL --> FAILED             (timeout expired)
AWAITING_APPROVAL --> CANCELLED          (manual cancellation)
APPROVED         --> DOING               (automatic -- begin next work phase)
DOING            --> AWAITING_APPROVAL   (next review cycle)
DOING            --> COMPLETED           (final approval received, work complete)
DOING            --> FAILED              (unrecoverable error during rework)
DOING            --> CANCELLED           (manual cancellation)
```

Sync tasks follow the existing path: `PENDING --> RUNNING --> COMPLETED`. They never enter `AWAITING_APPROVAL`, `APPROVED`, or `DOING`. The engine checks `task.mode` before applying async transitions.

### Data Flows

**Async Task Execution Flow:**

```
1. Engine picks task from DAG (PENDING --> RUNNING)
2. LLM adapter dispatches agent work (RuntimeAdapter.dispatch)
3. Overlay chain runs (HIL, evidence, confidence, traceability)
4. Agent output is produced and validated
5. IF mode == "sync":  RUNNING --> COMPLETED (existing path)
   IF mode == "async": RUNNING --> AWAITING_APPROVAL
6. Async Execution Controller takes over:
   a. Posts Slack notification via NotificationAdapter (FR-004)
   b. Creates/updates Confluence page via DocumentAdapter (FR-006) if applicable
   c. Creates/updates Jira issue state via TaskTrackingAdapter (FR-009)
   d. Transitions engine to polling mode for approval signals
7. Slack listener detects approval/rejection messages (FR-005)
8. Approval Manager validates signal (dedup, threshold check) (FR-013)
9. IF approved (threshold met): AWAITING_APPROVAL --> APPROVED --> DOING
   IF rejected: AWAITING_APPROVAL --> DOING (with feedback attached)
   IF timeout: AWAITING_APPROVAL --> FAILED (with Slack notification)
10. DOING phase: agent processes feedback, updates artifacts
11. Cycle repeats (steps 5-10) until final approval
12. DOING --> COMPLETED (terminal)
```

**Jira-as-Code Sync Flow:**

```
1. User runs `ai-sdd sync` (or engine triggers on workflow load)
2. SyncEngine loads workflow YAML task definitions
3. SyncEngine loads mapping file (.ai-sdd/sync-mappings/<adapter>.json)
4. SyncEngine computes SHA-256 hash of each task definition
5. FOR EACH task:
   a. If no mapping exists --> CREATE issue via TaskTrackingAdapter
   b. If mapping exists AND hash differs --> UPDATE issue via TaskTrackingAdapter
   c. If mapping exists AND hash matches --> SKIP (idempotent)
6. FOR EACH mapping with no corresponding task --> FLAG as orphaned (label, warn)
7. SyncEngine writes updated mapping file (atomic tmp+rename)
8. Audit log records all sync operations
```

### Integration Points

| Integration Point | Protocol | Auth | Rate Limit Strategy |
|---|---|---|---|
| Slack Web API | HTTPS REST | Bot token (`SLACK_BOT_TOKEN`) | Respect `Retry-After` header; tier-1 rate limits (1 req/sec) |
| Slack RTM / Polling | HTTPS REST (`conversations.history`) | Bot token | Poll interval configurable (default 5s), deduplicate by `ts` |
| Confluence REST API v2 | HTTPS REST | API token (`CONFLUENCE_API_TOKEN`) + email | Standard Atlassian rate limits; exponential backoff |
| Jira REST API v3 | HTTPS REST | API token (`JIRA_API_TOKEN`) + email | Standard Atlassian rate limits; exponential backoff |
| Bitbucket REST API 2.0 | HTTPS REST | App password (`BITBUCKET_APP_PASSWORD`) + username | Standard Atlassian rate limits; exponential backoff |
| GitHub REST API v3 | HTTPS REST | PAT or App token (`GITHUB_TOKEN`) | 5000 req/hr; respect `X-RateLimit-*` headers |

## Components

### 1. Async Execution Controller

**Responsibility:** Manages the lifecycle of async tasks after the LLM agent produces output and overlays complete. Coordinates the transition from `RUNNING` to `AWAITING_APPROVAL`, manages the polling loop for approval signals, handles timeouts, and drives the DOING rework cycle.

**Interface:**
```
AsyncExecutionController
  startAsyncCycle(task_id, task_config, agent_output) --> void
  handleApprovalSignal(task_id, signal: ApprovalSignal) --> StateTransition
  handleRejectionSignal(task_id, signal: RejectionSignal) --> StateTransition
  checkTimeout(task_id) --> TimeoutResult
  getAsyncStatus(task_id) --> AsyncTaskStatus
```

**Dependencies:** StateManager, CollaborationEventBus, ApprovalManager, NotificationAdapter, AuditLog.

**Design notes:** This controller is instantiated by the engine when a task has `mode: "async"`. It does not replace the engine's DAG scheduler -- it augments it. The engine yields control to the controller after overlay validation passes. The controller returns control to the engine when the task reaches `COMPLETED` or `FAILED`.

---

### 2. Collaboration Adapter Layer

**Responsibility:** Defines the four abstract adapter interfaces that all collaboration tool integrations must implement. Provides adapter registration, factory resolution from config, and mock implementations for testing.

**Interfaces (4 required by NFR-001):**

```
NotificationAdapter
  postNotification(channel, message: NotificationMessage) --> MessageRef
  startListener(channel, handler: MessageHandler) --> ListenerHandle
  stopListener(handle: ListenerHandle) --> void
  parseApprovalSignal(message: RawMessage) --> ApprovalSignal | null
  parseRejectionSignal(message: RawMessage) --> RejectionSignal | null

DocumentAdapter
  createPage(space, parent, title, content_markdown) --> PageRef
  updatePage(page_ref, content_markdown) --> PageRef
  getPage(page_ref) --> PageContent
  getComments(page_ref, since?: timestamp) --> Comment[]
  postComment(page_ref, body, in_reply_to?) --> CommentRef
  deletePage(page_ref) --> void

TaskTrackingAdapter
  createEpic(project, summary, description, labels?) --> IssueRef
  createTask(project, epic_ref, summary, description, metadata?) --> IssueRef
  updateTask(issue_ref, fields: Partial<TaskFields>) --> IssueRef
  transitionTask(issue_ref, target_status: string) --> void
  getTask(issue_ref) --> TaskFields
  listTasks(project, filter?) --> TaskFields[]
  addLabel(issue_ref, label: string) --> void
  getAvailableTransitions(issue_ref) --> Transition[]

CodeReviewAdapter
  createPullRequest(repo, source_branch, target_branch, title, description) --> PRRef
  getReviewComments(pr_ref, since?: timestamp) --> ReviewComment[]
  postReviewComment(pr_ref, body, file_path?, line?) --> CommentRef
  approvePullRequest(pr_ref) --> void
  requestChanges(pr_ref, body) --> void
  mergePullRequest(pr_ref, strategy?: MergeStrategy) --> MergeResult
  getPullRequestStatus(pr_ref) --> PRStatus
  triggerPipeline(repo, branch, pipeline_name?) --> PipelineRef
  getPipelineStatus(pipeline_ref) --> PipelineStatus
```

**Dependencies:** None (pure interfaces). Implementations depend on vendor HTTP clients.

**Design notes:** All four interfaces are tool-agnostic. The method signatures, parameter types, and return types are identical whether the backend is Atlassian or GitHub (NFR-006). Each method returns a `Ref` object (containing the vendor-specific ID) that is opaque to callers. The adapter factory reads the `collaboration.adapters` config block and instantiates the correct implementations.

---

### 3. Slack Adapter

**Responsibility:** Implements `NotificationAdapter` for Slack. Posts structured messages to channels, listens for approval/rejection signals via polling, and parses structured text commands.

**Interface:** Implements `NotificationAdapter` (see above).

**Dependencies:** Slack Web API client, `SLACK_BOT_TOKEN` env var, RetryWithBackoff utility.

**Message format (outbound):**
```
[ai-sdd] Task `define-requirements` is ready for review.
Agent: BA-Agent | Artifact: https://confluence.example.com/page/12345
Approve: @ai-sdd approve define-requirements
Reject:  @ai-sdd reject define-requirements <feedback>
```

**Signal parsing (inbound):**
- Approval: `@ai-sdd approve <task-id> [optional notes]`
- Rejection: `@ai-sdd reject <task-id> <feedback text>`
- Any message not matching these patterns is silently ignored (debug log).

**Polling model:** The listener calls `conversations.history` at a configurable interval (default 5 seconds, configurable via `collaboration.slack.poll_interval_seconds`). It tracks the last-seen message timestamp (`ts`) to avoid reprocessing. Messages are deduplicated by `(user_id, task_id, signal_type)` -- the same user approving the same task twice counts once.

---

### 4. Confluence Adapter

**Responsibility:** Implements `DocumentAdapter` for Confluence Cloud. Creates and updates pages in a configured space, retrieves inline and standard comments, and posts reply comments.

**Interface:** Implements `DocumentAdapter` (see above).

**Dependencies:** Confluence REST API v2 client, `CONFLUENCE_API_TOKEN` + `CONFLUENCE_USER_EMAIL` env vars, `markdown-it` with Confluence storage format output plugin, RetryWithBackoff utility.

**Markdown-to-XHTML strategy:** Agent output is Markdown. The adapter converts it to Confluence storage format (XHTML) using `markdown-it` configured with a custom renderer that outputs Confluence-compatible markup. Supported elements: headings (h1-h6), paragraphs, bullet/numbered lists, code blocks (with `ac:structured-macro` for syntax highlighting), tables, bold, italic, links, images. Unsupported Markdown constructs (footnotes, embedded HTML) pass through as plain text with a logged warning.

**Page deduplication:** The adapter stores a mapping of `task_id --> page_id` in `.ai-sdd/sync-mappings/confluence.json`. On create, it first checks the mapping; if a page exists, it updates instead of creating a duplicate.

---

### 5. Jira Adapter

**Responsibility:** Implements `TaskTrackingAdapter` for Jira Cloud. Creates epics and sub-tasks, performs Kanban state transitions, and supports the Jira-as-Code sync model.

**Interface:** Implements `TaskTrackingAdapter` (see above).

**Dependencies:** Jira REST API v3 client, `JIRA_API_TOKEN` + `JIRA_USER_EMAIL` + `JIRA_BASE_URL` env vars, RetryWithBackoff utility.

**Kanban transition mapping:** The adapter reads a configurable column mapping from the workflow YAML `collaboration.jira.column_mapping` block:
```yaml
collaboration:
  jira:
    project_key: PROJ
    column_mapping:
      AWAITING_APPROVAL: "In Review"
      APPROVED: "Ready for Dev"
      DOING: "In Progress"
      COMPLETED: "Done"
```

When transitioning, the adapter queries `GET /rest/api/3/issue/{id}/transitions` to discover available transition IDs, then posts the transition. If the target status requires an intermediate step, the adapter performs multi-hop transitions.

**Issue type mapping:** Configurable via `collaboration.jira.issue_types`:
```yaml
issue_types:
  epic: "Epic"
  task: "Story"      # or "Task", "Sub-task" -- depends on project scheme
```

---

### 6. Bitbucket Adapter

**Responsibility:** Implements `CodeReviewAdapter` for Bitbucket Cloud. Creates PRs, retrieves review comments, manages the merge flow, and triggers pipelines.

**Interface:** Implements `CodeReviewAdapter` (see above).

**Dependencies:** Bitbucket REST API 2.0 client, `BITBUCKET_APP_PASSWORD` + `BITBUCKET_USERNAME` + `BITBUCKET_WORKSPACE` env vars, RetryWithBackoff utility.

**PR lifecycle:**
1. `createPullRequest` -- POST to `/2.0/repositories/{workspace}/{repo}/pullrequests`
2. `getReviewComments` -- GET comments with `?since` for incremental fetch
3. `mergePullRequest` -- POST merge with configurable strategy (merge commit, squash, fast-forward)
4. `triggerPipeline` -- POST to `/2.0/repositories/{workspace}/{repo}/pipelines/`

---

### 7. GitHub Adapters [MVP2]

**Responsibility:** Implements `TaskTrackingAdapter` (via GitHub Issues + Projects) and `CodeReviewAdapter` (via GitHub PRs + Actions) using the same interfaces as the Atlassian adapters.

**Interface:** Implements `TaskTrackingAdapter` and `CodeReviewAdapter` (identical signatures to Jira and Bitbucket adapters per NFR-006).

**Dependencies:** GitHub REST API v3 / GraphQL API (for Projects v2), `GITHUB_TOKEN` env var, RetryWithBackoff utility.

**Epic simulation:** GitHub has no native Epic type. The adapter uses:
- An issue with label `epic` represents an Epic
- Child tasks get label `epic:<epic-name>` to establish parent linkage
- GitHub Projects v2 provides the board/column view (mapped via GraphQL mutations)
- Milestones optionally group epics for release tracking

**Portability guarantee (NFR-006):** The GitHub `TaskTrackingAdapter` implementation passes the same integration test suite as the Jira implementation. The test suite is parameterized by adapter type. A workflow YAML switches backends by changing only:
```yaml
collaboration:
  task_tracking:
    adapter: github  # was: jira
    github:
      owner: my-org
      repo: my-repo
```

---

### 8. Approval Manager

**Responsibility:** Collects approval and rejection signals from the notification adapter, enforces deduplication (one vote per stakeholder per task), checks thresholds, and triggers state transitions.

**Interface:**
```
ApprovalManager
  recordApproval(task_id, stakeholder_id, notes?) --> ApprovalResult
  recordRejection(task_id, stakeholder_id, feedback) --> RejectionResult
  getApprovalStatus(task_id) --> { count: number, required: number, stakeholders: string[] }
  isThresholdMet(task_id) --> boolean
  reset(task_id) --> void   (called on rework cycle start)
```

**Dependencies:** StateManager (reads/writes approval signals in TaskState), AuditLog.

**Threshold resolution:** `min_approvals` is resolved via the standard 4-layer merge: ENGINE_TASK_DEFAULTS (default: 1) --> workflow `defaults.min_approvals` --> task library template --> task inline `min_approvals`. A value of 0 means auto-advance (no approval needed).

**Deduplication:** Approvals are stored as `{ stakeholder_id, timestamp, notes }` in `TaskState.approval_signals[]`. Before recording, the manager checks if `stakeholder_id` already exists in the array for the current approval cycle. Duplicate signals are logged at INFO level and discarded.

---

### 9. Jira-as-Code Sync Engine

**Responsibility:** Implements the bidirectional (code-wins) sync between workflow YAML task definitions and external issue trackers. Shared by Jira (FR-010) and GitHub (FR-018).

**Interface:**
```
AsCodeSyncEngine
  sync(workflow: WorkflowConfig, adapter: TaskTrackingAdapter) --> SyncReport
  getMappings() --> TaskToIssueMapping[]
  loadMappings(path: string) --> void
  saveMappings(path: string) --> void
```

**Dependencies:** TaskTrackingAdapter (injected -- Jira or GitHub), filesystem (mapping file persistence).

**Sync algorithm:**
1. Load current mappings from `.ai-sdd/sync-mappings/<adapter-type>.json`
2. For each task in workflow YAML:
   a. Compute `content_hash = SHA-256(JSON.stringify(normalize(task_definition)))`
   b. Look up mapping by `task_id`
   c. If no mapping: call `adapter.createEpic` or `adapter.createTask`, store mapping with hash
   d. If mapping exists and `stored_hash !== content_hash`: call `adapter.updateTask`, update stored hash
   e. If mapping exists and hashes match: skip (idempotent)
3. For each mapping with no corresponding task in YAML:
   a. Call `adapter.addLabel(issue_ref, "orphaned-from-code")`
   b. Log warning: `"Issue {key} orphaned -- task {id} removed from workflow"`
   c. Do NOT delete the issue
4. Write updated mappings atomically (tmp+rename)
5. Return `SyncReport` with counts: created, updated, orphaned, unchanged

**Mapping file format:**
```json
{
  "schema_version": "1",
  "adapter_type": "jira",
  "project_key": "PROJ",
  "synced_at": "2026-03-11T10:00:00.000Z",
  "mappings": [
    {
      "task_id": "define-requirements",
      "issue_key": "PROJ-42",
      "issue_type": "Epic",
      "content_hash": "sha256:abc123...",
      "created_at": "2026-03-10T09:00:00.000Z",
      "updated_at": "2026-03-11T10:00:00.000Z"
    }
  ]
}
```

---

### 10. Collaboration Event Bus

**Responsibility:** Internal pub/sub bus that decouples adapter events from engine logic. Adapters publish events (approval received, comment posted, pipeline completed); the engine, audit log, and other consumers subscribe.

**Interface:**
```
CollaborationEventBus
  publish(event: CollaborationEvent) --> void
  subscribe(event_type: string, handler: EventHandler) --> Unsubscribe
  subscribeAll(handler: EventHandler) --> Unsubscribe
```

**Event types:**
```
collab.approval.received
collab.rejection.received
collab.comment.posted
collab.page.created
collab.page.updated
collab.pr.created
collab.pr.merged
collab.pr.comment
collab.pipeline.completed
collab.sync.completed
collab.timeout.expired
```

**Dependencies:** None (pure in-process event emitter). Integrates with the existing `ObservabilityEventEmitter` by forwarding events prefixed with `collab.*`.

---

### 11. Audit Log (State Transition Auditability)

**Responsibility:** Append-only log of all state transitions with full context, satisfying NFR-003.

**Interface:**
```
AsyncAuditLog
  record(entry: AuditEntry) --> void
  queryByTask(task_id: string) --> AuditEntry[]
  queryByTimeRange(from: string, to: string) --> AuditEntry[]
  getAll() --> AuditEntry[]
```

**Storage:** JSONL file at `.ai-sdd/sessions/<session>/audit-log.jsonl`. Each line is a JSON object. Append-only: the file is opened in append mode, never truncated or rewritten.

**Entry schema:**
```json
{
  "timestamp": "2026-03-11T10:00:00.123Z",
  "task_id": "define-requirements",
  "previous_state": "AWAITING_APPROVAL",
  "new_state": "APPROVED",
  "actor": "stakeholder:po-1@example.com",
  "trigger_source": "slack:C01ABC123/1710151200.001",
  "metadata": {
    "approval_count": 2,
    "required_approvals": 2
  }
}
```

---

### 12. Retry and HTTP Client Utilities

**Responsibility:** Shared retry-with-backoff logic and HTTP client wrapper used by all collaboration adapters.

**Interface:**
```
RetryWithBackoff
  execute<T>(fn: () => Promise<T>, options?: RetryOptions) --> Promise<T>

CollaborationHttpClient
  get(url, headers?) --> Response
  post(url, body, headers?) --> Response
  put(url, body, headers?) --> Response
  delete(url, headers?) --> Response
```

**Retry policy (NFR-005):** Max 3 retries, initial backoff 1s, multiplier 2x (delays: 1s, 2s, 4s). Retries on HTTP 429, 500, 502, 503, 504 only. Non-transient 4xx errors fail immediately. Respects `Retry-After` header when present (overrides calculated backoff).

## Data Model

### Extended TaskState

```
TaskState (extended)
  status: TaskStatus           -- now includes AWAITING_APPROVAL, APPROVED, DOING
  mode: "sync" | "async"       -- task execution mode
  async_phase: number          -- current approval cycle number (1, 2, 3...)
  approval_signals: ApprovalSignal[]
  rejection_signals: RejectionSignal[]
  collaboration_refs: {
    slack_message_ts?: string
    confluence_page_id?: string
    jira_issue_key?: string
    pr_id?: string
    pipeline_run_id?: string
  }
  approval_timeout_at?: string -- ISO 8601 deadline for AWAITING_APPROVAL
  ... (existing fields unchanged)
```

### ApprovalSignal

```
ApprovalSignal
  stakeholder_id: string       -- unique identifier (email or Slack user ID)
  timestamp: string            -- ISO 8601
  source: string               -- "slack:<channel_id>/<message_ts>"
  notes?: string               -- optional approval notes
```

### RejectionSignal

```
RejectionSignal
  stakeholder_id: string
  timestamp: string
  source: string
  feedback: string             -- required feedback text for rework
```

### CollaborationConfig (workflow YAML extension)

```yaml
collaboration:
  enabled: true
  slack:
    channel: "#ai-sdd-workflow"
    bot_mention: "@ai-sdd"
    poll_interval_seconds: 5
  confluence:
    space_key: "PROJ"
    parent_page_title: "Specifications"
  jira:
    project_key: "PROJ"
    column_mapping:
      AWAITING_APPROVAL: "In Review"
      APPROVED: "Ready for Dev"
      DOING: "In Progress"
      COMPLETED: "Done"
    issue_types:
      epic: "Epic"
      task: "Story"
  bitbucket:
    workspace: "my-workspace"
    repo_slug: "my-repo"
    target_branch: "master"
    merge_strategy: "squash"
  # MVP2:
  github:
    owner: "my-org"
    repo: "my-repo"
    target_branch: "main"
  adapters:
    notification: slack
    document: confluence
    task_tracking: jira       # or: github (MVP2)
    code_review: bitbucket    # or: github (MVP2)
```

### TaskConfig Extension

```yaml
tasks:
  define-requirements:
    mode: async                      # "sync" (default) or "async"
    min_approvals: 2                 # overrides workflow default
    approval_timeout_seconds: 86400  # 24 hours; 0 = no timeout
    agent: business-analyst
    # ... existing fields unchanged
```

### Jira-as-Code Sync Mapping

```
TaskToIssueMapping
  task_id: string
  issue_key: string            -- "PROJ-42" or GitHub issue number
  issue_type: string           -- "Epic", "Story", etc.
  content_hash: string         -- "sha256:<hex>"
  created_at: string
  updated_at: string
  orphaned: boolean            -- true if task removed from YAML
```

### State Transition Diagram (Jira Column Mapping)

```
ai-sdd State          Jira/GitHub Column    Trigger
--------------        ------------------    --------------------------
PENDING               Backlog               Task created in workflow
RUNNING               In Progress           Engine starts task
AWAITING_APPROVAL     In Review             Agent output produced
APPROVED              Ready for Dev         Threshold met
DOING                 In Progress           Rework or next phase
COMPLETED             Done                  Final approval
FAILED                Blocked               Timeout or unrecoverable error
```

## NFR Coverage

| NFR | Title | Implementation Mechanism |
|---|---|---|
| NFR-001 | Adapter Pluggability | Four abstract TypeScript interfaces (`NotificationAdapter`, `DocumentAdapter`, `TaskTrackingAdapter`, `CodeReviewAdapter`). Adapter factory resolves implementation from `collaboration.adapters` config. Adding a new adapter requires zero changes to engine or existing adapters. Mock implementations provided for all four interfaces. |
| NFR-002 | Credential Security | All credentials sourced from environment variables (`SLACK_BOT_TOKEN`, `CONFLUENCE_API_TOKEN`, `JIRA_API_TOKEN`, `BITBUCKET_APP_PASSWORD`, `GITHUB_TOKEN`). Startup validation checks presence of all required env vars for configured adapters; fails fast with a clear error naming the missing variable. Credential values are registered with the existing `src/security/` log sanitizer and redacted to `[REDACTED]` in all log output. |
| NFR-003 | State Transition Auditability | `AsyncAuditLog` writes append-only JSONL entries for every state transition. Each entry contains ISO 8601 timestamp (ms precision), task_id, previous_state, new_state, actor, trigger_source, and metadata. Queryable by task_id and time range. File is never truncated. Integrates with existing `ObservabilityEventEmitter`. |
| NFR-004 | Slack Message Latency | Outbound notifications dispatched immediately on state transition (no batching). Inbound polling at 5-second intervals (configurable). End-to-end path: Slack poll (5s max) + parse (< 100ms) + state transition (< 100ms) = well within 15s NFR. HTTP client timeout set to 3 seconds per Slack API call. |
| NFR-005 | External API Retry | Shared `RetryWithBackoff` utility used by all four adapter implementations. Policy: max 3 retries, 1s/2s/4s exponential backoff. Retries only on HTTP 429, 500, 502, 503, 504. Respects `Retry-After` header. Non-transient errors (4xx except 429) fail immediately. Each retry attempt logged with attempt number, status code, and next delay. Full error chain surfaced to orchestrator on exhaustion. |
| NFR-006 | Adapter Interface Portability | Jira and GitHub adapters implement identical `TaskTrackingAdapter` interface. Bitbucket and GitHub adapters implement identical `CodeReviewAdapter` interface. A shared parameterized integration test suite runs against both implementations. Workflow YAML switches backend by changing only the `collaboration.adapters` and adapter-specific config block -- zero changes to task definitions, dependencies, or state machine. |

## Key Architectural Decisions

### ADR-001: Extend Existing State Machine (Not Parallel)

**Context:** The async task lifecycle needs states (AWAITING_APPROVAL, APPROVED, DOING) that do not exist in the current engine. Two approaches: (a) extend `TaskStatus` and `VALID_TRANSITIONS` with new states, or (b) run a separate async state machine alongside the existing one.

**Decision:** Extend the existing state machine.

**Rationale:**
- The stakeholder explicitly flagged concern about state machine complexity: "if state machine adds a lot of complexity and has lots of touch points, let me know and we can rethink."
- A parallel state machine creates two sources of truth for task status, requiring synchronization logic, dual persistence, and dual query paths.
- The existing `VALID_TRANSITIONS` map is the enforcement point for all transitions. Adding entries to it is a minimal, well-understood change.
- Sync tasks never enter the new states, so backward compatibility is preserved. The `mode` field gates which transition paths are valid.
- The existing `StateManager` with its atomic persistence pattern handles the extended states without modification to the persistence mechanism.

**Consequences:** The `TaskStatus` type union grows from 7 to 10 members. All `switch` statements on `TaskStatus` must handle the new cases (TypeScript exhaustiveness checking enforces this). Status display commands must render the new states.

---

### ADR-002: Slack Polling Over WebSocket

**Context:** The Slack listener can use either REST API polling (`conversations.history`) or WebSocket (Slack Socket Mode / RTM).

**Decision:** REST API polling with configurable interval.

**Rationale:**
- The stakeholder said "keep it simple for now, minimal integration."
- Socket Mode requires a Slack App with additional OAuth scopes (`connections:write`), an always-on WebSocket connection, and reconnection logic.
- Polling is stateless, trivially testable, and the 5-second default interval meets NFR-004 (10-second detection latency).
- Polling can be upgraded to Socket Mode later by swapping the listener implementation without changing the `NotificationAdapter` interface.

**Consequences:** Higher latency than WebSocket (up to `poll_interval` seconds). Acceptable per NFR-004. Slightly higher API usage, but well within Slack rate limits for a single channel.

---

### ADR-003: Collaboration Adapters Are Separate From LLM Adapters

**Context:** ai-sdd already has a `RuntimeAdapter` base class for LLM dispatch (Claude Code, OpenAI, mock). Collaboration tools (Slack, Confluence, Jira, Bitbucket) also need adapters.

**Decision:** Create a separate adapter hierarchy for collaboration tools, not extending `RuntimeAdapter`.

**Rationale:**
- `RuntimeAdapter` is concerned with LLM task dispatch: it takes an `AgentContext` and returns a `TaskResult`. Collaboration adapters are concerned with CRUD operations on external tools (post a message, create an issue, merge a PR).
- Different retry semantics: LLM adapters retry on model errors; collaboration adapters retry on HTTP errors with `Retry-After` support.
- Different configuration: LLM adapters are configured via `adapter.type` in `ai-sdd.yaml`; collaboration adapters are configured via the `collaboration` block in workflow YAML.
- Mixing concerns would violate single-responsibility and make the adapter interface unwieldy.

**Consequences:** Two adapter hierarchies to maintain. The engine needs awareness of both. The `collaboration.adapters` config block determines which collaboration adapters are active.

---

### ADR-004: Content Hash for Jira-as-Code Conflict Detection

**Context:** When syncing code to Jira, the system must detect whether a Jira issue needs updating. Three options: (a) field-level diff (compare each field individually), (b) timestamp comparison (compare `updated_at`), (c) content hash (SHA-256 of normalized task definition).

**Decision:** Content hash comparison using SHA-256.

**Rationale:**
- Field-level diff is fragile: Jira reformats descriptions (Markdown to ADF), adds whitespace, and normalizes certain fields. Comparing raw field values produces false positives.
- Timestamp comparison fails when Jira and the local system have clock skew, or when Jira API responses are cached.
- A SHA-256 hash of `JSON.stringify(normalize(task_definition))` is deterministic, fast, and independent of Jira's formatting. The normalization step sorts keys and strips non-synced fields.
- The hash is stored in the mapping file and compared locally -- no Jira API call needed to detect "no change."

**Consequences:** Any change to the task definition (even cosmetic, like reordering YAML keys) triggers an update. This is acceptable because the normalization step (sorted keys, trimmed whitespace) minimizes false positives, and updates are idempotent.

---

### ADR-005: Markdown-to-Confluence Storage Format via markdown-it

**Context:** Agents produce Markdown. Confluence stores pages in XHTML storage format. Three options: (a) Confluence REST API conversion endpoint, (b) Pandoc binary, (c) JavaScript Markdown parser with custom renderer.

**Decision:** Use `markdown-it` with a custom Confluence storage format renderer.

**Rationale:**
- The Confluence REST API has a content conversion endpoint, but it is rate-limited and adds a network round-trip per page create/update.
- Pandoc is a Haskell binary -- adding a system dependency contradicts the Bun+TypeScript-only runtime constraint.
- `markdown-it` is a pure JavaScript library with a pluggable renderer architecture. A custom renderer that outputs Confluence XHTML (e.g., `<ac:structured-macro>` for code blocks) keeps conversion local, fast, and testable.
- The conversion only needs to handle standard Markdown constructs that agents produce (headings, lists, code blocks, tables, links). Complex Confluence macros are out of scope.

**Consequences:** Some Confluence-specific formatting (info panels, expand macros, Jira issue links) cannot be generated from standard Markdown. This is acceptable for MVP; agents can be taught to emit raw Confluence macros in fenced blocks if needed later.

## Open Decisions Resolved

### 1. State machine: extend existing or run parallel?

**Resolution: Extend the existing state machine.**

See ADR-001 above. Three new states (`AWAITING_APPROVAL`, `APPROVED`, `DOING`) are added to the `TaskStatus` type and `VALID_TRANSITIONS` map. The `mode` field on `TaskConfig` gates which transitions are valid for a given task. Sync tasks never enter async states. This approach has fewer touch points than a parallel machine: only `src/types/index.ts` (type + transitions map), `src/core/state-manager.ts` (new transition validation), and the new `AsyncExecutionController` are affected. The existing overlay chain, DAG scheduler, and persistence layer require no structural changes.

### 2. Slack interaction model: text commands vs reactions vs buttons?

**Resolution: Structured text commands.**

Format: `@ai-sdd approve <task-id> [optional notes]` and `@ai-sdd reject <task-id> <feedback text>`. This is the simplest model that satisfies the requirements. It requires no Slack App interactive features (buttons, modals, block kit), no additional OAuth scopes beyond `chat:write` and `channels:history`, and is trivially parseable with a regex. The outbound notification message includes the exact command syntax so stakeholders can copy-paste. Reactions and buttons can be added in a post-MVP iteration by extending the `parseApprovalSignal` method without changing the adapter interface.

### 3. Confluence storage format: Markdown-to-XHTML conversion strategy?

**Resolution: `markdown-it` with custom Confluence storage format renderer.**

See ADR-005 above. The renderer handles: headings (`<h1>`-`<h6>`), paragraphs, unordered/ordered lists, code blocks (`<ac:structured-macro ac:name="code">`), tables (`<table>`), bold/italic, links (`<a>`), and images (`<ac:image>`). The conversion runs in-process with zero external dependencies. Edge cases that cannot be cleanly converted (embedded raw HTML, footnotes) are passed through as escaped text with a warning logged.

### 4. Jira-as-Code conflict detection: hash vs timestamp vs field-level diff?

**Resolution: SHA-256 content hash comparison.**

See ADR-004 above. Each task definition is normalized (keys sorted, whitespace trimmed, non-synced metadata stripped) and hashed. The hash is stored in the sync mapping file alongside the Jira issue key. On each sync cycle, the current hash is compared to the stored hash. If they match, no API call is made. If they differ, the issue is updated and the new hash is stored. This approach is deterministic, offline-capable (no Jira read needed to detect changes), and idempotent.

### 5. Timeout behaviour for AWAITING_APPROVAL?

**Resolution: Configurable timeout with Slack escalation notification, then transition to FAILED.**

The `approval_timeout_seconds` field (per-task or workflow default) specifies the maximum time a task may remain in `AWAITING_APPROVAL`. When the timeout expires:
1. A Slack notification is posted to the configured channel: `"[ai-sdd] TIMEOUT: Task '{task-id}' has been awaiting approval for {hours}h. Escalating. Required approvals: {n}, received: {m}."`
2. The task transitions to `FAILED` with error `"Approval timeout after {n} seconds"`.
3. The audit log records the timeout with trigger_source `"engine:timeout"`.

A value of `0` means no timeout (indefinite wait). The default is `0` (no timeout) to avoid surprising existing workflows. Teams that want timeout behaviour must explicitly configure it. This is the safest default: an indefinite wait can be manually resolved, whereas an auto-reject could discard valid work. The stakeholder can re-run the task after investigating the timeout.

### 6. Deployment pipeline scope (confirm out of scope)?

**Resolution: Confirmed out of scope for MVP 1 and MVP 2.**

Auto-triggered deployment pipelines (CI, SIT, canary, prod), metric collection, and automated smoke tests are explicitly post-MVP per the constitution and requirements index. The `CodeReviewAdapter.triggerPipeline` method is included in the interface to support the Bitbucket Pipeline trigger (FR-012, SHOULD priority), which covers only the immediate post-merge CI run -- not the full deployment pipeline. The method signature is intentionally minimal (`triggerPipeline(repo, branch, pipeline_name?) --> PipelineRef`) so it can be extended for deployment orchestration in a future release without breaking the interface.

## Infrastructure Topology

No new infrastructure services are introduced. The ai-sdd engine runs as a single Bun process on the developer's machine (or CI runner). All collaboration tool interactions are outbound HTTPS calls to vendor-hosted APIs (Slack, Confluence, Jira, Bitbucket, GitHub).

```
+-------------------------------------------------------------------+
|  Developer Machine / CI Runner                                    |
|                                                                   |
|  +-----------------------------------------------------------+   |
|  |  ai-sdd Engine (Bun process)                              |   |
|  |                                                           |   |
|  |  +------------------+  +------------------+               |   |
|  |  | Workflow Engine  |  | Async Execution  |               |   |
|  |  | (existing)       |  | Controller (new) |               |   |
|  |  +------------------+  +------------------+               |   |
|  |                                                           |   |
|  |  +------------------+  +------------------+               |   |
|  |  | Collab Adapters  |  | Sync Engine      |               |   |
|  |  | (Slack, Conf,    |  | (Jira-as-Code)   |               |   |
|  |  |  Jira, BB, GH)   |  +------------------+               |   |
|  |  +--------+---------+                                     |   |
|  +-----------|-----------------------------------------------+   |
|              | HTTPS                                             |
+--------------+---------------------------------------------------+
               |
    +----------+-----------+
    |          |           |
+---v---+ +---v----+ +----v---+
| Slack | | Atlass.| | GitHub |
| API   | | Cloud  | | API    |
|       | | (Conf, | |        |
|       | |  Jira, | |        |
|       | |  BB)   | |        |
+-------+ +--------+ +--------+
```

**No Docker services.** The ai-sdd engine is not containerized in its current architecture (it runs via `bun run`). If containerization is needed in the future, a single Dockerfile with the Bun base image suffices. The collaboration adapters make outbound HTTPS calls and do not require inbound network listeners (no webhook endpoints needed -- Slack uses polling).

## Auth Strategy

All authentication is credential-based using API tokens sourced from environment variables. No OAuth flows, no session management, no user authentication within ai-sdd itself.

| Tool | Env Variable(s) | Auth Method | Scope |
|---|---|---|---|
| Slack | `SLACK_BOT_TOKEN` | Bot token (xoxb-*) | `chat:write`, `channels:history`, `channels:read` |
| Confluence | `CONFLUENCE_API_TOKEN`, `CONFLUENCE_USER_EMAIL`, `CONFLUENCE_BASE_URL` | Basic auth (email:token) | Read/write pages and comments in configured space |
| Jira | `JIRA_API_TOKEN`, `JIRA_USER_EMAIL`, `JIRA_BASE_URL` | Basic auth (email:token) | Read/write issues and transitions in configured project |
| Bitbucket | `BITBUCKET_APP_PASSWORD`, `BITBUCKET_USERNAME`, `BITBUCKET_WORKSPACE` | Basic auth (username:app_password) | Read/write repos, PRs, pipelines in configured workspace |
| GitHub | `GITHUB_TOKEN` | HTTP Authorization header (PAT or App installation token) | `repo`, `project` scopes |

**Startup validation:** On engine startup, the `CollaborationAdapterFactory` checks that all required env vars for the configured adapters are set. If any are missing, the engine fails fast with a clear error:
```
Error: Missing required environment variable JIRA_API_TOKEN for configured Jira adapter.
Set it via: export JIRA_API_TOKEN=<your-token>
```

**Credential redaction:** All credential env var names are registered with `src/security/log-sanitizer.ts` at startup. Any log output containing a credential value is automatically redacted to `[REDACTED]`. This extends the existing ai-sdd secret scanning mechanism (which already catches patterns like `xoxb-*`, API key formats, etc.).

**No OAuth:** OAuth flows (e.g., Slack OAuth for workspace installation) are out of scope. The operator provides pre-created tokens. This aligns with the "keep it simple" constraint and avoids the need for a callback server.
