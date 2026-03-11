# Requirements -- Async/Hybrid Workflow Collaboration for ai-sdd

## Summary
- Functional requirements: 18 (14 MVP1 MUST, 4 MVP2 SHOULD)
- Non-functional requirements: 6 (all MUST)
- Areas covered: Workflow Engine, Slack Integration, Confluence Integration, Jira Integration, Bitbucket Integration, GitHub Integration, Integration/Orchestration

## Contents

### Functional Requirements

| ID | Title | Area | Priority |
|----|-------|------|----------|
| FR-001 | Async/Sync Task Mode Configuration | Workflow Engine | MUST |
| FR-002 | Async Task State Machine | Workflow Engine | MUST |
| FR-003 | Hybrid Workflow Execution | Workflow Engine | MUST |
| FR-004 | Slack Channel Notification Adapter | Slack Integration | MUST |
| FR-005 | Slack Approval Signal Listener | Slack Integration | MUST |
| FR-006 | Confluence Document Authoring Adapter | Confluence Integration | MUST |
| FR-007 | Confluence Review Comment Support | Confluence Integration | MUST |
| FR-008 | Jira Epic and Sub-Task Creation | Jira Integration | MUST |
| FR-009 | Jira Agile Kanban Transitions | Jira Integration | MUST |
| FR-010 | Jira-as-Code Sync | Jira Integration | MUST |
| FR-011 | Bitbucket PR Creation and Review Flow | Bitbucket Integration | MUST |
| FR-012 | Bitbucket Pipeline Trigger | Bitbucket Integration | SHOULD |
| FR-013 | Configurable Stakeholder Sign-Off Threshold | Workflow Engine | MUST |
| FR-014 | End-to-End Async Collaboration Flow | Integration / Orchestration | MUST |
| FR-015 | [MVP2] GitHub Issues Adapter | GitHub Integration | SHOULD |
| FR-016 | [MVP2] GitHub PR Adapter | GitHub Integration | SHOULD |
| FR-017 | [MVP2] GitHub Project Board Adapter | GitHub Integration | SHOULD |
| FR-018 | [MVP2] GitHub-as-Code Sync | GitHub Integration | SHOULD |

### Non-Functional Requirements

| ID | Title | Category | Priority |
|----|-------|----------|----------|
| NFR-001 | Adapter Pluggability | Maintainability | MUST |
| NFR-002 | Credential Security | Security | MUST |
| NFR-003 | State Transition Auditability | Compliance | MUST |
| NFR-004 | Slack Message Latency | Performance | MUST |
| NFR-005 | External API Retry and Error Handling | Reliability | MUST |
| NFR-006 | Adapter Interface Portability | Maintainability | MUST |

---

## FR-001: Async/Sync Task Mode Configuration

**Area:** Workflow Engine | **Priority:** MUST | **Source:** constitution.md "Async task mode" / requirements.md "Allow the workflow tasks to be configured either as sync or async"

The workflow engine must allow each task to be individually configured as either `sync` or `async` via the workflow YAML definition. A `sync` task executes inline and blocks the engine until completion (existing behaviour). An `async` task executes, posts its output to collaboration tools, and transitions to an awaiting-approval state until external signals advance it. The task-level `mode` field must default to `sync` to preserve backward compatibility with existing workflows.

```gherkin
Feature: Async/Sync task mode configuration

  Scenario: Task configured as async enters awaiting state after execution
    Given a workflow YAML with a task whose mode is set to "async"
    When the engine executes that task
    Then the task output is produced
    And the task transitions to AWAITING_APPROVAL state
    And the engine does not block waiting for the task to complete

  Scenario: Task configured as sync blocks until completion
    Given a workflow YAML with a task whose mode is set to "sync"
    When the engine executes that task
    Then the engine blocks until the task completes
    And the task transitions directly to DONE upon completion

  Scenario: Task with no mode specified defaults to sync
    Given a workflow YAML with a task that does not specify a mode field
    When the engine loads the workflow
    Then the task mode is resolved as "sync"
```

Related: NFR-001

---

## FR-002: Async Task State Machine

**Area:** Workflow Engine | **Priority:** MUST | **Source:** constitution.md "State machine: orchestrator manages async lifecycle" / requirements.md "Orchestrator will maintain a state machine"

The orchestrator must implement a state machine for async tasks with the following states and transitions: AWAITING_APPROVAL, APPROVED, DOING, DONE. The state machine must enforce valid transitions only, reject invalid transitions with an error, and handle rejection loops (AWAITING_APPROVAL back to DOING for rework). The state machine must also handle timeouts on AWAITING_APPROVAL (configurable per task), concurrent approval signals from multiple stakeholders, and partial failures where an approval is received but the subsequent action fails.

