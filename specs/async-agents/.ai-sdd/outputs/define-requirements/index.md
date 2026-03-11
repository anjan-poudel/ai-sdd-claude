# Requirements -- Async/Hybrid Workflow Collaboration for ai-sdd

## Summary
- Functional requirements: 18
- Non-functional requirements: 6
- Areas covered: Workflow Engine, Slack Integration, Confluence Integration, Jira Integration, Bitbucket Integration, GitHub Integration, Integration/Orchestration

## Contents
- [FR/index.md](FR/index.md) -- functional requirements
- [NFR/index.md](NFR/index.md) -- non-functional requirements

## Open decisions
1. **State machine complexity**: The stakeholder noted "if state machine adds a lot of complexity and has lots of touch points, let me know and we can rethink." The state machine as specified (AWAITING_APPROVAL, APPROVED, DOING, DONE) needs architectural validation to confirm it integrates cleanly with the existing ai-sdd state machine (PENDING, RUNNING, COMPLETED, NEEDS_REWORK, HIL_PENDING, FAILED). The architect must decide whether to extend the existing state machine or run a parallel one for async tasks.
2. **Slack interaction model**: The requirements specify "keep it simple for now, minimal integration." The exact message format for approval/rejection signals needs design -- options include structured text commands, Slack reactions, or Slack interactive buttons. This is an architecture/design decision.
3. **Confluence storage format conversion**: How agent-produced Markdown documents are converted to Confluence storage format (XHTML) needs to be decided at design time.
4. **Jira-as-Code conflict detection**: The sync model says "code always wins on conflict," but the detection mechanism (hash comparison, timestamp comparison, or field-level diff) is a design decision.
5. **Timeout behaviour for AWAITING_APPROVAL**: The stakeholder did not specify what happens on timeout -- options include auto-reject, escalation via Slack, or indefinite wait with periodic reminders. This needs stakeholder input.
6. **Deployment pipeline scope**: The stakeholder described post-merge deployment steps (CI, SIT, canary, prod) but marked these as "could be auto triggered or managed by humans." These are explicitly post-MVP and not in scope for this requirements set.

## Out of scope
- Auto-triggered deployment pipelines (CI -> SIT -> canary -> prod) -- marked as post-MVP in constitution.md
- Metric collection and automated smoke tests post-deployment
- Advanced approval routing (role-based, time-boxed) -- marked as post-MVP
- Slack interactive features beyond channel posting and message listening (buttons, modals, slash commands)
- Confluence page permission management
- Jira workflow scheme customisation (assumes standard Kanban scheme exists)
- Multi-repository support for Bitbucket/GitHub (single repo per workflow in MVP)
- Bidirectional sync from Jira/GitHub back to workflow YAML (code is source of truth; sync is one-directional with conflict resolution favouring code)
