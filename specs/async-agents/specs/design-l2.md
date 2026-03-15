# L2 Component Design -- Async/Hybrid Workflow Collaboration for ai-sdd

## Summary

This document details the L2 component design for the async/hybrid workflow collaboration feature. It covers the four shared adapter interfaces with full TypeScript signatures, the core components (AsyncTaskManager, ApprovalManager, AsCodeSyncEngine, CollaborationAdapterFactory), all MVP1 and MVP2 adapter implementations, key data flows, configuration schema, error handling strategy, and testing approach. All designs extend the existing ai-sdd patterns (Bun + TypeScript strict, Zod validation, atomic persistence) and preserve full backward compatibility.

## Component Inventory

| # | Component | Layer | MVP | FR Coverage |
|---|-----------|-------|-----|-------------|
| 1 | AsyncTaskManager | Core Engine | 1 | FR-001, FR-002, FR-003 |
| 2 | ApprovalManager | Core Engine | 1 | FR-005, FR-013 |
| 3 | AsCodeSyncEngine | Core Engine | 1 | FR-010, FR-018 |
| 4 | CollaborationAdapterFactory | Core Engine | 1 | NFR-001, NFR-006 |
| 5 | CollaborationEventBus | Core Engine | 1 | NFR-003 |
| 6 | AsyncAuditLog | Observability | 1 | NFR-003 |
| 7 | RetryWithBackoff / CollabHttpClient | Infrastructure | 1 | NFR-005 |
| 8 | SlackNotificationAdapter | Adapter | 1 | FR-004, FR-005 |
| 9 | ConfluenceDocumentAdapter | Adapter | 1 | FR-006, FR-007 |
| 10 | JiraTaskTrackingAdapter | Adapter | 1 | FR-008, FR-009, FR-010 |
| 11 | BitbucketCodeReviewAdapter | Adapter | 1 | FR-011, FR-012 |
| 12 | GitHubTaskTrackingAdapter | Adapter | 2 | FR-015, FR-017, FR-018 |
| 13 | GitHubCodeReviewAdapter | Adapter | 2 | FR-016 |
| 14 | MockNotificationAdapter | Testing | 1 | -- |
| 15 | MockDocumentAdapter | Testing | 1 | -- |
| 16 | MockTaskTrackingAdapter | Testing | 1 | -- |
| 17 | MockCodeReviewAdapter | Testing | 1 | -- |
| 18 | NotificationChannel | Adapter (interface) | 1 | FR-004, NFR-006 |
| 19 | SlackNotificationChannel | Adapter (impl) | 1 | FR-004, FR-005 |
| 20 | MockNotificationChannel | Testing | 1 | -- |
| 21 | ConfluenceSyncManager | Core Engine | 1 | FR-006, FR-007 |
| 22 | JiraHierarchySync | Core Engine | 1 | FR-008, FR-009, FR-010 |

## Adapter Interfaces

All adapters return `Result<T, AdapterError>` to make error handling explicit. Ref types are opaque -- callers never inspect vendor-specific IDs.

### Shared Types

```typescript
// src/collaboration/types.ts

type Result<T, E = AdapterError> = { ok: true; value: T } | { ok: false; error: E };

interface AdapterError {
  code: "AUTH" | "RATE_LIMIT" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "NETWORK" | "UNKNOWN";
  message: string;
  retryable: boolean;
  cause?: unknown;
}

interface MessageRef { provider: string; id: string; channel: string; timestamp: string; }
interface PageRef { provider: string; id: string; url: string; version: number; }
interface IssueRef { provider: string; key: string; id: string; url: string; }
interface PRRef { provider: string; id: string; url: string; repo: string; }
interface PipelineRef { provider: string; id: string; url: string; }
interface CommentRef { provider: string; id: string; }

interface ApprovalSignal {
  stakeholder_id: string;
  timestamp: string;       // ISO 8601
  source: string;          // "slack:<channel>/<ts>"
  notes?: string;
}

interface RejectionSignal {
  stakeholder_id: string;
  timestamp: string;
  source: string;
  feedback: string;        // required
}

type CollaborationEventType =
  | "collab.approval.received"
  | "collab.rejection.received"
  | "collab.comment.posted"
  | "collab.page.created"
  | "collab.page.updated"
  | "collab.pr.created"
  | "collab.pr.merged"
  | "collab.pr.comment"
  | "collab.pipeline.completed"
  | "collab.sync.completed"
  | "collab.timeout.expired";

interface CollaborationEvent {
  type: CollaborationEventType;
  task_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
```

### NotificationAdapter

```typescript
// src/collaboration/adapters/notification-adapter.ts

interface NotificationMessage {
  task_id: string;
  title: string;
  body: string;
  action_hints?: { approve_cmd: string; reject_cmd: string };
  artifact_url?: string;
}

type MessageHandler = (signal: ApprovalSignal | RejectionSignal) => void;
type ListenerHandle = { id: string; stop: () => Promise<void> };

interface NotificationAdapter {
  readonly provider: string;

  postNotification(channel: string, message: NotificationMessage): Promise<Result<MessageRef>>;
  startListener(channel: string, handler: MessageHandler): Promise<Result<ListenerHandle>>;
  stopListener(handle: ListenerHandle): Promise<void>;
  parseApprovalSignal(raw: RawSlackMessage): ApprovalSignal | null;
  parseRejectionSignal(raw: RawSlackMessage): RejectionSignal | null;
  healthCheck(): Promise<Result<void>>;
}
```

### DocumentAdapter

```typescript
// src/collaboration/adapters/document-adapter.ts

interface PageContent {
  ref: PageRef;
  title: string;
  body_markdown: string;   // converted back from storage format
  body_storage: string;    // raw storage format (XHTML)
  last_updated: string;
}

interface Comment {
  id: string;
  author: string;
  body: string;
  created_at: string;
  in_reply_to?: string;
  resolved: boolean;
}

interface DocumentAdapter {
  readonly provider: string;

  createPage(space: string, parentTitle: string, title: string, contentMd: string): Promise<Result<PageRef>>;
  updatePage(ref: PageRef, contentMd: string): Promise<Result<PageRef>>;
  getPage(ref: PageRef): Promise<Result<PageContent>>;
  getComments(ref: PageRef, since?: string): Promise<Result<Comment[]>>;
  postComment(ref: PageRef, body: string, inReplyTo?: string): Promise<Result<CommentRef>>;
  deletePage(ref: PageRef): Promise<Result<void>>;
  healthCheck(): Promise<Result<void>>;
}
```