```gherkin
Feature: Async task state machine

  Scenario: Happy path approval flow
    Given an async task in AWAITING_APPROVAL state
    When the required number of stakeholder approvals are received
    Then the task transitions to APPROVED state
    And immediately transitions to DOING state for the next phase of work

  Scenario: Rejection triggers rework
    Given an async task in AWAITING_APPROVAL state
    When a stakeholder rejects the task with feedback
    Then the task transitions back to DOING state
    And the rejection feedback is attached to the task context

  Scenario: Invalid transition is rejected
    Given an async task in DONE state
    When a transition to AWAITING_APPROVAL is attempted
    Then the engine raises a StateError
    And the task remains in DONE state

  Scenario: Timeout on awaiting approval
    Given an async task in AWAITING_APPROVAL state with a timeout of 3600 seconds
    When 3600 seconds elapse without sufficient approvals
    Then the task transitions to a timeout state
    And a notification is sent via Slack to the configured channel

  Scenario: Concurrent approvals are deduplicated
    Given an async task in AWAITING_APPROVAL state requiring 2 approvals
    When the same stakeholder sends 2 approval signals
    Then only 1 approval is counted
    And the task remains in AWAITING_APPROVAL until a second distinct stakeholder approves
```

Related: NFR-003 | Depends on: FR-001

---

## FR-003: Hybrid Workflow Execution

**Area:** Workflow Engine | **Priority:** MUST | **Source:** requirements.md "workflow can be fully async or fully sync, or hybrid"

The workflow engine must support three execution modes at the workflow level: fully synchronous (all tasks sync), fully asynchronous (all tasks async), and hybrid (a mix of sync and async tasks). In hybrid mode, the engine must correctly manage the DAG dependency graph such that a sync task depending on an async task waits until the async task reaches DONE before starting. The engine must not deadlock when async and sync tasks are interleaved in the dependency graph.

```gherkin
Feature: Hybrid workflow execution

  Scenario: Fully synchronous workflow executes sequentially
    Given a workflow where all tasks have mode "sync"
    When the engine runs the workflow
    Then each task executes in dependency order
    And the engine blocks on each task until completion

  Scenario: Fully asynchronous workflow with approval gates
    Given a workflow where all tasks have mode "async"
    When the engine runs the workflow
    Then each task executes and enters AWAITING_APPROVAL
    And the engine waits for external approval signals before advancing each task

  Scenario: Hybrid workflow with sync task depending on async task
    Given a workflow with task A (async) and task B (sync) where B depends on A
    When the engine starts the workflow
    Then task A executes and enters AWAITING_APPROVAL
    And task B remains PENDING until task A reaches DONE
    And once task A is DONE, task B executes synchronously

  Scenario: Hybrid workflow does not deadlock
    Given a workflow with 3 tasks: A (async), B (sync, depends on A), C (async, depends on B)
    When the engine runs the workflow
    Then A completes its async cycle
    And B executes synchronously after A is DONE
    And C enters its async cycle after B completes
    And the workflow reaches completion
```

Depends on: FR-001, FR-002

---

## FR-004: Slack Channel Notification Adapter

**Area:** Slack Integration | **Priority:** MUST | **Source:** constitution.md "Slack as primary coordination bus" / requirements.md "agent will notify other agents via Slack message in a channel"

The system must provide a Slack adapter capable of posting structured notification messages to a configured Slack channel. Notifications must be sent when: (a) an agent completes a task and it enters AWAITING_APPROVAL, (b) a stakeholder approves or rejects a task, (c) a PR is raised or updated, and (d) a review cycle completes. Messages must include the task ID, a summary of the action taken, a link to the relevant artifact (Confluence page, PR, Jira ticket), and the actor (agent or stakeholder name). The Slack adapter must authenticate via a bot token provided through environment variables.

```gherkin
Feature: Slack channel notification

  Scenario: Agent posts task-ready notification to Slack
    Given a configured Slack channel and a valid bot token in environment variables
    When an async task completes and enters AWAITING_APPROVAL
    Then a message is posted to the configured Slack channel
    And the message contains the task ID, summary, and artifact link

  Scenario: Notification includes actor identity
    Given a Slack notification triggered by agent "BA-Agent"
    When the message is posted
    Then the message body includes "BA-Agent" as the actor

  Scenario: Slack adapter handles missing bot token
    Given the Slack bot token environment variable is not set
    When the engine attempts to send a Slack notification
    Then the adapter raises a configuration error
    And the error message identifies the missing environment variable
```

Related: NFR-002, NFR-004 | Depends on: FR-001

---

## FR-005: Slack Approval Signal Listener

**Area:** Slack Integration | **Priority:** MUST | **Source:** requirements.md "Orchestrator will wait until it gets approval signals from stakeholders" / constitution.md "Configurable stakeholder sign-off"

The system must provide a Slack listener that monitors a configured channel for approval and rejection signals from stakeholders. The listener must parse structured approval messages (or reactions/commands) to extract: the task ID being approved/rejected, the stakeholder identity, and optional feedback notes. Parsed signals must be forwarded to the orchestrator's state machine to trigger the appropriate state transition. The listener must run continuously while the engine is active and must not poll more frequently than the configured interval.

```gherkin
Feature: Slack approval signal listener

  Scenario: Stakeholder approval is parsed and forwarded
    Given the Slack listener is active on a configured channel
    And an async task "define-requirements" is in AWAITING_APPROVAL state
    When a stakeholder posts an approval message referencing task "define-requirements"
    Then the listener parses the approval signal
    And forwards it to the orchestrator with the stakeholder identity and task ID

  Scenario: Rejection with feedback is captured
    Given the Slack listener is active
    And an async task is in AWAITING_APPROVAL state
    When a stakeholder posts a rejection message with feedback text
    Then the listener parses the rejection signal and feedback
    And the feedback is attached to the task context for the rework cycle

  Scenario: Malformed message is ignored gracefully
    Given the Slack listener is active
    When a message is posted that does not match the approval/rejection format
    Then the listener ignores the message
    And no state transition is attempted
    And a debug-level log entry is recorded
```

