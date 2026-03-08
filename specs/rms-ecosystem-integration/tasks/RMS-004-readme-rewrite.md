# RMS-004: Rewrite README with Ecosystem Context

**Phase:** 4
**Status:** PENDING
**Size:** S (0.5 days)
**Depends on:** —
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server

---

## What

Replace the current placeholder README with ecosystem-aware documentation that
explains RMS's role as the Traceability Engine in the three-project ecosystem.

## Current State

The README is a generic project scaffold description:
> "This is a project scaffold to experiment on and create MCP servers..."

This doesn't explain what the project does, how it relates to ai-sdd and
coding-standards, or how to use it.

## New README Structure

### 1. Title + One-Liner

> **repeatability-mcp-server** — Traceability Engine for AI-driven development.
> Builds, validates, queries, and exports requirements traceability graphs.

### 2. Ecosystem Context

Three-project architecture table:
- **This project (RMS)**: Traceability Engine — graph tooling
- **coding-standards**: Standards Library — schemas, prompts, language rules
- **ai-sdd**: Orchestrator — workflow engine, state machine, governance

### 3. Packages

| Package | Purpose |
|---------|---------|
| `requirement-lock-server` | MCP server + graph engine + validation + queries |
| `planlock-cli` | CLI for lock file operations |
| `agent-constitution-server` | Constitution document server |

### 4. Quick Start

Two workflows:
- **Session-based** (incremental graph building): `graph_init → graph_add_node → graph_add_edge → graph_validate → graph_export`
- **File-based** (query existing lock files): `lock_validate`, `lock_find_gaps`, `lock_coverage_report`, etc.

### 5. MCP Tools Reference

Table of all tools with input/output summaries.

### 6. Lock File Format

- Schema defined by coding-standards (`rules/requirements-lock.md`)
- RMS builds graphs and exports them as lock files
- ai-sdd tracks lock files as workflow artifacts

### 7. Development

```bash
pnpm install
pnpm test
pnpm build
```

## Acceptance Criteria

```gherkin
Scenario: README explains ecosystem role
  When a developer reads the README
  Then they understand RMS is the Traceability Engine
  And they know CS defines schemas, RMS implements tooling
  And they know ai-sdd is the orchestrator

Scenario: README lists all MCP tools
  When a developer reads the tools section
  Then all graph_* and lock_* tools are documented
  And each has input/output summary

Scenario: README shows both workflows
  When a developer reads quick start
  Then session-based workflow is shown
  And file-based workflow is shown
```
