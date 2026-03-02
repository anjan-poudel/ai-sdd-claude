# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

## Project Overview

`ai-sdd` is an AI-driven Software Design & Development orchestration framework. It runs YAML-defined multi-agent workflows where each task is dispatched to an LLM agent (e.g., Claude Code, OpenAI). The framework supports overlays for human-in-the-loop (HIL), evidence-gated reviews, confidence scoring, and paired workflows.

The project is written in TypeScript and runs on Bun. It uses Zod for schema validation.

The core of the framework is an engine that orchestrates the workflow, manages state, and dispatches tasks to different AI models through a system of adapters. The project is designed to be highly modular and configurable, with a strong emphasis on security and reliability.

A key architectural principle is the "pull model" for context management. The engine maintains a manifest of artifacts produced by tasks, and agents are expected to use their native tools to pull the context they need, rather than having the engine push a large context bundle to them.

## Building and Running

### Installation

```bash
bun install
```

### Running Tests

```bash
# Run all tests
bun test

# Run a single test file
bun test tests/dsl.test.ts

# Run tests in watch mode
bun test --watch
```

### Type Checking

```bash
bun run typecheck
```

### Running the CLI

```bash
bun run src/cli/index.ts --help
```

The CLI has the following commands:
* `run`: Execute or resume a workflow.
* `status`: Check the status of a workflow.
* `hil`: Manage the human-in-the-loop queue.
* `complete-task`: For agents to mark a task as complete.
* `validate-config`: Validate all YAML configs.
* `constitution`: Print the merged constitution.
* `init`: Initialize `ai-sdd` in a project.
* `serve`: Start as a server.
* `migrate`: For schema migrations.

## Development Conventions

*   **Language**: TypeScript (strict mode)
*   **Runtime**: Bun (no build step required)
*   **Schema Validation**: Zod v3
*   **CLI**: Commander.js
*   **Configuration**: YAML for workflows, agents, and project configuration.
*   **State Management**: State is managed atomically, with a "tmp+rename" pattern for persistence.
*   **Expression DSL**: A safe, custom DSL is used for `exit_conditions` and gate expressions. No `eval()` is used.
*   **Security**: The framework includes features for prompt injection detection, secret detection in outputs, and path traversal prevention.
*   **Project Structure**:
    *   `src/core`: Core engine, state manager, loaders.
    *   `src/adapters`: Adapters for different LLMs.
    *   `src/cli`: CLI commands.
    *   `src/dsl`: The custom expression DSL parser and evaluator.
    *   `src/overlays`: Implementation of the different overlays.
    *   `data`: Default configurations for agents, workflows, and tasks.
    *   `specs`: Planning and design documents.
    *   `tests`: Tests for the different parts of the application.