Related: NFR-004, NFR-005 | Depends on: FR-002, FR-004

---

## FR-006: Confluence Document Authoring Adapter

**Area:** Confluence Integration | **Priority:** MUST | **Source:** requirements.md "BA produces doc in Confluence under a configured space/folder" / constitution.md "Confluence integration: document authoring"

The system must provide a Confluence adapter that creates and updates pages within a configured Confluence space and parent page (folder). When an agent produces a spec document (e.g., requirements, architecture), the adapter must create a new Confluence page with the document content rendered in Confluence storage format. If a page for that task already exists, the adapter must update it in place rather than creating a duplicate. The adapter must support setting page titles, labels, and parent page hierarchy. Authentication must use Confluence API tokens provided via environment variables.

```gherkin
Feature: Confluence document authoring

  Scenario: Agent creates a new Confluence page for a task
    Given a configured Confluence space "PROJ" and parent page "Specifications"
    And valid Confluence API credentials in environment variables
    When the BA agent produces the requirements document for task "define-requirements"
    Then a new Confluence page is created under "Specifications"
    And the page title includes the task identifier
    And the page body contains the document content in Confluence storage format

  Scenario: Existing page is updated rather than duplicated
    Given a Confluence page already exists for task "define-requirements"
    When the agent produces an updated version of the document
    Then the existing page is updated with the new content
    And no duplicate page is created

  Scenario: Missing Confluence credentials produce a clear error
    Given the Confluence API token environment variable is not set
    When the adapter attempts to create a page
    Then a configuration error is raised identifying the missing credential
```

Related: NFR-002, NFR-001

---

## FR-007: Confluence Review Comment Support

**Area:** Confluence Integration | **Priority:** MUST | **Source:** requirements.md "PE/PO reviews the doc and provide feedback in inline and standard comments" / constitution.md "inline/standard commenting, review feedback"

The system must support reading and writing both inline comments and standard (page-level) comments on Confluence pages. When a reviewer provides feedback via inline or standard comments, the adapter must retrieve those comments and make them available to the agent for processing. When an agent responds to feedback, it must be able to post reply comments on the same thread. The adapter must track which comments have been processed to avoid re-processing the same feedback in subsequent polling cycles.

```gherkin
Feature: Confluence review comments

  Scenario: Agent retrieves inline comments from a reviewed page
    Given a Confluence page for task "define-requirements" with 3 inline comments from a reviewer
    When the agent polls for new review feedback
    Then all 3 inline comments are retrieved
    And each comment includes the highlighted text range, author, and comment body

  Scenario: Agent retrieves standard page-level comments
    Given a Confluence page with 2 standard comments
    When the agent polls for new review feedback
    Then both standard comments are retrieved with author and body

  Scenario: Agent posts a reply to an inline comment
    Given an inline comment from reviewer "PE-Lead" on a Confluence page
    When the agent processes the feedback and generates a response
    Then a reply comment is posted under the original inline comment thread

  Scenario: Already-processed comments are not re-retrieved
    Given the agent has already processed 3 comments from a previous cycle
    When the agent polls for new feedback
    Then only comments posted after the last poll timestamp are returned
```

Related: NFR-005 | Depends on: FR-006

---

## FR-008: Jira Epic and Sub-Task Creation

**Area:** Jira Integration | **Priority:** MUST | **Source:** requirements.md "Agents will follow the Jira model closely. It will mimic Epics and Sub-Tasks" / constitution.md "Jira (task tracking, Agile Kanban workflow, epics/sub-tasks)"

The system must provide a Jira adapter that creates epics and sub-tasks in a configured Jira project. When a workflow is loaded, each top-level task group must be represented as a Jira epic, and individual tasks within the group must be created as sub-tasks (or stories) linked to their parent epic. The adapter must set standard fields: summary, description, assignee (mapped from agent role), priority, and labels. Issue types must be configurable to accommodate project-specific Jira schemes.

```gherkin
Feature: Jira epic and sub-task creation

  Scenario: Workflow task groups are created as Jira epics
    Given a workflow YAML with 2 task groups and valid Jira credentials
    When the engine syncs tasks to Jira
    Then 2 epics are created in the configured Jira project
    And each epic summary matches the task group name

  Scenario: Individual tasks are created as sub-tasks under their epic
    Given a task group "requirements" with 3 tasks
    When the engine syncs tasks to Jira
    Then 3 sub-tasks are created under the "requirements" epic
    And each sub-task summary matches the task title

  Scenario: Duplicate creation is prevented on re-sync
    Given tasks have already been synced to Jira
    When the engine syncs the same workflow again
    Then no duplicate epics or sub-tasks are created
    And existing issues are updated if task metadata has changed
```

Related: NFR-001 | Depends on: FR-010

---

## FR-009: Jira Agile Kanban Transitions

**Area:** Jira Integration | **Priority:** MUST | **Source:** requirements.md "Jira transition will follow Agile Kanban workflow with appropriate swimlanes" / constitution.md "Agile Kanban workflow"