### TaskTrackingAdapter

```typescript
// src/collaboration/adapters/task-tracking-adapter.ts

interface TaskFields {
  key: string;
  summary: string;
  description: string;
  status: string;
  issue_type: string;
  labels: string[];
  assignee?: string;
  parent_key?: string;       // epic key
  custom_fields?: Record<string, unknown>;
}

interface Transition { id: string; name: string; to_status: string; }

interface TaskTrackingAdapter {
  readonly provider: string;

  createEpic(project: string, summary: string, description: string, labels?: string[]): Promise<Result<IssueRef>>;
  createTask(project: string, epicRef: IssueRef | null, summary: string, description: string, metadata?: Partial<TaskFields>): Promise<Result<IssueRef>>;
  updateTask(ref: IssueRef, fields: Partial<TaskFields>): Promise<Result<IssueRef>>;
  transitionTask(ref: IssueRef, targetStatus: string): Promise<Result<void>>;
  getTask(ref: IssueRef): Promise<Result<TaskFields>>;
  listTasks(project: string, filter?: { labels?: string[]; status?: string }): Promise<Result<TaskFields[]>>;
  addLabel(ref: IssueRef, label: string): Promise<Result<void>>;
  getAvailableTransitions(ref: IssueRef): Promise<Result<Transition[]>>;
  healthCheck(): Promise<Result<void>>;
}
```

### CodeReviewAdapter

```typescript
// src/collaboration/adapters/code-review-adapter.ts

type MergeStrategy = "merge" | "squash" | "fast-forward";
type PRStatus = "open" | "merged" | "declined" | "superseded";
type PipelineStatus = "pending" | "running" | "passed" | "failed" | "stopped";

interface ReviewComment {
  id: string;
  author: string;
  body: string;
  file_path?: string;
  line?: number;
  created_at: string;
}

interface MergeResult { merged: boolean; commit_hash?: string; error?: string; }

interface CodeReviewAdapter {
  readonly provider: string;

  createPullRequest(repo: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<Result<PRRef>>;
  getReviewComments(ref: PRRef, since?: string): Promise<Result<ReviewComment[]>>;
  postReviewComment(ref: PRRef, body: string, filePath?: string, line?: number): Promise<Result<CommentRef>>;
  approvePullRequest(ref: PRRef): Promise<Result<void>>;
  requestChanges(ref: PRRef, body: string): Promise<Result<void>>;
  mergePullRequest(ref: PRRef, strategy?: MergeStrategy): Promise<Result<MergeResult>>;
  getPullRequestStatus(ref: PRRef): Promise<Result<PRStatus>>;
  triggerPipeline(repo: string, branch: string, pipelineName?: string): Promise<Result<PipelineRef>>;
  getPipelineStatus(ref: PipelineRef): Promise<Result<PipelineStatus>>;
  healthCheck(): Promise<Result<void>>;
}
```

## Core Components

### 1. AsyncTaskManager

**Responsibility:** Extends the engine's task lifecycle to handle async execution. Owns the RUNNING-to-AWAITING_APPROVAL fork, the polling/timeout loop, and the DOING rework cycle. Replaces the L1's "Async Execution Controller" name for consistency with existing ai-sdd naming conventions (StateManager, ContextManager).

**Extended State Transitions:**

```
VALID_ASYNC_TRANSITIONS = {
  RUNNING:            [AWAITING_APPROVAL],
  AWAITING_APPROVAL:  [APPROVED, DOING, FAILED, CANCELLED],
  APPROVED:           [DOING],
  DOING:              [AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED],
}
```

These are merged into the existing `VALID_TRANSITIONS` map at startup. Sync tasks never enter these states -- the manager checks `task.mode` before permitting async transitions.

**Key Types:**

```typescript
// src/collaboration/core/async-task-manager.ts

interface AsyncTaskConfig {
  mode: "sync" | "async";
  min_approvals: number;            // default 1
  approval_timeout_seconds: number; // default 0 (no timeout)
}

interface AsyncTaskState {
  async_phase: number;              // current approval cycle (1, 2, 3...)
  approval_signals: ApprovalSignal[];
  rejection_signals: RejectionSignal[];
  collaboration_refs: CollaborationRefs;
  approval_timeout_at?: string;     // ISO 8601 deadline
}

interface CollaborationRefs {
  slack_message_ts?: string;
  confluence_page_id?: string;
  jira_issue_key?: string;
  pr_id?: string;
  pipeline_run_id?: string;
}

interface AsyncTaskManager {
  startAsyncCycle(taskId: string, config: AsyncTaskConfig, output: TaskOutput): Promise<void>;
  handleSignal(taskId: string, signal: ApprovalSignal | RejectionSignal): Promise<StateTransitionResult>;
  checkTimeouts(): Promise<TimeoutResult[]>;
  getAsyncStatus(taskId: string): AsyncTaskStatus;
}
```

**Config Shape (Zod):**

```typescript
const AsyncTaskConfigSchema = z.object({
  mode: z.enum(["sync", "async"]).default("sync"),
  min_approvals: z.number().int().min(0).default(1),
  approval_timeout_seconds: z.number().int().min(0).default(0),
});
```

**Error Handling:**
- Invalid transition: throws `StateError` (same as existing engine)
- Timeout expiry: emits `collab.timeout.expired` event, transitions to FAILED, posts Slack notification
- Signal for unknown task: logs warning, returns `{ ok: false, error: { code: "NOT_FOUND" } }`
- Signal for non-AWAITING_APPROVAL task: logs warning, ignores (idempotent)

**Integration with Engine:** The engine calls `asyncTaskManager.startAsyncCycle()` after overlay chain completes when `mode === "async"`. The manager registers a polling callback (via `setInterval`) that calls `checkTimeouts()` and delegates signal handling from the notification adapter's listener.

---

### 2. ApprovalManager

**Responsibility:** Collects and validates approval/rejection signals. Enforces per-stakeholder deduplication, threshold checking, and cycle-scoped state. Stateless between restarts -- reads/writes approval data from `TaskState` via `StateManager`.

**Key Types:**

