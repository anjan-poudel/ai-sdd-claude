this is a feature to support async collaboration using collaboration tools like Confluence, Jira, Bitbucket, Github, Github Project/Issue, Slack etc.
Agents will do their work and then send notification in a room and notify stakeholders that their tasks are ready for review.
Orchestrator will wait until it gets approval **signals* from stakeholders ( configurable min stakeholder signoff).
Orchestrator will maintain a state machine and then move the task state from AWAITING_XXX_APPROVAL to XXX_APPROVED and DOING_XXX, XXX_DONE etc.
if state machine adds a lot of complexity and has lots of touch points, let me know and we can rethink.

scenarios:
Confluence is in all scenarios

scenario 1:
tools: Jira,Bitbucket, Bitbucket Pipeline

scenario 2:
tools: Github Issues,Github, Github Action, Github project.

Agents will follow the Jira model closely.
It will mimic Epics and Sub-Tasks etc in Github environment using labels, and Project etc.
Jira transition will follow Agile Kanban workflow with appropriate swimlanes for visibility.
Same goes for Github Issues ( and Github Project)

How will it work:
- BA produces doc in Confluence under a configured space/folder
- PE/PO reviews teh doc and provide feedback in inline and standard comments. 
- After each response, agent will notify other agents via Slack message in a channel ( keep it simple for now, minimal integration)
- And agents will respond based on Slack message and what they are waiting on.
- For documents all authoring and feedback will be done in Confluence.
- For code coder will raise PR and notify channel
- LE and others will review code and leave feedback in BB/GH and notify coder via slack.
- Coder addresses the review and notify reviewers vis slack
- the feedback loop continues.
- then once review passes, 
- merge to master
  (below happens asynchronously and could be auto triggered or managed by humans)
- cut release
- deploy to CI and test
- deploy to SIT
- run smoke tests
- deploy canary or blue/green to prod
- optional tests and metric collection
- deploy all nodes.

Note: Slack is the primary medium for communication and all agents wait on slack messages and respond using slack messages.


MVP:
- integrate with slack,confluence, bitbucket and jira

MVP 2:
- create abstraction on top of Github ( using issue and project etc) to mimic Jira
- integrate with Github and Github Issue/Project


Jira-as-Code:
- Jira tickets (epics, stories, sub-tasks) will be synced with tasks defined in code (workflow YAML / specs).
- Jira is maintained via code, NOT via the Jira UI. Code is the source of truth.
- Task definitions in workflow YAML drive creation/update of corresponding Jira tickets.
- Same model applies to GitHub Issues/Projects in MVP 2 — code drives ticket state, not the UI.

Task:
Please propose a plan to allow a mix of sync and async tasks in workflows.

Allow the workflow tasks to be configured either as sync or async. task items can be sync or async.
workflow can be fully async or fully sync, or hybrid.
Ensure that the framework can handle both asyn and sync task workloads.
First if there are major concerns raise it before moving to next phase- planning & impl.