The system must map the async task state machine states to Jira Kanban board columns (swimlanes). When a task transitions state in the orchestrator, the corresponding Jira issue must be transitioned to the mapped Kanban column. The column mapping must be configurable in the workflow YAML or adapter config. The adapter must handle Jira transition IDs correctly by querying available transitions before attempting a move.

```gherkin
Feature: Jira Agile Kanban transitions

  Scenario: Task state change triggers Jira transition
    Given a task "design-l1" mapped to Jira issue PROJ-42
    And the Kanban column mapping is: AWAITING_APPROVAL -> "In Review", DOING -> "In Progress", DONE -> "Done"
    When the orchestrator transitions "design-l1" from DOING to AWAITING_APPROVAL
    Then Jira issue PROJ-42 is transitioned to the "In Review" column

  Scenario: Custom column mapping is respected
    Given a custom column mapping in workflow YAML: APPROVED -> "Ready for Dev"
    When a task transitions to APPROVED
    Then the Jira issue moves to "Ready for Dev"

  Scenario: Transition to unavailable Jira status is handled
    Given a Jira issue in "To Do" status
    And the target column "In Review" requires an intermediate transition through "In Progress"
    When the adapter attempts the transition
    Then the adapter queries available transitions
    And performs the required intermediate transitions to reach "In Review"
```

Related: NFR-003 | Depends on: FR-002, FR-008

---

## FR-010: Jira-as-Code Sync

**Area:** Jira Integration | **Priority:** MUST | **Source:** requirements.md "Jira is maintained via code, NOT via the Jira UI. Code is the source of truth" / constitution.md "Jira-as-Code"

The system must implement bidirectional sync between workflow YAML task definitions and Jira issues, with code as the authoritative source of truth. On each sync cycle: (1) tasks defined in code but missing in Jira must be created, (2) tasks present in code and Jira must have their Jira metadata updated to match code if there is a drift, (3) tasks removed from code must be flagged (but not automatically deleted from Jira to prevent data loss). A conflict resolution policy must be enforced: when code and Jira disagree on a field value, code wins. The sync must store a mapping file that tracks the correspondence between workflow task IDs and Jira issue keys.

```gherkin
Feature: Jira-as-Code sync

  Scenario: New task in code creates Jira issue
    Given a workflow YAML with task "implement-auth" that has no corresponding Jira issue
    When the sync runs
    Then a Jira issue is created for "implement-auth"
    And the mapping file records the task ID to Jira issue key

  Scenario: Code change overwrites Jira on conflict
    Given task "implement-auth" has summary "Auth module" in code
    And the corresponding Jira issue has summary "Authentication" (manually changed)
    When the sync runs
    Then the Jira issue summary is updated to "Auth module"

  Scenario: Task removed from code is flagged but not deleted
    Given a Jira issue PROJ-55 corresponds to task "old-task" which has been removed from workflow YAML
    When the sync runs
    Then the Jira issue is labelled "orphaned-from-code"
    And the issue is NOT deleted from Jira
    And a warning is logged identifying the orphaned issue

  Scenario: Sync is idempotent
    Given the workflow YAML has not changed since the last sync
    When the sync runs again
    Then no Jira API write calls are made
    And the mapping file remains unchanged
```

Related: NFR-003, NFR-005 | Depends on: FR-001

---

## FR-011: Bitbucket PR Creation and Review Flow

**Area:** Bitbucket Integration | **Priority:** MUST | **Source:** requirements.md "coder will raise PR and notify channel" / constitution.md "PR-based code review flow"

The system must provide a Bitbucket adapter that creates pull requests, retrieves review comments, and supports the merge flow. When a coder agent completes an implementation task, the adapter must create a PR from the working branch to the target branch in the configured Bitbucket repository. The adapter must retrieve PR review comments (both file-level and general) and make them available to the agent for processing. After all review feedback is addressed and approvals are received, the adapter must merge the PR.

```gherkin
Feature: Bitbucket PR creation and review flow

  Scenario: Agent creates a PR after implementation
    Given a coder agent has completed task "implement-auth" on branch "feature/auth"
    And valid Bitbucket credentials are configured
    When the adapter creates a PR
    Then a PR is created from "feature/auth" to the configured target branch
    And the PR title and description are derived from the task metadata
    And a Slack notification is posted to the configured channel

  Scenario: Review comments are retrieved for agent processing
    Given a PR with 5 review comments from reviewer "LE-Lead"
    When the agent polls for review feedback
    Then all 5 comments are retrieved with file path, line number, author, and body

  Scenario: PR is merged after approval
    Given a PR has received the required number of approvals
    And all review comments are resolved
    When the merge is triggered
    Then the PR is merged to the target branch
    And a Slack notification confirms the merge
```

Related: NFR-002, NFR-005 | Depends on: FR-004

---

## FR-012: Bitbucket Pipeline Trigger

**Area:** Bitbucket Integration | **Priority:** SHOULD | **Source:** requirements.md "Bitbucket Pipeline" in scenario 1 tools list

The system must provide the ability to trigger a Bitbucket Pipeline run after a PR is merged to the target branch. The adapter must support triggering a named pipeline (or the default pipeline) for a given branch or tag. The adapter must poll or listen for pipeline completion status and report the outcome (pass/fail) back to the orchestrator.