```typescript
// src/collaboration/core/approval-manager.ts

interface ApprovalStatus {
  task_id: string;
  phase: number;
  received: number;
  required: number;
  stakeholders: string[];
  threshold_met: boolean;
}

interface ApprovalResult {
  accepted: boolean;           // false if duplicate
  approval_status: ApprovalStatus;
  triggered_transition?: "APPROVED" | null;
}

interface RejectionResult {
  accepted: boolean;
  feedback: string;
  triggered_transition: "DOING";
}

interface ApprovalManager {
  recordApproval(taskId: string, signal: ApprovalSignal): ApprovalResult;
  recordRejection(taskId: string, signal: RejectionSignal): RejectionResult;
  getStatus(taskId: string): ApprovalStatus;
  isThresholdMet(taskId: string): boolean;
  resetForNewCycle(taskId: string): void;
}
```

**Deduplication Logic:** Before recording, check if `stakeholder_id` already exists in `TaskState.approval_signals[]` for the current `async_phase`. Duplicates are logged at INFO and discarded. The `accepted` field in the result communicates this to callers.

**Threshold Resolution:** `min_approvals` follows the standard 4-layer merge: `ENGINE_TASK_DEFAULTS` (1) -> workflow `defaults.min_approvals` -> task library template -> task inline. Value of 0 means auto-advance (no human approval needed, useful for automated gates).

**Rejection Behavior:** Any single rejection immediately transitions the task to DOING with feedback attached, regardless of approval count. This is a "veto" model. The rejection resets the approval count for the next cycle (`resetForNewCycle`).

**Error Handling:**
- Recording signal for non-existent task: returns `{ accepted: false }` with logged warning
- Recording signal in wrong state: returns `{ accepted: false }` (no-op)

---

### 3. AsCodeSyncEngine

**Responsibility:** Bidirectional (code-wins) sync between workflow YAML tasks and external issue trackers. Parameterized by `TaskTrackingAdapter` so the same engine works with Jira (MVP1) and GitHub (MVP2).

**Key Types:**

```typescript
// src/collaboration/core/sync-engine.ts

interface TaskToIssueMapping {
  task_id: string;
  issue_key: string;
  issue_type: string;
  content_hash: string;        // "sha256:<hex>"
  created_at: string;
  updated_at: string;
  orphaned: boolean;
}

interface SyncMappingFile {
  schema_version: "1";
  adapter_type: string;
  project_key: string;
  synced_at: string;
  mappings: TaskToIssueMapping[];
}

interface SyncReport {
  created: number;
  updated: number;
  orphaned: number;
  unchanged: number;
  errors: Array<{ task_id: string; error: AdapterError }>;
}

interface AsCodeSyncEngine {
  sync(workflow: WorkflowConfig, adapter: TaskTrackingAdapter): Promise<SyncReport>;
  getMappings(): TaskToIssueMapping[];
  loadMappings(path: string): Promise<void>;
  saveMappings(path: string): Promise<void>;
}
```

**Hash Computation:**

```typescript
function computeContentHash(taskDef: Record<string, unknown>): string {
  const normalized = JSON.stringify(sortKeysDeep(stripNonSyncFields(taskDef)));
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

// Fields excluded from hash (runtime-only, not synced to tracker):
const NON_SYNC_FIELDS = ["status", "run_id", "attempt", "timestamps", "collaboration_refs"];
```

**Sync Algorithm (per L1):**

1. Load mappings from `.ai-sdd/sync-mappings/<adapter_type>.json`
2. For each workflow task: compute hash, lookup mapping, create/update/skip
3. For each mapping without a corresponding task: label as orphaned (never delete)
4. Write mappings atomically (tmp+rename via existing `atomicWrite` utility)
5. Return `SyncReport`

**Conflict Resolution:** Code always wins. If a Jira issue was manually edited, the next sync overwrites it. The hash comparison only checks the code side -- it does not read Jira to detect remote changes. This is by design (Jira-as-Code: code is the single source of truth).

**Mapping File Path:** `.ai-sdd/sync-mappings/<adapter_type>.json` (e.g., `jira.json`, `github.json`). Created on first sync. Directory created on first use.

**Error Handling:**
- Individual task sync failure: recorded in `SyncReport.errors`, does not abort the batch
- Mapping file missing: treated as empty (first sync)
- Mapping file corrupt: throws `ValidationError` with path context
- Adapter health check fails at start: aborts sync with descriptive error

---

### 4. CollaborationAdapterFactory

**Responsibility:** Instantiates and caches adapter instances from configuration. Validates required env vars at creation time (fail-fast). Provides a single entry point for all adapter resolution, including the `NotificationChannel` abstraction layer.

**Key Types:**

```typescript
// src/collaboration/core/adapter-factory.ts

interface CollaborationAdaptersConfig {
  notification: "slack" | "mock";
  document: "confluence" | "mock";
  task_tracking: "jira" | "github" | "mock";
  code_review: "bitbucket" | "github" | "mock";
}

interface CollaborationAdapterFactory {
  getNotificationAdapter(): NotificationAdapter;
  getDocumentAdapter(): DocumentAdapter;
  getTaskTrackingAdapter(): TaskTrackingAdapter;
  getCodeReviewAdapter(): CodeReviewAdapter;
  getNotificationChannel(channel: string, mentionConfig?: MentionConfig): NotificationChannel;
  validateCredentials(): Result<void>;  // fail-fast check at startup
}
```

`getNotificationChannel` wraps the underlying `NotificationAdapter` in a `SlackNotificationChannel` (or `MockNotificationChannel` when `adapters.notification = "mock"`). This is the preferred entry point for all workflow-lifecycle notification publishing, as it handles `@mention` resolution and rich formatting internally.

**Env Var Validation Matrix:**

| Adapter | Required Env Vars |
|---------|------------------|
| slack | `SLACK_BOT_TOKEN` |
| confluence | `CONFLUENCE_API_TOKEN`, `CONFLUENCE_USER_EMAIL`, `CONFLUENCE_BASE_URL` |
| jira | `JIRA_API_TOKEN`, `JIRA_USER_EMAIL`, `JIRA_BASE_URL` |
| bitbucket | `BITBUCKET_APP_PASSWORD`, `BITBUCKET_USERNAME`, `BITBUCKET_WORKSPACE` |
| github | `GITHUB_TOKEN` |
| mock | (none) |

**Credential Registration:** On adapter instantiation, all credential env var values are registered with `src/security/log-sanitizer.ts` for automatic redaction in logs.

