# ai-sdd Ecosystem Setup Guide

Complete guide for wiring ai-sdd to Slack, Confluence, Jira, and GitHub.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How the Pieces Fit Together](#2-how-the-pieces-fit-together)
3. [Slack Setup](#3-slack-setup)
4. [Confluence Setup](#4-confluence-setup)
5. [Jira Setup](#5-jira-setup)
6. [GitHub Setup](#6-github-setup)
7. [ai-sdd Configuration](#7-ai-sdd-configuration)
8. [Workflow Design Patterns](#8-workflow-design-patterns)
9. [Async Approval Flow](#9-async-approval-flow)
10. [Jira Sync Flow](#10-jira-sync-flow)
11. [Confluence Publishing Flow](#11-confluence-publishing-flow)
12. [GitHub PR Flow](#12-github-pr-flow)
13. [Combining All Tools: Full Run](#13-combining-all-tools-full-run)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Architecture Overview

```mermaid
graph TB
    subgraph "Developer Machine"
        CLI["ai-sdd run / /sdd-run"]
        ENGINE["Workflow Engine"]
        STATE["workflow-state.json"]
        AGENT["Claude Code Agent"]
    end

    subgraph "Notification"
        SLACK["Slack\n(Bot Token)"]
    end

    subgraph "Atlassian Cloud"
        JIRA["Jira\n(Task Tracking)"]
        CONF["Confluence\n(Design Docs)"]
    end

    subgraph "GitHub"
        GH_PR["Pull Requests\n(Code Review)"]
        GH_ISSUES["Issues / Projects\n(Task Tracking alt)"]
    end

    CLI --> ENGINE
    ENGINE --> STATE
    ENGINE --> AGENT
    AGENT --> ENGINE

    ENGINE -->|"HIL / approval prompts"| SLACK
    SLACK -->|"@ai-sdd approve/reject\n(polling every 5s)"| ENGINE

    ENGINE -->|"sync tasks on start"| JIRA
    JIRA -->|"issue keys stored\nin collaboration_refs"| ENGINE

    ENGINE -->|"publish artifacts"| CONF
    CONF -->|"page URLs in\nSlack notifications"| ENGINE

    ENGINE -->|"open PR per\nimplement task"| GH_PR
    GH_PR -->|"review status\n→ approval signal"| ENGINE

    ENGINE -->|"issues + Projects v2\n(GitHub-as-tracker alt)"| GH_ISSUES
```

---

## 2. How the Pieces Fit Together

Each external tool plays a distinct role. They are **independently optional** — you can use any combination.

| Tool | Role in ai-sdd | Required env vars |
|------|----------------|-------------------|
| **Slack** | Human-in-the-loop channel — approval requests, status pings | `SLACK_BOT_TOKEN` |
| **Confluence** | Document store — design docs, review reports published as pages | `CONFLUENCE_API_TOKEN` `CONFLUENCE_USER_EMAIL` `CONFLUENCE_BASE_URL` |
| **Jira** | Issue tracker — one issue per workflow task, synced code-wins | `JIRA_API_TOKEN` `JIRA_USER_EMAIL` `JIRA_BASE_URL` |
| **GitHub** | Code review — PR opened per implement task; review = approval signal | `GITHUB_TOKEN` |

```mermaid
flowchart LR
    YAML["workflow.yaml\ntask definition"]

    YAML -->|"mode: sync\n(default)"| SYNC["Sync Task\nRUNNING → COMPLETED\nNo external tools"]

    YAML -->|"mode: async +\ncollaboration.enabled: true"| ASYNC["Async Task\nRUNNING → AWAITING_APPROVAL"]

    ASYNC --> SL["Slack\nPost notification\nPoll for reply"]
    ASYNC --> JR["Jira\nCreate/update issue"]
    ASYNC --> CO["Confluence\nPublish artifact page"]
    ASYNC --> GH["GitHub\nOpen PR for review"]

    SL -->|"approved"| DONE["COMPLETED"]
    SL -->|"rejected"| REWORK["NEEDS_REWORK"]
    SL -->|"timeout"| FAIL["FAILED"]
```

---

## 3. Slack Setup

### 3.1 Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it `ai-sdd`, pick your workspace

### 3.2 Configure Bot Token Scopes

Navigate to **OAuth & Permissions** → **Bot Token Scopes**, add:

| Scope | Why |
|-------|-----|
| `chat:write` | Post approval request messages |
| `channels:history` | Poll for `@ai-sdd approve/reject` replies |
| `channels:read` | Resolve channel names to IDs |
| `users:read` | Resolve user display names in approval records |

### 3.3 Install to Workspace

**OAuth & Permissions** → **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-...`).

### 3.4 Invite Bot to Channel

In Slack: `/invite @ai-sdd` in the channel you want to use.

### 3.5 Approval message format

When a task hits an async gate, the bot posts:

```
*[ai-sdd] Task 'design-l1' awaiting approval*
Task: `design-l1`
Artifact: https://yourorg.atlassian.net/wiki/spaces/MYSPACE/pages/12345

To approve: @ai-sdd approve design-l1
To reject:  @ai-sdd reject design-l1 <reason>
```

The engine polls `conversations.history` every **5 seconds** from the moment the message is posted.

```mermaid
sequenceDiagram
    participant Engine
    participant Slack

    Engine->>Slack: POST chat.postMessage (approval request)
    Slack-->>Engine: {ok: true, ts: "1234.5678"}
    Engine->>Engine: persist slack_message_ts in collaboration_refs
    Engine->>Engine: transition RUNNING → AWAITING_APPROVAL

    loop every 5s
        Engine->>Slack: GET conversations.history?oldest=1234.5678
        Slack-->>Engine: messages[]
        Engine->>Engine: parse for @ai-sdd approve/reject
    end

    Note over Engine,Slack: User posts "@ai-sdd approve design-l1"

    Engine->>Engine: ApprovalManager.recordApproval()
    Engine->>Engine: threshold_met? → transition AWAITING_APPROVAL → COMPLETED
```

### 3.6 Environment variable

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_NOTIFY_CHANNEL=#ai-sdd-notifications
```

---

## 4. Confluence Setup

### 4.1 Generate an API Token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. **Create API token** → name it `ai-sdd` → copy the token

> The same token works for both Jira and Confluence (it is an Atlassian account token).

### 4.2 Find your base URL and space key

| Value | Where to find it |
|-------|-----------------|
| `CONFLUENCE_BASE_URL` | Your Confluence root, e.g. `https://yourorg.atlassian.net/wiki` |
| `CONFLUENCE_SPACE_KEY` | Confluence → Spaces → Space Settings → Space Key (short code, e.g. `MYSPACE`) |

### 4.3 Create a parent page (recommended)

ai-sdd publishes all artifact pages under a single parent. Create a page titled **"ai-sdd Artifacts"** in your space. Set `parent_page_title: "ai-sdd Artifacts"` in `ai-sdd.yaml`.

### 4.4 What gets published

| Workflow phase | Confluence page title |
|----------------|-----------------------|
| define-requirements | `define-requirements` |
| design-l1 | `design-l1` |
| design-l2 | `design-l2` |
| review-\* | `review-<task-id>` |
| plan-tasks | `plan-tasks` |

```mermaid
flowchart TD
    AGENT["Agent produces\nmarkdown artifact"]
    RENDER["ConfluenceMarkdownRenderer\nconverts markdown → Confluence storage format"]
    API["Confluence REST API\nPOST /rest/api/content"]
    PAGE["Confluence Page\ncreated under parent"]
    REF["page_id stored in\ncollaboration_refs"]
    SLACK["Confluence URL\nincluded in Slack\napproval message"]

    AGENT --> RENDER --> API --> PAGE --> REF --> SLACK
```

### 4.5 Environment variables

```bash
CONFLUENCE_USER_EMAIL=you@yourcompany.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_BASE_URL=https://yourorg.atlassian.net/wiki
CONFLUENCE_SPACE_KEY=MYSPACE
```

---

## 5. Jira Setup

### 5.1 API token

Same token as Confluence (`JIRA_API_TOKEN`). The `JIRA_USER_EMAIL` must match the Atlassian account that owns the token.

### 5.2 Find your base URL and project key

| Value | Where to find it |
|-------|-----------------|
| `JIRA_BASE_URL` | e.g. `https://yourorg.atlassian.net` (no `/wiki`, no trailing slash) |
| `JIRA_PROJECT_KEY` | Jira → Project Settings → Details → Key (e.g. `MYPROJ`) |

### 5.3 Required project permissions

The Atlassian account must have at minimum:

- **Browse Projects**
- **Create Issues**
- **Edit Issues**
- **Transition Issues**

### 5.4 How task sync works (code-wins)

ai-sdd uses a **code-wins bidirectional sync** model via `AsCodeSyncEngine`:

```mermaid
flowchart TD
    WF["workflow.yaml\n(source of truth)"]
    HASH["Content hash computed\nfor each task definition"]
    MAP[".ai-sdd/jira-mappings.json\n(task_id → issue_key)"]

    WF --> HASH

    HASH -->|"No mapping exists"| CREATE["Jira: Create Issue\nlabeled 'ai-sdd'"]
    HASH -->|"Hash changed\nsince last sync"| UPDATE["Jira: Update Issue\nsummary + description"]
    HASH -->|"Hash unchanged"| SKIP["No-op"]
    HASH -->|"Task removed\nfrom workflow"| ORPHAN["Jira: Add label\n'ai-sdd:orphaned'"]

    CREATE --> MAP
    UPDATE --> MAP
    SKIP --> MAP
```

**Key rule**: ai-sdd never deletes Jira issues. Removed tasks get labelled `ai-sdd:orphaned` so your team can triage them manually.

### 5.5 Issue structure

Each workflow task maps to one Jira issue:

| Jira field | Value |
|------------|-------|
| Summary | `<task-id>` (e.g. `design-l1`) |
| Description | Task description from workflow YAML |
| Labels | `ai-sdd`, `ai-sdd:<phase>` |
| Issue type | Task |
| Project | `JIRA_PROJECT_KEY` |

### 5.6 Environment variables

```bash
JIRA_USER_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=your-api-token
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_PROJECT_KEY=MYPROJ
```

---

## 6. GitHub Setup

### 6.1 Create a Personal Access Token (classic)

1. [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Name: `ai-sdd`
3. Scopes required:

| Scope | Why |
|-------|-----|
| `repo` | Read/write PRs, issues, branches |
| `project` | Read/write GitHub Projects v2 boards |
| `workflow` | Trigger GitHub Actions (optional — for CI dispatch) |

> Fine-grained tokens work too. Required permissions: **Contents** (read/write), **Pull requests** (read/write), **Issues** (read/write), **Projects** (read/write).

### 6.2 How GitHub is used

ai-sdd uses GitHub for two independent purposes depending on config:

#### As code review adapter (`code_review: github`)
Opens a PR for each `implement` task. The reviewer agent reviews the PR and its approval becomes the async approval signal.

#### As task tracking adapter (`task_tracking: github`)
Uses GitHub Issues + Projects v2 instead of Jira. Each workflow task maps to a GitHub Issue; a Projects v2 board tracks status.

### 6.3 PR flow

```mermaid
sequenceDiagram
    participant Engine
    participant GitHub

    Engine->>GitHub: Create branch feature/implement-<task-id>
    Engine->>GitHub: Push agent output files
    Engine->>GitHub: POST /repos/{owner}/{repo}/pulls\n(title=task-id, base=main)
    GitHub-->>Engine: {number: 42, url: "..."}
    Engine->>Engine: persist pr_id in collaboration_refs

    Engine->>GitHub: Assign reviewer agent as reviewer
    Engine->>GitHub: POST /repos/{owner}/{repo}/pulls/42/reviews\n(reviewer agent review)

    Note over Engine,GitHub: Reviewer agent approves or requests changes

    GitHub-->>Engine: Review state: APPROVED
    Engine->>Engine: Map APPROVED → ApprovalSignal
    Engine->>Engine: transition AWAITING_APPROVAL → COMPLETED
```

### 6.4 GitHub as task tracker (alternative to Jira)

```mermaid
flowchart LR
    WF["workflow.yaml"] --> SYNC["AsCodeSyncEngine\n(same engine, GitHub adapter)"]
    SYNC -->|"Create"| ISSUE["GitHub Issue\nlabeled 'ai-sdd'"]
    SYNC -->|"Status change"| PROJECT["Projects v2\nStatus column updated"]
    SYNC -->|"Orphaned"| LABEL["Label: ai-sdd:orphaned"]
```

Switch from Jira to GitHub Issues by changing one line in `ai-sdd.yaml`:

```yaml
collaboration:
  adapters:
    task_tracking: github   # was: jira
```

### 6.5 Environment variables

```bash
GITHUB_TOKEN=ghp_your-token-here
GITHUB_REPO_OWNER=your-org-or-username
GITHUB_REPO_NAME=your-repo
```

---

## 7. ai-sdd Configuration

### 7.1 Full `ai-sdd.yaml` reference

```yaml
version: "1"

adapter:
  type: claude_code          # claude_code | openai | mock

engine:
  max_concurrent_tasks: 2
  cost_budget_per_run_usd: 20.00

# ── Collaboration block ───────────────────────────────────────────────────────
collaboration:
  enabled: true              # false = no external tools (pure sync mode)

  adapters:
    notification:  slack     # slack | mock
    document:      confluence # confluence | mock
    task_tracking: jira      # jira | github | mock
    code_review:   github    # github | bitbucket | mock

  slack:
    notify_channel: "${SLACK_NOTIFY_CHANNEL}"

  confluence:
    space_key: "${CONFLUENCE_SPACE_KEY}"
    parent_page_title: "ai-sdd Artifacts"

  jira:
    project_key: "${JIRA_PROJECT_KEY}"

  github:
    owner: "${GITHUB_REPO_OWNER}"
    repo:  "${GITHUB_REPO_NAME}"
    base_branch: main

overlays:
  hil:
    enabled: true
  confidence:
    threshold: 0.7
  traceability:
    enabled: true
```

### 7.2 Adapter combinations

| Use case | notification | document | task_tracking | code_review |
|----------|-------------|----------|---------------|-------------|
| Full Atlassian + GitHub | `slack` | `confluence` | `jira` | `github` |
| Full GitHub only | `slack` | `mock` | `github` | `github` |
| Atlassian only | `slack` | `confluence` | `jira` | `mock` |
| Local dev / CI | `mock` | `mock` | `mock` | `mock` |

---

## 8. Workflow Design Patterns

### 8.1 When to use `mode: async`

```mermaid
flowchart TD
    Q1{"Does this task\nproduce something\na human must review?"}
    Q2{"Is there a\ndeadline or SLA\nfor the review?"}
    Q3{"Do you need\nmultiple sign-offs?"}

    SYNC["mode: sync\n(default)"]
    ASYNC_BASIC["mode: async\nmin_approvals: 1"]
    ASYNC_TIMEOUT["mode: async\nmin_approvals: 1\napproval_timeout_seconds: 86400"]
    ASYNC_MULTI["mode: async\nmin_approvals: 2+"]

    Q1 -->|No| SYNC
    Q1 -->|Yes| Q2
    Q2 -->|No| Q3
    Q2 -->|Yes| ASYNC_TIMEOUT
    Q3 -->|No| ASYNC_BASIC
    Q3 -->|Yes| ASYNC_MULTI
```

### 8.2 Recommended async gates per workflow phase

```yaml
tasks:
  define-requirements:
    mode: async            # BA output — product owner must sign off
    min_approvals: 1

  design-l1:
    mode: sync             # automated reviewer handles this

  review-l1:
    mode: async            # architect or tech lead sign-off
    min_approvals: 1
    approval_timeout_seconds: 172800   # 48h

  implement:
    mode: sync             # agent does the work, no human approval needed

  review-implementation:
    mode: async            # lead engineer approves before merge
    min_approvals: 1

  final-sign-off:
    mode: async            # product owner + tech lead both approve
    min_approvals: 2
    approval_timeout_seconds: 86400
```

---

## 9. Async Approval Flow

Complete lifecycle of a single async task:

```mermaid
stateDiagram-v2
    [*] --> PENDING

    PENDING --> RUNNING: Engine dispatches agent

    RUNNING --> AWAITING_APPROVAL: Agent completes\n+ collaboration.enabled=true\n+ mode=async\n\nActions:\n• Jira issue created/updated\n• Confluence page published\n• Slack message posted\n• Polling loop started

    AWAITING_APPROVAL --> AWAITING_APPROVAL: Polling (5s intervals)\nno matching signals yet

    AWAITING_APPROVAL --> COMPLETED: min_approvals reached\n(@ai-sdd approve <task>)

    AWAITING_APPROVAL --> NEEDS_REWORK: Rejection received\n(@ai-sdd reject <task> reason)

    AWAITING_APPROVAL --> FAILED: approval_timeout_at exceeded\nOR max_rework_iterations hit

    NEEDS_REWORK --> RUNNING: Engine re-dispatches\nwith rejection feedback

    COMPLETED --> [*]
    FAILED --> [*]
```

### 9.1 Approval commands

| Intent | Slack message |
|--------|--------------|
| Approve | `@ai-sdd approve design-l1` |
| Approve with notes | `@ai-sdd approve design-l1 looks good, minor comments in Confluence` |
| Reject | `@ai-sdd reject design-l1 missing NFR section for latency` |

The bot reads these via regex:
- Approval: `^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$`
- Rejection: `^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$`

### 9.2 Multi-stakeholder approval

```mermaid
sequenceDiagram
    participant Engine
    participant Alice
    participant Bob
    participant Slack

    Engine->>Slack: "final-sign-off awaiting 2 approvals"

    Alice->>Slack: @ai-sdd approve final-sign-off LGTM
    Slack-->>Engine: ApprovalSignal {stakeholder: "alice"}
    Engine->>Engine: received=1, required=2 → still AWAITING

    Bob->>Slack: @ai-sdd approve final-sign-off approved
    Slack-->>Engine: ApprovalSignal {stakeholder: "bob"}
    Engine->>Engine: received=2, required=2 → threshold_met!
    Engine->>Engine: transition → COMPLETED
```

> Duplicate approvals from the same user are silently ignored (`ApprovalManager` deduplicates by `stakeholder_id`).

---

## 10. Jira Sync Flow

```mermaid
flowchart TD
    START["ai-sdd run starts"]
    LOAD["Load workflow.yaml\n+ existing jira-mappings.json"]
    HEALTH["JiraTaskTrackingAdapter.healthCheck()\nGET /rest/api/3/myself"]

    HEALTH -->|"401/403"| CRED_ERR["Error: check JIRA_API_TOKEN\nand JIRA_USER_EMAIL"]
    HEALTH -->|"200 OK"| FOREACH

    START --> LOAD --> HEALTH

    FOREACH["For each task in workflow"]

    FOREACH --> EXISTS{"mapping\nexists?"}

    EXISTS -->|"No"| CREATE["POST /rest/api/3/issue\n{summary: task_id,\n labels: ['ai-sdd'],\n project: JIRA_PROJECT_KEY}"]
    CREATE --> STORE["Store issue_key\nin jira-mappings.json"]

    EXISTS -->|"Yes"| HASHCHECK{"content_hash\nchanged?"}
    HASHCHECK -->|"No"| UNCHANGED["Skip — no-op"]
    HASHCHECK -->|"Yes"| UPDATE["PUT /rest/api/3/issue/{key}\nupdate summary + description"]
    UPDATE --> UPDATEHASH["Update hash\nin jira-mappings.json"]

    FOREACH --> ORPHANCHECK["For each mapping\nnot in workflow"]
    ORPHANCHECK --> LABEL["POST /rest/api/3/issue/{key}\nadd label: ai-sdd:orphaned"]
```

### 10.1 Mapping file location

```
.ai-sdd/sessions/default/jira-mappings.json
```

Example:
```json
{
  "schema_version": "1",
  "adapter_type": "jira",
  "project_key": "MYPROJ",
  "synced_at": "2026-03-11T10:00:00.000Z",
  "mappings": [
    {
      "task_id": "define-requirements",
      "issue_key": "MYPROJ-1",
      "issue_type": "task",
      "content_hash": "sha256:a1b2c3...",
      "created_at": "2026-03-10T14:52:15.000Z",
      "updated_at": "2026-03-10T14:52:15.000Z",
      "orphaned": false
    }
  ]
}
```

---

## 11. Confluence Publishing Flow

```mermaid
flowchart TD
    AGENT["Agent writes\nmarkdown artifact\n(e.g. specs/design-l1.md)"]
    READ["Engine reads artifact\nafter task COMPLETED"]
    RENDER["ConfluenceMarkdownRenderer\nconverts to Confluence\nstorage format (XHTML)"]

    PARENT["GET /rest/api/content\nfind parent page by title"]
    PARENT -->|"Not found"| CREATE_PARENT["POST /rest/api/content\ncreate parent page"]
    PARENT -->|"Found"| PAGE_EXISTS

    RENDER --> PARENT
    AGENT --> READ --> RENDER

    PAGE_EXISTS{"Artifact page\nalready exists?"}
    CREATE_PARENT --> PAGE_EXISTS

    PAGE_EXISTS -->|"No"| CREATE_PAGE["POST /rest/api/content\n{type: page,\n title: task-id,\n space: SPACE_KEY,\n parent: parent_id,\n body: rendered_html}"]
    PAGE_EXISTS -->|"Yes"| UPDATE_PAGE["PUT /rest/api/content/{id}\n{version: current+1,\n body: rendered_html}"]

    CREATE_PAGE --> STORE_REF["Store page_id\nin collaboration_refs"]
    UPDATE_PAGE --> STORE_REF

    STORE_REF --> SLACK_URL["Include page URL\nin next Slack notification"]
```

---

## 12. GitHub PR Flow

```mermaid
sequenceDiagram
    participant Engine
    participant GitHub

    Note over Engine: implement task RUNNING

    Engine->>GitHub: GET /repos/{owner}/{repo}/git/refs/heads/main
    GitHub-->>Engine: base SHA

    Engine->>GitHub: POST /repos/{owner}/{repo}/git/refs\nbranch: feature/implement-{task-id}

    Engine->>GitHub: PUT /repos/{owner}/{repo}/contents/{path}\n(for each output file)

    Engine->>GitHub: POST /repos/{owner}/{repo}/pulls\n{title: task-id, head: feature/..., base: main}
    GitHub-->>Engine: {number: 42, html_url: "..."}

    Engine->>Engine: persist pr_id=42 in collaboration_refs
    Engine->>Engine: transition RUNNING → AWAITING_APPROVAL

    Engine->>GitHub: POST /repos/{owner}/{repo}/pulls/42/requested_reviewers\n{reviewers: [reviewer-agent]}

    Note over Engine: Reviewer agent runs

    Engine->>GitHub: POST /repos/{owner}/{repo}/pulls/42/reviews\n{event: "APPROVE" | "REQUEST_CHANGES",\n body: review comments}

    GitHub-->>Engine: Review submitted

    alt APPROVED
        Engine->>Engine: Map to ApprovalSignal → COMPLETED
        Engine->>GitHub: PUT /repos/{owner}/{repo}/pulls/42/merge
    else REQUEST_CHANGES
        Engine->>Engine: Map to RejectionSignal → NEEDS_REWORK
    end
```

---

## 13. Combining All Tools: Full Run

End-to-end view of a single `ai-sdd run` with all adapters active:

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Engine as ai-sdd Engine
    participant Jira
    participant Agent as Claude Agent
    participant Confluence
    participant Slack
    participant GitHub

    Dev->>Engine: ai-sdd run

    Engine->>Jira: Sync all tasks → create issues MYPROJ-1..N
    Engine->>Engine: Load persisted state (auto-resume)

    Note over Engine: Task: define-requirements (mode: async)

    Engine->>Agent: Dispatch (generate requirements doc)
    Agent-->>Engine: specs/define-requirements.md

    Engine->>Confluence: Publish page "define-requirements"
    Confluence-->>Engine: page_id=12345, url=https://...

    Engine->>Slack: Post approval request\n(includes Confluence URL)
    Engine->>Engine: transition RUNNING → AWAITING_APPROVAL

    Dev->>Slack: @ai-sdd approve define-requirements looks good
    Slack-->>Engine: (polled) ApprovalSignal received
    Engine->>Jira: Update MYPROJ-1 status → Done
    Engine->>Engine: transition AWAITING_APPROVAL → COMPLETED

    Note over Engine: Task: design-l1 (mode: sync)

    Engine->>Agent: Dispatch (generate L1 architecture)
    Agent-->>Engine: specs/design-l1.md
    Engine->>Confluence: Publish page "design-l1"
    Engine->>Engine: COMPLETED (no approval needed)

    Note over Engine: Task: implement (mode: async)

    Engine->>Agent: Dispatch (implement)
    Agent-->>Engine: src/... files

    Engine->>GitHub: Create branch + push files + open PR #42
    Engine->>Slack: Post approval request (includes PR URL)
    Engine->>Engine: transition RUNNING → AWAITING_APPROVAL

    Engine->>GitHub: Reviewer agent reviews PR #42
    GitHub-->>Engine: Review: APPROVED

    Engine->>GitHub: Merge PR #42
    Engine->>Jira: Update implement issue → Done
    Engine->>Engine: transition AWAITING_APPROVAL → COMPLETED

    Engine->>Slack: "Workflow complete — all tasks COMPLETED"
    Engine-->>Dev: Exit 0
```

---

## 14. Troubleshooting

### Credential errors

```mermaid
flowchart TD
    ERR["Error: Missing required\nenvironment variables"]
    CHECK["Run:\necho $SLACK_BOT_TOKEN\necho $JIRA_API_TOKEN\netc."]
    EXPORTED{"All vars\nset and exported?"}

    ERR --> CHECK --> EXPORTED

    EXPORTED -->|"No"| EXPORT["export $(grep -v '^#' .env | xargs)\nor use direnv"]
    EXPORTED -->|"Yes → still failing"| VALIDATE["Run:\nai-sdd validate-config\nto check each adapter"]
```

### Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `missing_scope` from Slack | Bot token lacks a required scope | Re-install app after adding scopes in api.slack.com/apps |
| `channel_not_found` from Slack | Bot not in channel | `/invite @ai-sdd` in the channel |
| Confluence `401` | Wrong API token or email | Token must match the `CONFLUENCE_USER_EMAIL` account |
| Confluence `404` on space | Wrong space key | Check URL: `https://yourorg.atlassian.net/wiki/spaces/MYSPACE` — `MYSPACE` is the key |
| Jira `403` | Insufficient project permissions | Grant Browse + Create + Edit + Transition in Jira project settings |
| Jira `404` on project | Wrong project key | Check: Jira → Project Settings → Details → Key |
| GitHub `401` | PAT expired or revoked | Regenerate at github.com/settings/tokens |
| GitHub `403` on Projects | Missing `project` scope | Regenerate PAT with `project` scope |
| `Claude Code nested session` | `CLAUDECODE=1` env var inherited | Fixed in `src/adapters/claude-code-adapter.ts` — update to latest build |
| Approval never received | Bot not in channel, or wrong channel name | Confirm `SLACK_NOTIFY_CHANNEL` matches and bot is a member |
| Timeout before approval | `approval_timeout_seconds` too short | Increase value, or set to `0` for no timeout |

### Checking adapter health manually

```bash
# Validate all configured adapters in one command
ai-sdd validate-config --project .

# Check active session
ai-sdd sessions active

# See which tasks are blocking
ai-sdd status --next --json
```

### Resuming after an interrupted run

State is always persisted. Simply re-run:

```bash
ai-sdd run
```

The engine will:
- Skip all `COMPLETED` tasks
- Resume `AWAITING_APPROVAL` tasks (re-attach the Slack polling loop using the stored `slack_message_ts`)
- Re-dispatch `RUNNING` or `NEEDS_REWORK` tasks

To start completely fresh:

```bash
rm .ai-sdd/sessions/default/workflow-state.json
ai-sdd run
```