```gherkin
Feature: Bitbucket pipeline trigger

  Scenario: Pipeline is triggered after PR merge
    Given a PR for task "implement-auth" has been merged to "master"
    And a Bitbucket pipeline is configured for the repository
    When the post-merge step executes
    Then a pipeline run is triggered for the "master" branch
    And the orchestrator records the pipeline run ID

  Scenario: Pipeline completion status is reported
    Given a pipeline run has been triggered with run ID "pipeline-123"
    When the pipeline completes with status "SUCCESSFUL"
    Then the orchestrator receives the success status
    And the task state advances accordingly

  Scenario: Pipeline failure is reported to Slack
    Given a pipeline run completes with status "FAILED"
    When the failure is detected
    Then a Slack notification is posted with the failure details and pipeline link
```

Related: NFR-005 | Depends on: FR-011

---

## FR-013: Configurable Stakeholder Sign-Off Threshold

**Area:** Workflow Engine | **Priority:** MUST | **Source:** requirements.md "configurable min stakeholder signoff" / constitution.md "Configurable stakeholder sign-off"

The system must allow each async task (or workflow-level default) to specify a minimum number of stakeholder approvals required before transitioning from AWAITING_APPROVAL to APPROVED. The threshold must be configurable in the workflow YAML at both the workflow defaults level and the individual task level (task-level overrides workflow default). The orchestrator must track which distinct stakeholders have approved and only transition when the count meets or exceeds the threshold. A threshold of 0 must mean no approval is required (auto-advance).

```gherkin
Feature: Configurable stakeholder sign-off threshold

  Scenario: Task requires 2 approvals and receives them
    Given an async task with min_approvals set to 2
    And the task is in AWAITING_APPROVAL state
    When stakeholder "PO-1" approves
    Then the task remains in AWAITING_APPROVAL (1 of 2)
    When stakeholder "PE-1" approves
    Then the task transitions to APPROVED (2 of 2 met)

  Scenario: Task-level threshold overrides workflow default
    Given a workflow default min_approvals of 1
    And task "design-l1" has min_approvals set to 3
    When "design-l1" enters AWAITING_APPROVAL
    Then 3 distinct approvals are required to advance

  Scenario: Threshold of zero auto-advances
    Given an async task with min_approvals set to 0
    When the task completes and would enter AWAITING_APPROVAL
    Then the task automatically transitions to APPROVED and then DOING
    And no Slack approval notification is sent

  Scenario: Duplicate approvals from same stakeholder are not counted
    Given an async task with min_approvals set to 2
    When stakeholder "PO-1" approves twice
    Then only 1 approval is counted
    And the task remains in AWAITING_APPROVAL
```

Related: NFR-003 | Depends on: FR-002, FR-005

---

## FR-014: End-to-End Async Collaboration Flow

**Area:** Integration / Orchestration | **Priority:** MUST | **Source:** requirements.md full "How will it work" scenario / constitution.md "Core Capabilities"

The system must support the complete end-to-end async collaboration flow: (1) BA agent produces a document in Confluence, (2) the agent notifies the Slack channel, (3) reviewers provide feedback via Confluence comments, (4) the agent is notified via Slack, (5) the agent reads feedback and updates the document, (6) the cycle repeats until approval, (7) upon approval the task transitions to DONE, (8) the next task begins. For code tasks: the coder raises a PR, notifies via Slack, reviewers leave feedback, the coder addresses feedback, and upon approval the PR is merged. This requirement validates that all individual adapters compose correctly.

```gherkin
Feature: End-to-end async collaboration flow

  Scenario: Document review cycle via Confluence and Slack
    Given a workflow with async task "define-requirements" assigned to BA agent
    When the BA agent produces the requirements document
    Then a Confluence page is created with the document content
    And a Slack notification is posted: "define-requirements ready for review"
    When a reviewer adds 2 inline comments on the Confluence page
    And posts a Slack message indicating feedback is ready
    Then the BA agent retrieves the 2 inline comments
    And updates the Confluence page with revisions
    And posts a Slack notification: "define-requirements updated, please re-review"
    When the required stakeholders approve via Slack
    Then the task transitions to DONE

  Scenario: Code review cycle via Bitbucket and Slack
    Given a workflow with async task "implement-auth" assigned to Coder agent
    When the Coder agent completes implementation
    Then a Bitbucket PR is created
    And a Slack notification is posted: "implement-auth PR ready for review"
    When a reviewer leaves feedback on the PR
    And posts a Slack message indicating review feedback
    Then the Coder agent retrieves the PR comments
    And pushes updated code to the PR branch
    And posts a Slack notification: "implement-auth PR updated"
    When the required approvals are received
    Then the PR is merged
    And the task transitions to DONE
```

Related: NFR-004, NFR-005 | Depends on: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-011

---

## FR-015: [MVP2] GitHub Issues Adapter

**Area:** GitHub Integration | **Priority:** SHOULD | **Source:** requirements.md "create abstraction on top of Github (using issue and project etc) to mimic Jira" / constitution.md "MVP 2 - GitHub Stack"

The system must provide a GitHub Issues adapter that mimics the Jira epic/sub-task model using GitHub Issues, labels, and milestones. Top-level task groups must be represented as GitHub Issues with an "epic" label. Individual tasks must be created as separate issues with a label referencing their parent epic. The adapter must implement the same adapter interface as the Jira adapter (FR-008) so that workflows can target either backend without changes to workflow YAML beyond the adapter configuration.