**Caching:** Adapters are singletons per factory instance. The factory is created once per engine run.

**Error Handling:**
- Missing env var: `validateCredentials()` returns `{ ok: false, error: { code: "AUTH", message: "Missing required environment variable JIRA_API_TOKEN..." } }`
- Unknown adapter name: throws `ValidationError` during config parsing (Zod enum enforced)

---

### 5. CollaborationEventBus

**Responsibility:** In-process typed pub/sub for collaboration events. Decouples adapters from consumers (engine, audit log, observability).

```typescript
// src/collaboration/core/event-bus.ts

type EventHandler = (event: CollaborationEvent) => void;
type Unsubscribe = () => void;

interface CollaborationEventBus {
  publish(event: CollaborationEvent): void;
  subscribe(eventType: CollaborationEventType, handler: EventHandler): Unsubscribe;
  subscribeAll(handler: EventHandler): Unsubscribe;
}
```

Implemented as a thin wrapper around Node `EventEmitter`. Forwards all events to the existing `ObservabilityEventEmitter` with the `collab.*` prefix preserved.

---

### 6. RetryWithBackoff / CollabHttpClient

```typescript
// src/collaboration/infra/retry.ts

interface RetryOptions {
  maxRetries: number;       // default 3
  initialDelayMs: number;   // default 1000
  multiplier: number;       // default 2
  retryableStatuses: number[];  // default [429, 500, 502, 503, 504]
}

interface CollabHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<Result<T>>;
  post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>>;
  put<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>>;
  delete<T>(url: string, headers?: Record<string, string>): Promise<Result<T>>;
}
```

Uses Bun's native `fetch`. Respects `Retry-After` header (overrides calculated backoff). Request timeout: 10s default, 3s for Slack (per NFR-004). Each retry attempt emits an observability event with attempt number, status code, and next delay.

## Adapter Implementations

### SlackNotificationAdapter (MVP1)

**Implements:** `NotificationAdapter`

**API Mappings:**

| Method | Slack API Endpoint |
|--------|-------------------|
| `postNotification` | `POST chat.postMessage` |
| `startListener` | `GET conversations.history` (polling) |
| `stopListener` | Clears `setInterval` handle |
| `healthCheck` | `POST auth.test` |

**Polling Implementation:** `startListener` creates a `setInterval` at `poll_interval_seconds` (default 5s). Each tick calls `conversations.history` with `oldest` set to the last-seen `ts`. New messages are parsed via `parseApprovalSignal` / `parseRejectionSignal`. Matching signals are dispatched to the handler. The `ts` high-water mark is persisted in memory (lost on restart -- acceptable because the engine reloads state and re-subscribes).

**Signal Parsing (regex):**

```
Approval: /^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$/i
Rejection: /^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$/i
```

Messages not matching either pattern are silently ignored (logged at DEBUG).

**Outbound Message Format:** Structured text block with task ID, agent name, artifact URL, and copy-paste approve/reject commands. No Block Kit or interactive components.

---

### ConfluenceDocumentAdapter (MVP1)

**Implements:** `DocumentAdapter`

**API Mappings:**

| Method | Confluence API Endpoint |
|--------|------------------------|
| `createPage` | `POST /wiki/api/v2/pages` |
| `updatePage` | `PUT /wiki/api/v2/pages/{id}` (requires version increment) |
| `getPage` | `GET /wiki/api/v2/pages/{id}?body-format=storage` |
| `getComments` | `GET /wiki/api/v2/pages/{id}/footer-comments` |
| `postComment` | `POST /wiki/api/v2/footer-comments` |
| `deletePage` | `DELETE /wiki/api/v2/pages/{id}` |
| `healthCheck` | `GET /wiki/api/v2/spaces?limit=1` |

**Markdown-to-XHTML Conversion:** Uses `markdown-it` with a custom renderer plugin (`confluence-storage-renderer`). Supported mappings:

| Markdown | Confluence Storage Format |
|----------|--------------------------|
| `# Heading` | `<h1>Heading</h1>` |
| `` ```lang `` | `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">lang</ac:parameter><ac:plain-text-body><![CDATA[...]]></ac:plain-text-body></ac:structured-macro>` |
| `| table |` | `<table><tbody><tr><td>...</td></tr></tbody></table>` |
| `**bold**` | `<strong>bold</strong>` |
| `[link](url)` | `<a href="url">link</a>` |
| `![img](url)` | `<ac:image><ri:url ri:value="url" /></ac:image>` |

Unsupported constructs (footnotes, raw HTML) pass through as escaped text with a warning logged.

**Version Tracking:** Confluence requires a version number on updates. The adapter reads current version via `getPage`, increments by 1, and passes it on `updatePage`. Optimistic concurrency: if a `409 Conflict` is returned, the adapter re-reads and retries once.

**Page Dedup Mapping:** `.ai-sdd/sync-mappings/confluence.json` maps `task_id` to `page_id`. Checked before `createPage` to prevent duplicates.

---

### JiraTaskTrackingAdapter (MVP1)

**Implements:** `TaskTrackingAdapter`

**API Mappings:**

| Method | Jira API Endpoint |
|--------|------------------|
| `createEpic` | `POST /rest/api/3/issue` (type from `issue_types.epic`) |
| `createTask` | `POST /rest/api/3/issue` (with `parent` field for epic link) |
| `updateTask` | `PUT /rest/api/3/issue/{id}` |
| `transitionTask` | `POST /rest/api/3/issue/{id}/transitions` |
| `getTask` | `GET /rest/api/3/issue/{id}` |
| `listTasks` | `GET /rest/api/3/search` (JQL query) |
| `addLabel` | `PUT /rest/api/3/issue/{id}` (append to labels array) |
| `getAvailableTransitions` | `GET /rest/api/3/issue/{id}/transitions` |
| `healthCheck` | `GET /rest/api/3/myself` |

**Multi-Hop Transitions:** Jira Kanban boards may not allow direct jumps (e.g., "Backlog" to "Done"). The adapter discovers available transitions, finds a path via BFS over the transition graph, and executes hops sequentially. If no path exists, it returns `{ ok: false, error: { code: "VALIDATION", message: "No transition path from X to Y" } }`.

**Column Mapping:** Read from `collaboration.jira.column_mapping` in workflow YAML. Maps ai-sdd `TaskStatus` values to Jira board column names. The adapter resolves column names to Jira status IDs at startup via `GET /rest/api/3/status`.

