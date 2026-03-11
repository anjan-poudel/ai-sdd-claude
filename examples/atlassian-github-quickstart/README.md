# Atlassian + GitHub Quickstart

Run a full ai-sdd workflow with Slack notifications, Confluence docs,
Jira issue tracking, and GitHub PRs — in 4 steps.

## Prerequisites

| Tool | Min version |
|------|-------------|
| [Bun](https://bun.sh) | 1.0+ |
| [Claude Code CLI](https://claude.ai/code) | latest |
| Slack workspace (admin or bot-token access) | — |
| Atlassian Cloud account (Jira + Confluence) | — |
| GitHub account | — |

---

## Step 1 — Copy and fill in credentials

```bash
cp .env.example .env
# Edit .env and fill in every value — nothing will work without real tokens
```

### Where to get each token

| Variable | Where |
|----------|-------|
| `SLACK_BOT_TOKEN` | [api.slack.com/apps](https://api.slack.com/apps) → OAuth & Permissions → Bot Token. Scopes needed: `chat:write`, `channels:history`, `channels:read` |
| `CONFLUENCE_API_TOKEN` | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_API_TOKEN` | Same Atlassian API token as Confluence |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) → Classic token. Scopes: `repo`, `project` |

---

## Step 2 — Initialise the project

```bash
# From this directory:
ai-sdd init --tool claude_code

# Copy the config files into .ai-sdd/
cp ai-sdd.yaml .ai-sdd/ai-sdd.yaml
cp workflow.yaml .ai-sdd/workflows/default-sdd.yaml
```

---

## Step 3 — Export credentials

```bash
export $(grep -v '^#' .env | xargs)
```

Or use [direnv](https://direnv.net/) — add `.envrc`:

```bash
dotenv .env
```

---

## Step 4 — Run

```bash
ai-sdd run
```

Or from Claude Code, type:

```
/sdd-run
```

---

## What happens

```
define-requirements  →  Slack HIL prompt posted to #ai-sdd-notifications
                         Confluence page created: "define-requirements"
                         Jira issue created: MYPROJ-1

design-l1            →  Confluence page: "design-l1"
                         Jira issue: MYPROJ-2
review-l1            →  (automated — no HIL unless reviewer returns NO_GO)

design-l2            →  Confluence page: "design-l2"
review-l2            →  (automated)

plan-tasks           →  Task list synced to Jira (one issue per task)

implement            →  GitHub PR opened against `main`
                         Reviewer agent reviews the PR

review-implementation → Confluence page: "review-implementation"
                         Slack HIL prompt for final sign-off

final-sign-off       →  Slack message: workflow complete
```

---

## Approving HIL gates via Slack

When the engine pauses for human approval it posts a message like:

```
*[ai-sdd] HIL Required: define-requirements*
Task: `define-requirements`
Artifact: https://yourorg.atlassian.net/wiki/...

To approve: `@ai-sdd approve define-requirements`
To reject:  `@ai-sdd reject define-requirements <reason>`
```

Reply in the channel — the workflow resumes automatically within ~5 seconds.

---

## Resuming after a restart

State is persisted to `.ai-sdd/sessions/default/workflow-state.json`.
Just re-run:

```bash
ai-sdd run
```

It picks up exactly where it left off. To start fresh, delete the state file:

```bash
rm .ai-sdd/sessions/default/workflow-state.json
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variables` | Check `.env` is exported — run `export $(grep -v '^#' .env \| xargs)` |
| Slack messages not appearing | Invite the bot to the channel: `/invite @your-bot-name` |
| Jira `403 Forbidden` | Confirm the API token has project-level write access |
| Confluence `404` on space | Check `CONFLUENCE_SPACE_KEY` matches the space key in your Confluence URL |
| GitHub `401 Unauthorized` | Regenerate the PAT — classic tokens expire |
| `Claude Code cannot be launched inside another Claude Code session` | Already fixed in the adapter. If you see this, ensure you're on the latest build of ai-sdd. |