```gherkin
Feature: GitHub Issues adapter mimicking Jira

  Scenario: Task groups are created as epic-labelled issues
    Given a workflow YAML with 2 task groups and valid GitHub credentials
    When the engine syncs tasks to GitHub Issues
    Then 2 issues are created with the label "epic"
    And each issue title matches the task group name

  Scenario: Individual tasks are created with parent epic reference
    Given a task group "requirements" with 3 tasks
    When the engine syncs tasks to GitHub Issues
    Then 3 issues are created with the label "epic:requirements"
    And each issue title matches the task title

  Scenario: Same adapter interface as Jira
    Given a workflow previously configured for Jira
    When the adapter configuration is switched to GitHub Issues
    Then the workflow executes without modification to task definitions
    And all task tracking operations (create, update, transition) succeed
```

Related: NFR-001, NFR-006 | Depends on: FR-008 (shares interface contract)

---

## FR-016: [MVP2] GitHub PR Adapter

**Area:** GitHub Integration | **Priority:** SHOULD | **Source:** requirements.md scenario 2 "Github" / constitution.md "GitHub PRs and code review"

The system must provide a GitHub Pull Request adapter that implements the same adapter interface as the Bitbucket PR adapter (FR-011). The adapter must support: PR creation, retrieval of review comments, posting reply comments, approving/requesting changes, and merging the PR. After merge, the adapter must be capable of triggering a GitHub Actions workflow. Authentication via GitHub personal access token or GitHub App installation token provided through environment variables.

```gherkin
Feature: GitHub PR adapter

  Scenario: Agent creates a GitHub PR after implementation
    Given a coder agent has completed task "implement-auth" on branch "feature/auth"
    And valid GitHub credentials are configured
    When the adapter creates a PR
    Then a GitHub PR is created from "feature/auth" to the configured target branch
    And the PR title and description are derived from the task metadata

  Scenario: Review comments are retrieved
    Given a GitHub PR with 4 review comments
    When the agent polls for review feedback
    Then all 4 comments are retrieved with file path, line number, author, and body

  Scenario: PR is merged and Actions workflow is triggered
    Given a GitHub PR has received the required approvals
    When the merge is triggered
    Then the PR is merged to the target branch
    And a GitHub Actions workflow run is triggered for the target branch
```

Related: NFR-001, NFR-006 | Depends on: FR-011 (shares interface contract)

---

## FR-017: [MVP2] GitHub Project Board Adapter

**Area:** GitHub Integration | **Priority:** SHOULD | **Source:** requirements.md "Github project" / constitution.md "GitHub abstraction mimicking Jira via Issues + Projects + Labels"

The system must provide a GitHub Projects (v2) adapter that creates and manages a project board for workflow task tracking. The adapter must create a project board with columns mapped to the async task state machine states (configurable mapping, similar to FR-009). When a task transitions state, the corresponding project item must move to the mapped column.

```gherkin
Feature: GitHub Project board adapter

  Scenario: Project board is created with mapped columns
    Given a workflow configured for GitHub Projects
    And column mapping: AWAITING_APPROVAL -> "In Review", DOING -> "In Progress", DONE -> "Done"
    When the engine initializes the project board
    Then a GitHub Project is created with columns "In Review", "In Progress", and "Done"

  Scenario: Task state change moves project item
    Given a task "design-l1" linked to a GitHub Project item
    When the orchestrator transitions "design-l1" to AWAITING_APPROVAL
    Then the project item moves to the "In Review" column

  Scenario: Same interface as Jira board adapter
    Given a workflow configured for Jira Kanban boards
    When the adapter configuration is switched to GitHub Projects
    Then the workflow executes without modification to task definitions
```

Related: NFR-001, NFR-006 | Depends on: FR-009 (shares interface contract), FR-015

---

## FR-018: [MVP2] GitHub-as-Code Sync

**Area:** GitHub Integration | **Priority:** SHOULD | **Source:** requirements.md "Same model applies to GitHub Issues/Projects in MVP 2" / constitution.md "Jira-as-Code" applied to GitHub

The system must implement the same code-as-source-of-truth sync model for GitHub Issues and Projects as FR-010 implements for Jira. Workflow YAML task definitions must drive creation, update, and state of GitHub Issues. The implementation must share the same sync engine as FR-010, differing only in the adapter layer.

```gherkin
Feature: GitHub-as-Code sync

  Scenario: New task in code creates GitHub Issue
    Given a workflow YAML with task "implement-auth" that has no corresponding GitHub Issue
    When the sync runs
    Then a GitHub Issue is created for "implement-auth"
    And the mapping file records the task ID to GitHub Issue number

  Scenario: Code change overwrites GitHub Issue on conflict
    Given task "implement-auth" has title "Auth module" in code
    And the corresponding GitHub Issue has title "Authentication" (manually changed)
    When the sync runs
    Then the GitHub Issue title is updated to "Auth module"

  Scenario: Removed task is flagged not deleted
    Given a GitHub Issue corresponds to task "old-task" removed from workflow YAML
    When the sync runs
    Then the issue is labelled "orphaned-from-code"
    And the issue is NOT closed or deleted
    And a warning is logged

  Scenario: Sync shares engine with Jira-as-Code
    Given the sync engine used for Jira-as-Code (FR-010)
    When configured with a GitHub adapter
    Then the same sync logic (create, update, flag orphans, conflict resolution) executes
    And only the API adapter layer differs
```