**Description Formatting:** Task descriptions are sent as Atlassian Document Format (ADF). The adapter converts plain-text/Markdown descriptions to minimal ADF (paragraph nodes with text). Complex formatting is best-effort.

---

### BitbucketCodeReviewAdapter (MVP1)

**Implements:** `CodeReviewAdapter`

**API Mappings:**

| Method | Bitbucket API Endpoint |
|--------|----------------------|
| `createPullRequest` | `POST /2.0/repositories/{workspace}/{repo}/pullrequests` |
| `getReviewComments` | `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` |
| `postReviewComment` | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` |
| `approvePullRequest` | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve` |
| `requestChanges` | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/request-changes` |
| `mergePullRequest` | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge` |
| `getPullRequestStatus` | `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}` |
| `triggerPipeline` | `POST /2.0/repositories/{workspace}/{repo}/pipelines/` |
| `getPipelineStatus` | `GET /2.0/repositories/{workspace}/{repo}/pipelines/{uuid}` |
| `healthCheck` | `GET /2.0/user` |

**Merge Strategy Mapping:** `"merge"` -> `merge_strategy: "merge_commit"`, `"squash"` -> `merge_strategy: "squash"`, `"fast-forward"` -> `merge_strategy: "fast_forward"`.

**Incremental Comments:** `getReviewComments(ref, since)` filters by `created_on >= since` client-side (Bitbucket API does not support server-side date filtering on comments).

---

### GitHubTaskTrackingAdapter (MVP2)

**Implements:** `TaskTrackingAdapter`

**Epic Simulation:** GitHub has no native Epic type. The adapter models it as:
- Epic = Issue with label `epic`
- Child task = Issue with label `epic:<epic-summary-slug>`
- Board columns = GitHub Projects v2 status field (via GraphQL mutations)
- Optional: Milestones group epics for release tracking

**API Mappings:**

| Method | GitHub API |
|--------|-----------|
| `createEpic` | `POST /repos/{owner}/{repo}/issues` + add label `epic` |
| `createTask` | `POST /repos/{owner}/{repo}/issues` + add label `epic:<parent>` |
| `updateTask` | `PATCH /repos/{owner}/{repo}/issues/{number}` |
| `transitionTask` | GraphQL `updateProjectV2ItemFieldValue` (status field) |
| `getTask` | `GET /repos/{owner}/{repo}/issues/{number}` |
| `listTasks` | `GET /repos/{owner}/{repo}/issues?labels=...` |
| `addLabel` | `POST /repos/{owner}/{repo}/issues/{number}/labels` |
| `getAvailableTransitions` | GraphQL query on ProjectV2 status field options |
| `healthCheck` | `GET /user` |

---

### GitHubCodeReviewAdapter (MVP2)

**Implements:** `CodeReviewAdapter`

**API Mappings:**

| Method | GitHub API |
|--------|-----------|
| `createPullRequest` | `POST /repos/{owner}/{repo}/pulls` |
| `getReviewComments` | `GET /repos/{owner}/{repo}/pulls/{number}/comments` |
| `postReviewComment` | `POST /repos/{owner}/{repo}/pulls/{number}/comments` |
| `approvePullRequest` | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` (event: APPROVE) |
| `requestChanges` | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` (event: REQUEST_CHANGES) |
| `mergePullRequest` | `PUT /repos/{owner}/{repo}/pulls/{number}/merge` |
| `getPullRequestStatus` | `GET /repos/{owner}/{repo}/pulls/{number}` |
| `triggerPipeline` | `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` |
| `getPipelineStatus` | `GET /repos/{owner}/{repo}/actions/runs/{id}` |
| `healthCheck` | `GET /user` |

---

## New Components (Implemented in Collaboration Layer Activation)

### 18. NotificationChannel (interface)

**File:** `src/collaboration/adapters/notification-channel.ts`

**Responsibility:** Provider-agnostic abstraction for publishing workflow-lifecycle activity messages. Sits above `NotificationAdapter` — callers publish structured `ActivityMessage` objects; the channel implementation handles vendor-specific formatting, mention resolution, and retry. Enables swapping Slack for Teams or any other provider without changing call sites.

```typescript
// src/collaboration/adapters/notification-channel.ts

type ActivityEvent =
  | "workflow_started" | "workflow_completed"
  | "task_started" | "task_completed" | "task_failed" | "task_needs_rework"
  | "hil_requested" | "hil_approved" | "hil_rejected"
  | "document_published" | "document_updated"
  | "sync_completed"
  | "async_approval_requested" | "approval_received" | "rejection_received";

interface ActivityMessage {
  event: ActivityEvent;
  workflow_id: string;
  task_id?: string;
  title: string;
  body: string;
  artifact_url?: string;
  mentions?: string[];   // role keys (e.g., "pe") or raw Slack user IDs (e.g., "U01234")
}

interface MentionConfig {
  ba?: string[];
  pe?: string[];
  le?: string[];
  dev?: string[];
  reviewer?: string[];
  [role: string]: string[] | undefined;
}

interface NotificationChannel {
  readonly provider: string;
  publish(message: ActivityMessage): Promise<Result<void>>;
  healthCheck(): Promise<Result<void>>;
}
```

---

### 19. SlackNotificationChannel (impl)

**File:** `src/collaboration/impl/slack-notification-channel.ts`

**Responsibility:** Implements `NotificationChannel` for Slack. Wraps `SlackNotificationAdapter` and adds:
- Event-type → emoji prefix mapping (`:rocket:` for `workflow_started`, etc.)
- Bold title + body formatting for Slack's mrkdwn syntax
- `@mention` resolution: role keys from `MentionConfig` expand to all configured Slack user IDs; bare Slack-style IDs (`U…` / `W…`) are wrapped as `<@USER_ID>`; other handles are prefixed with `@`

**Emoji Map (partial):**
```
workflow_started  → :rocket:
task_completed    → :heavy_check_mark:
task_failed       → :x:
hil_requested     → :pause_button:
document_published → :page_facing_up:
async_approval_requested → :mailbox:
```

---

### 20. MockNotificationChannel (testing)

**File:** `src/collaboration/impl/mock-notification-channel.ts`

**Responsibility:** In-memory implementation of `NotificationChannel` for use in unit and integration tests. Records all `publish()` calls for assertion. Supports configurable error injection.

```typescript
interface MockChannelCall {
  channel: string;
  message: ActivityMessage;
}

class MockNotificationChannel implements NotificationChannel {
  readonly provider = "mock";
  calls: MockChannelCall[];
  callsFor(event: ActivityEvent): MockChannelCall[];
  reset(): void;
  injectPublishError(error: AdapterError): void;
}
```

---

### 21. ConfluenceSyncManager

**File:** `src/collaboration/core/confluence-sync-manager.ts`

**Responsibility:** Manages the full document lifecycle for Confluence — create on first publish, update on subsequent publishes. Keeps a `task_id → PageRef` mapping persisted atomically to the session directory. Also manages a workflow-level index page aggregating all task document links.

**Key Operations:**
- `publishDocument(taskId, title, contentMd)` — createPage if no mapping, updatePage if mapping exists
- `publishWorkflowIndex(workflowName, taskSummaries[])` — creates/updates a single index page; mapping key is `__workflow_index__<workflowName>`
- `loadMappings(filePath)` / `saveMappings(filePath)` — atomic persistence (`schema_version: "1"` JSON)
- `getPageRef(taskId)` — lookup without network call

**Mapping File Location:** `.ai-sdd/sessions/<session>/confluence-mappings.json`

**Conflict Handling:** Uses `PageRef.version` from the adapter response; if version mismatch on update, the adapter handles retry (CONFLICT code is retryable).

---

### 22. JiraHierarchySync

**File:** `src/collaboration/core/jira-hierarchy-sync.ts`

**Responsibility:** Manages the Jira Epic/Story/Subtask hierarchy for a workflow. Sits above `AsCodeSyncEngine` (which does flat hash-based sync) with a higher-level orchestration layer that understands task grouping.

**Hierarchy Strategy:**
- 1 Epic per workflow
- Top-level tasks (no `group` field, not depending on a shared parent) → Story under the Epic
- Group-member tasks (`group` field, or tasks sharing a single `depends_on` with 2+ other tasks) → Subtask under the Story for their group
- Multi-level nesting beyond Story/Subtask is flattened; further nesting adds Jira issue links

**Default Status Map:**
```typescript
const DEFAULT_STATUS_MAP: Record<string, string> = {
  PENDING:            "To Do",
  RUNNING:            "In Progress",
  HIL_PENDING:        "In Review",
  AWAITING_APPROVAL:  "In Review",
  APPROVED:           "In Review",
  DOING:              "In Progress",
  NEEDS_REWORK:       "In Progress",
  COMPLETED:          "Done",
  FAILED:             "Blocked",
  CANCELLED:          "Cancelled",
};
```

**Key Operations:**
- `ensureEpic(adapter, workflowName, description)` — idempotent; creates Epic on first call, returns cached ref thereafter
- `syncWorkflow(adapter, workflowConfig, epicRef)` — creates Stories + Subtasks for all workflow tasks
- `transitionForStatus(adapter, taskId, taskStatus)` — looks up mapping, calls `adapter.transitionTask`
- `loadMappings(filePath)` / `saveMappings(filePath)` / `getMappings()` — atomic persistence

**Mapping File Location:** `.ai-sdd/sessions/<session>/jira-hierarchy-mappings.json`

---

### Engine Hook Extensions

**File:** `src/core/hooks.ts` — extended `HookEvent` type and added convenience methods

Four new hook events added to `HookRegistry`:

| Hook | Fires | Extra context |
|------|-------|---------------|
| `on_task_start` | Before `task.started` emitter, before overlay chain | -- |
| `on_workflow_start` | After `workflow.started` emitter, before first task | -- |
| `on_workflow_end` | After `workflow.completed` emitter, after all tasks | `completed`, `failed`, `total_cost_usd` |
| `on_hil_requested` | When task enters `HIL_PENDING` | `hil_id`, `feedback` |

The `on_hil_requested` hook is fired with `void` (non-blocking) so the notification does not delay the HIL resolution polling loop.

---

### Collaboration Wiring in run.ts

The collaboration subsystem is wired entirely in `src/cli/commands/run.ts` (not in `engine.ts`). When `collaboration.enabled = true`, the following setup runs before the engine starts:

1. Build `CollaborationAdapterFactory`, call `validateCredentials()`
2. Create `SlackNotificationChannel` via `factory.getNotificationChannel(slackChannel, mentionConfig)` where `mentionConfig` comes from `config.collaboration.slack.mentions`
3. Create `ConfluenceSyncManager`, call `loadMappings(confluenceMappingsPath)`
4. Create `JiraHierarchySync`, call `loadMappings(jiraMappingsPath)`, then `ensureEpic + syncWorkflow` pre-run
5. Register hooks on the engine:
   - `onWorkflowStart` → post Slack "Workflow started" message
   - `onTaskStart` → post Slack "Task started" + transition Jira issue to "In Progress"
   - `onPostTask` → read task output, publish/update Confluence page, post Slack "Task completed" with Confluence URL + next-agent mentions, transition Jira to "Done"
   - `onHilRequested` → post Slack HIL notification with approver mentions
   - `onWorkflowEnd` → post Slack workflow summary, publish Confluence index page, save all mappings

## Key Data Flows

### 1. Async Task Approval Flow

```
Engine              AsyncTaskMgr       ApprovalMgr      SlackAdapter       Slack API
  |                     |                  |                 |                  |
  |--startAsyncCycle--->|                  |                 |                  |
  |                     |--postNotify----->|---------------->|--chat.postMsg--->|
  |                     |                  |                 |                  |
  |                     |  [polling loop at 5s interval]     |                  |
  |                     |                  |                 |--convs.history-->|
  |                     |                  |                 |<---messages------|
  |                     |                  |                 |                  |
  |                     |                  |<--parseSignal---|                  |
  |                     |<--handleSignal---|                 |                  |
  |                     |--recordApproval->|                 |                  |
  |                     |<--ApprovalResult-|                 |                  |
  |                     |                  |                 |                  |
  |                     | [if threshold met]                 |                  |
  |<--transition--------|                  |                 |                  |
  | AWAITING->APPROVED  |                  |                 |                  |
  | APPROVED->DOING     |                  |                 |                  |
  |                     |                  |                 |                  |
  | [if timeout]        |                  |                 |                  |
  |<--transition--------|--postNotify----->|--chat.postMsg-->|                  |
  | AWAITING->FAILED    |                  |                 |                  |
```