Related: NFR-001, NFR-006 | Depends on: FR-010 (shares sync engine), FR-015

---

## NFR-001: Adapter Pluggability

**Category:** Maintainability | **Priority:** MUST

All collaboration tool integrations must be implemented behind well-defined TypeScript adapter interfaces. Each adapter interface must define a contract that is tool-agnostic, allowing new tool backends to be added by implementing the interface without modifying the workflow engine or orchestrator. There must be at least 4 distinct adapter interfaces: NotificationAdapter, DocumentAdapter, TaskTrackingAdapter, and CodeReviewAdapter. Adding a new adapter implementation must require zero changes to existing adapter code or engine code.

```gherkin
Feature: Adapter pluggability

  Scenario: New adapter implementation requires no engine changes
    Given the adapter interface for TaskTrackingAdapter
    When a new implementation "LinearAdapter" is created
    Then the new adapter file is the only file added or modified
    And the engine runs the workflow using "LinearAdapter" without code changes to engine.ts

  Scenario: At least 4 distinct adapter interfaces exist
    Given the adapter layer source code
    When the interfaces are enumerated
    Then at least 4 interfaces exist: NotificationAdapter, DocumentAdapter, TaskTrackingAdapter, CodeReviewAdapter
    And each interface defines at least 3 methods

  Scenario: Mock adapter satisfies interface for testing
    Given a MockTaskTrackingAdapter implementing TaskTrackingAdapter
    When the workflow engine is configured with the mock adapter
    Then the workflow executes end-to-end using the mock
    And all task tracking operations are recorded in the mock's call log
```

Related: FR-004, FR-006, FR-008, FR-011, FR-015, FR-016, FR-017

---

## NFR-002: Credential Security

**Category:** Security | **Priority:** MUST

All collaboration tool credentials must be sourced exclusively from environment variables or a secure configuration store. No credential must ever appear in workflow YAML files, log output, Slack messages, or error messages. The system must validate at startup that all required credentials for configured adapters are present, and must fail fast within 5 seconds with a clear error. Credential values must be redacted in all log output. Zero credential leaks must occur in any log file, console output, or persisted state file.

```gherkin
Feature: Credential security

  Scenario: Credentials sourced from environment variables only
    Given a Slack adapter configured with SLACK_BOT_TOKEN
    When the adapter initializes
    Then the token value is read from process.env.SLACK_BOT_TOKEN
    And no credential appears in any YAML config file in the repository

  Scenario: Missing credential produces clear startup error
    Given the environment variable CONFLUENCE_API_TOKEN is not set
    And the Confluence adapter is configured in the workflow
    When the engine starts
    Then the engine fails within 5 seconds
    And the error message contains "CONFLUENCE_API_TOKEN"
    And the error message does NOT contain any actual credential value

  Scenario: Credentials are redacted in logs
    Given a Slack API call that includes the bot token in the request
    When the call is logged at debug level
    Then the log entry contains "[REDACTED]" in place of the token value
    And zero occurrences of the actual token exist in any log file
```

Related: FR-004, FR-006, FR-011

---

## NFR-003: State Transition Auditability

**Category:** Compliance | **Priority:** MUST

Every state transition in the async task state machine must be recorded in an append-only audit log. Each audit entry must include: (1) timestamp in ISO 8601 format with millisecond precision, (2) task ID, (3) previous state, (4) new state, (5) actor identity, (6) trigger source, and (7) optional metadata. The audit log must be queryable by task ID and by time range. The log must retain all entries for the lifetime of the workflow session with zero gaps.

```gherkin
Feature: State transition auditability

  Scenario: Every state transition is logged with required fields
    Given an async task that transitions through 4 states: PENDING -> DOING -> AWAITING_APPROVAL -> APPROVED -> DONE
    When the audit log is queried for that task ID
    Then 4 entries are returned
    And each entry contains timestamp, task_id, previous_state, new_state, actor, and trigger_source
    And all timestamps are in ISO 8601 format with millisecond precision

  Scenario: Audit log is append-only
    Given an audit log with 10 entries
    When a new state transition occurs
    Then the log contains 11 entries
    And the first 10 entries are unchanged (byte-identical)

  Scenario: Audit log is queryable by task ID
    Given a workflow with 5 tasks each having 3 state transitions
    When the audit log is queried for task "design-l1"
    Then only the 3 entries for "design-l1" are returned
    And they are ordered by timestamp ascending
```

Related: FR-002, FR-009, FR-013

---

## NFR-004: Slack Message Latency

**Category:** Performance | **Priority:** MUST

Slack notification messages must be delivered to the Slack API within 5 seconds of the triggering event. The Slack listener must detect new messages within 10 seconds of posting. End-to-end latency from a stakeholder posting an approval message to the orchestrator receiving the parsed signal must not exceed 15 seconds. These thresholds apply when the Slack API is responsive (HTTP 200 within 3 seconds).

```gherkin
Feature: Slack message latency

  Scenario: Outbound notification delivered within 5 seconds
    Given the Slack API is responsive (HTTP 200 within 3 seconds)
    When an async task transitions to AWAITING_APPROVAL
    Then the Slack notification API call completes within 5 seconds of the transition event

  Scenario: Inbound message detected within 10 seconds
    Given the Slack listener is active on the configured channel
    When a stakeholder posts a message at time T
    Then the listener detects and parses the message by time T + 10 seconds

  Scenario: End-to-end approval signal within 15 seconds
    Given a stakeholder posts an approval message at time T
    And the Slack API is responsive
    When the approval is parsed and forwarded to the orchestrator
    Then the orchestrator receives the approval signal by time T + 15 seconds
```

Related: FR-004, FR-005

---

## NFR-005: External API Retry and Error Handling

**Category:** Reliability | **Priority:** MUST

All external API calls must implement retry logic with exponential backoff: maximum 3 retries, initial backoff of 1 second, backoff multiplier of 2 (delays of 1s, 2s, 4s). Retries must only be attempted for transient errors (HTTP 429, 500, 502, 503, 504). Non-transient errors (4xx except 429) must fail immediately. The system must respect the Retry-After header when present. After all retries are exhausted, the full error chain must be surfaced to the orchestrator.

```gherkin
Feature: External API retry and error handling

  Scenario: Transient error triggers retry with exponential backoff
    Given a Slack API call that returns HTTP 503 on the first 2 attempts
    And succeeds on the 3rd attempt
    When the adapter makes the API call
    Then 3 total attempts are made
    And the delays between attempts are approximately 1 second and 2 seconds
    And the final result is success

  Scenario: Non-transient error fails immediately
    Given a Confluence API call that returns HTTP 403 (Forbidden)
    When the adapter makes the API call
    Then no retry is attempted
    And the error is surfaced immediately to the orchestrator

  Scenario: All retries exhausted surfaces error with full chain
    Given a Jira API call that returns HTTP 500 on all 4 attempts (1 initial + 3 retries)
    When the adapter makes the API call
    Then the error surfaced to the orchestrator includes all 4 attempt errors
    And each retry attempt is logged with attempt number and delay

  Scenario: Rate limit respects Retry-After header
    Given a GitHub API call that returns HTTP 429 with Retry-After: 30
    When the adapter receives the response
    Then the next retry waits 30 seconds (not the calculated 1-second backoff)
```

Related: FR-004, FR-006, FR-007, FR-008, FR-010, FR-011, FR-012

---

## NFR-006: Adapter Interface Portability

**Category:** Maintainability | **Priority:** MUST

MVP 1 and MVP 2 must share identical adapter interface contracts. The TaskTrackingAdapter interface used by Jira must be the same interface implemented by GitHub Issues/Projects. The CodeReviewAdapter interface used by Bitbucket must be the same interface implemented by GitHub PRs. A workflow YAML must be able to switch between Atlassian and GitHub backends by changing only the adapter configuration block. Interface compatibility must be verified by automated tests: 100% of test cases must pass on both backend implementations.

```gherkin
Feature: Adapter interface portability

  Scenario: TaskTrackingAdapter interface is identical for Jira and GitHub
    Given the JiraTaskTrackingAdapter and GitHubTaskTrackingAdapter implementations
    When both are checked against the TaskTrackingAdapter interface
    Then both implement 100% of the interface methods
    And the method signatures (parameters and return types) are identical

  Scenario: Workflow switches backend with config-only change
    Given a workflow YAML targeting Jira for task tracking
    When the adapter config block is changed to target GitHub Issues
    And no other workflow YAML changes are made
    Then the workflow executes successfully with GitHub Issues as the backend

  Scenario: Shared test suite passes for both backends
    Given the adapter integration test suite with N test cases
    When run against the Jira adapter
    Then N of N tests pass
    When run against the GitHub adapter
    Then N of N tests pass
```

Related: FR-008, FR-009, FR-010, FR-011, FR-015, FR-016, FR-017, FR-018

---

## Open Decisions

1. **State machine integration**: The async state machine (AWAITING_APPROVAL, APPROVED, DOING, DONE) must be reconciled with the existing ai-sdd engine state machine (PENDING, RUNNING, COMPLETED, NEEDS_REWORK, HIL_PENDING, FAILED). The architect must decide whether to extend the existing machine or run a parallel one.
2. **Slack interaction model**: The exact message format for approval/rejection signals needs design -- options include structured text commands, Slack reactions, or interactive buttons.
3. **Confluence storage format conversion**: How agent-produced Markdown is converted to Confluence XHTML storage format is a design decision.
4. **Jira-as-Code conflict detection mechanism**: Hash comparison, timestamp comparison, or field-level diff -- to be decided at design time.
5. **AWAITING_APPROVAL timeout behaviour**: Auto-reject, escalation, or indefinite wait with reminders -- needs stakeholder input.
6. **Deployment pipeline scope**: Post-merge deployment steps are explicitly post-MVP.

## Out of Scope

- Auto-triggered deployment pipelines (CI, SIT, canary, prod) -- post-MVP
- Metric collection and automated smoke tests post-deployment
- Advanced approval routing (role-based, time-boxed) -- post-MVP
- Slack interactive features beyond channel posting and message listening
- Confluence page permission management
- Jira workflow scheme customisation
- Multi-repository support for Bitbucket/GitHub
- Bidirectional sync from Jira/GitHub back to workflow YAML