### 2. Document Review Cycle

```
Engine          ConfluenceAdapter     SlackAdapter      Stakeholder
  |                   |                    |                 |
  |--createPage------>|                    |                 |
  |<--PageRef---------|                    |                 |
  |                   |                    |                 |
  |--postNotify(url)--|---->-------------->|                 |
  |                   |                    |---notify------->|
  |                   |                    |                 |
  |                   |                    |  [stakeholder reviews on Confluence]
  |                   |                    |                 |
  |--getComments----->|                    |                 |
  |<--Comment[]-------|                    |                 |
  |                   |                    |                 |
  | [if comments: agent reworks]           |                 |
  |--updatePage------>|                    |                 |
  |<--PageRef(v+1)----|                    |                 |
  |                   |                    |                 |
  |                   |                    |<--"approve"-----|
  |                   |                    |                 |
  | [approval signal triggers transition]  |                 |
```

### 3. Jira-as-Code Sync

```
CLI/Engine        SyncEngine          JiraAdapter         Jira API
  |                   |                    |                  |
  |--sync(workflow)-->|                    |                  |
  |                   |--loadMappings()    |                  |
  |                   |                    |                  |
  |                   | [for each task in YAML]               |
  |                   |--computeHash()     |                  |
  |                   |                    |                  |
  |                   | [no mapping: CREATE]|                  |
  |                   |--createTask------->|--POST /issue---->|
  |                   |<--IssueRef---------|<--PROJ-42--------|
  |                   |                    |                  |
  |                   | [hash differs: UPDATE]                |
  |                   |--updateTask------->|--PUT /issue/{id}>|
  |                   |<--IssueRef---------|<--200------------|
  |                   |                    |                  |
  |                   | [hash matches: SKIP]                  |
  |                   |                    |                  |
  |                   | [orphaned mapping] |                  |
  |                   |--addLabel--------->|--PUT labels----->|
  |                   |                    |                  |
  |                   |--saveMappings()    |                  |
  |<--SyncReport------|                    |                  |
```

## Configuration Schema

```yaml
# In workflow YAML or ai-sdd.yaml

collaboration:
  enabled: true                         # master switch; false disables all

  slack:
    notify_channel: ai-sdd              # channel for workflow activity messages
    bot_mention: "@ai-sdd"             # prefix for approval signal parsing
    poll_interval_seconds: 5           # NFR-004: <=10s
    request_timeout_ms: 3000
    mentions:                          # role → Slack user IDs for @mention resolution
      ba: []                           # fill with actual Slack user IDs (e.g., ["U01ABCDEF"])
      pe: []
      le: []
      dev: []
      reviewer: []

  confluence:
    space_key: "PROJ"
    parent_page_title: "Specifications"

  jira:
    project_key: "PROJ"
    column_mapping:
      PENDING: "Backlog"
      RUNNING: "In Progress"
      AWAITING_APPROVAL: "In Review"
      APPROVED: "Ready for Dev"
      DOING: "In Progress"
      COMPLETED: "Done"
      FAILED: "Blocked"
    issue_types:
      epic: "Epic"
      task: "Story"

  bitbucket:
    workspace: "my-workspace"
    repo_slug: "my-repo"
    target_branch: "master"
    merge_strategy: "squash"            # merge | squash | fast-forward

  # MVP2
  github:
    owner: "my-org"
    repo: "my-repo"
    target_branch: "main"
    project_number: 1                   # GitHub Projects v2 board number

  adapters:
    notification: slack                 # slack | mock
    document: confluence                # confluence | mock
    task_tracking: jira                 # jira | github | mock
    code_review: bitbucket              # bitbucket | github | mock

# Per-task async config (in tasks block)
defaults:
  mode: sync                            # sync | async
  min_approvals: 1
  approval_timeout_seconds: 0           # 0 = no timeout

tasks:
  define-requirements:
    mode: async
    min_approvals: 2
    approval_timeout_seconds: 86400     # 24 hours
```

**Zod Validation Schema (top-level):**

```typescript
const CollaborationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  slack: z.object({
    notify_channel: z.string().optional(),
    bot_mention: z.string().default("@ai-sdd"),
    poll_interval_seconds: z.number().min(1).max(60).default(5),
    request_timeout_ms: z.number().min(500).max(30000).default(3000),
    mentions: z.record(z.array(z.string())).optional(),  // role → Slack user IDs
  }).optional(),
  confluence: z.object({
    space_key: z.string(),
    parent_page_title: z.string(),
  }).optional(),
  jira: z.object({
    project_key: z.string(),
    column_mapping: z.record(z.string()).optional(),
    issue_types: z.object({
      epic: z.string().default("Epic"),
      task: z.string().default("Story"),
    }).optional(),
  }).optional(),
  bitbucket: z.object({
    workspace: z.string(),
    repo_slug: z.string(),
    target_branch: z.string().default("master"),
    merge_strategy: z.enum(["merge", "squash", "fast-forward"]).default("squash"),
  }).optional(),
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    target_branch: z.string().default("main"),
    project_number: z.number().optional(),
  }).optional(),
  adapters: z.object({
    notification: z.enum(["slack", "mock"]).default("mock"),
    document: z.enum(["confluence", "mock"]).default("mock"),
    task_tracking: z.enum(["jira", "github", "mock"]).default("mock"),
    code_review: z.enum(["bitbucket", "github", "mock"]).default("mock"),
  }),
});
```

## Error Handling and Observability Strategy

### Error Classification

| Error Type | Retryable | Action | Example |
|------------|-----------|--------|---------|
| `AUTH` | No | Fail fast, log missing env var | Missing `SLACK_BOT_TOKEN` |
| `RATE_LIMIT` | Yes | Backoff per `Retry-After` | HTTP 429 from Jira |
| `NOT_FOUND` | No | Log + surface to caller | Jira issue deleted externally |
| `CONFLICT` | Yes (once) | Re-read + retry | Confluence version conflict |
| `VALIDATION` | No | Log + surface | Invalid transition path |
| `NETWORK` | Yes | Standard exponential backoff | Connection timeout |
| `UNKNOWN` | No | Log full error chain, surface | Unexpected API response |

### Observability Events

All components emit events via `CollaborationEventBus`, which forwards to the existing `ObservabilityEventEmitter`. Events follow the existing naming convention:

```
async.cycle.started      -- task enters async cycle
async.approval.received  -- valid approval signal processed
async.rejection.received -- rejection signal processed
async.threshold.met      -- min_approvals reached
async.timeout.expired    -- approval deadline exceeded
collab.api.request       -- every HTTP call (method, url, status, duration_ms)
collab.api.retry         -- retry attempt (attempt_n, status, next_delay_ms)
collab.sync.completed    -- as-code sync finished (SyncReport)
```

### Audit Log Format

Append-only JSONL at `.ai-sdd/sessions/<session>/audit-log.jsonl`:

```json
{"timestamp":"2026-03-11T10:00:00.123Z","task_id":"define-requirements","previous_state":"AWAITING_APPROVAL","new_state":"APPROVED","actor":"stakeholder:user@example.com","trigger_source":"slack:C01ABC123/1710151200.001","metadata":{"approval_count":2,"required_approvals":2,"phase":1}}
```

Never truncated. Queryable by task_id and time range via `AsyncAuditLog.queryByTask()` and `queryByTimeRange()`.

## Performance and Security Implementation Patterns

### Performance

| Concern | Pattern | Target |
|---------|---------|--------|
| Slack polling overhead | Configurable interval (default 5s), single channel per listener | < 720 API calls/hr |
| Confluence conversion | In-process `markdown-it` (no network call) | < 50ms per page |
| Jira sync batch | Parallel `Promise.allSettled` for independent creates/updates | < 5s for 50 tasks |
| Hash computation | SHA-256 via `node:crypto` (native) | < 1ms per task |
| HTTP connection reuse | `keep-alive` on all adapter HTTP clients | Reduce TLS handshakes |
| State persistence | Existing atomic tmp+rename, no change | < 10ms per write |

### Security

| Concern | Implementation |
|---------|---------------|
| Credential storage | Environment variables only, never config files |
| Credential in logs | All env var values registered with log-sanitizer at startup |
| Signal spoofing | Slack user ID extracted from API response (not user-supplied text) |
| Path traversal | Mapping files written only to `.ai-sdd/sync-mappings/` (allowlisted) |
| Input validation | All adapter inputs validated via Zod schemas before API calls |
| HTTPS only | All external API calls use HTTPS; no plain HTTP option |
| Token scope | Minimum scopes documented per adapter (e.g., Slack: `chat:write`, `channels:history`) |

## Technical Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Slack rate limiting under heavy polling | Medium | Approval latency spike | Configurable poll interval; `Retry-After` header respected; single channel reduces request volume |
| 2 | Confluence storage format breaking changes | Low | Page rendering failures | Pin `markdown-it` version; test against captured Confluence API fixtures (per dev standard #4); renderer has a fallback to escaped text |
| 3 | Jira multi-hop transitions unavailable | Medium | Task stuck in wrong column | BFS path discovery with clear error when no path exists; manual transition fallback documented |
| 4 | GitHub Projects v2 GraphQL schema changes | Low | Board sync failures | Pin GraphQL query fragments; test against captured schema fixtures |
| 5 | State file grows large with approval signals | Low | Slower state reads | Approval signals are scoped per phase; `resetForNewCycle` clears previous phase signals |
| 6 | Polling misses messages during engine restart | Medium | Delayed approval processing | On restart, poll with `oldest` = last known `ts` from persisted state; messages are idempotent |
| 7 | Concurrent approvals cause race condition | Medium | Double-counting approvals | `ApprovalManager.recordApproval` is synchronous (single-threaded Bun); dedup check runs before count increment |
| 8 | markdown-it XHTML output rejected by Confluence | Medium | Page create/update fails | Validate output against Confluence storage format schema before POST; fallback to raw Markdown wrapped in `<pre>` |

## Testing Strategy

### Shared Adapter Test Suites

Each adapter interface has a parameterized test suite that runs against all implementations (real + mock). This ensures NFR-006 (portability) by construction.

```
tests/collaboration/
  adapters/
    notification-adapter.suite.ts    -- shared tests, parameterized
    document-adapter.suite.ts
    task-tracking-adapter.suite.ts
    code-review-adapter.suite.ts
  adapters/impl/
    slack.test.ts                    -- Slack-specific tests (polling, parsing)
    slack-notification-channel.test.ts  -- ActivityMessage→Slack format, @mention resolution, emoji map
    confluence.test.ts               -- XHTML rendering edge cases
    jira.test.ts                     -- multi-hop transitions, ADF
    bitbucket.test.ts                -- merge strategies, pipeline trigger
    github-tracking.test.ts          -- epic simulation, Projects v2
    github-review.test.ts            -- review events
  core/
    async-task-manager.test.ts       -- state machine extensions
    approval-manager.test.ts         -- dedup, thresholds, veto
    sync-engine.test.ts              -- hash, create/update/orphan
    adapter-factory.test.ts          -- env var validation, caching
    confluence-sync-manager.test.ts  -- create vs update branching, mapping persistence, index page
    jira-hierarchy-sync.test.ts      -- epic creation, story/subtask hierarchy, status mapping
    event-bus.test.ts
  integration/
    async-approval-flow.test.ts      -- end-to-end async approval with mock adapters
    collab-wiring.test.ts            -- hook firing order, MockNotificationChannel assertions,
                                     --   ConfluenceSyncManager + JiraHierarchySync called from hooks
    document-review-cycle.test.ts
    jira-sync-roundtrip.test.ts
    e2e-live.test.ts                 -- live adapter tests (requires real env vars)
    cli-sync-command.test.ts         -- CLI integration test (dev standard #7)
```

### Mock Adapters

All four interfaces have in-memory mock implementations. Mocks record all calls for assertion and support configurable error injection:

```typescript
interface MockOptions {
  failOn?: { method: string; error: AdapterError };  // inject errors
  latencyMs?: number;                                  // simulate network delay
}
```

Mocks are the default when `collaboration.adapters.*` is set to `"mock"` (the default). This means existing tests never hit external APIs.

### Fixture-Based API Testing (Dev Standard #4)

Each adapter has captured API response fixtures in `tests/fixtures/`:

```
tests/fixtures/
  slack/conversations-history.json
  confluence/create-page-response.json
  jira/create-issue-response.json
  jira/transitions-response.json
  bitbucket/create-pr-response.json
  github/create-issue-response.json
  github/project-v2-query.json
```

Tests validate adapter response parsing against these fixtures, not assumed schemas.
