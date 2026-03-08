# System Interplay: ai-sdd + coding-standards + repeatability-mcp-server

This document traces exactly what happens when a developer runs `/sdd-scaffold` followed by
`/sdd-run`, showing how the three systems interact throughout.

---

## The Three Systems

| System | Role | Key interface |
|--------|------|---------------|
| **ai-sdd** | Orchestrator — runs the workflow, manages state, dispatches agents, invokes overlays | CLI (`ai-sdd run`), engine, overlay chain |
| **coding-standards** | Standards library + MCP server — exposes schemas and `check_requirements` tool | MCP stdio transport (`coding-standards-gate` overlay) |
| **repeatability-mcp-server** | Requirement lock graph + validation — `lock_validate`, gap detection, coverage | MCP stdio transport (`repeatability-gate` overlay) |

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph Developer["Developer (Claude Code)"]
        SS["/sdd-scaffold skill"]
        SR["/sdd-run skill"]
    end

    subgraph ai_sdd["ai-sdd (orchestrator)"]
        CLI["CLI (ai-sdd run)"]
        ENGINE["Engine\n(workflow loop)"]
        STATE["StateManager\n(.ai-sdd/state/)"]
        OVERLAYS["Overlay Chain\nHIL → remote → policy_gate\n→ review → confidence"]
        AGENTS["Agent Dispatcher\n(ba / architect / pe / le / dev / reviewer)"]
        CONST["ConstitutionResolver\n(merges standards docs)"]
    end

    subgraph cs_mcp["coding-standards MCP server"]
        CS_TOOL["check_requirements tool"]
        CS_SCHEMA["requirements schemas\n(YAML)"]
        CS_DOCS["standards docs\n(AGENTS.md, rules/)"]
    end

    subgraph rms["repeatability-mcp-server"]
        RMS_TOOL["lock_validate tool"]
        RMS_GRAPH["InMemoryGraph\n(nodes: REQ/TASK/TEST)"]
        RMS_LOCK["lock_find_gaps\nlock_coverage_report"]
    end

    SS -->|"7 questions → scaffold artifacts"| ai_sdd
    SR -->|"ai-sdd status → spawn subagent → HIL → loop"| ai_sdd

    CLI --> ENGINE
    ENGINE --> STATE
    ENGINE --> AGENTS
    ENGINE --> OVERLAYS
    OVERLAYS -->|"post_task (implement phase)\nMCP stdio"| cs_mcp
    OVERLAYS -->|"post_task (implement phase)\nMCP stdio"| rms

    CONST -->|"standards/**/*.md merged\ninto agent prompt"| AGENTS
    CS_DOCS -.->|"auto-discovered by\nConstitutionResolver"| CONST
```

---

## 2. /sdd-scaffold Flow

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Skill as sdd-scaffold skill
    participant Init as ai-sdd init
    participant Sub as Task(sdd-scaffold subagent)
    participant FS as File system

    Dev->>Skill: /sdd-scaffold

    Skill->>Init: ai-sdd init --tool claude_code
    Init->>FS: copy .ai-sdd/workflows/default-sdd.yaml
    Init->>FS: copy .claude/skills/ (sdd-run, sdd-status, sdd-scaffold)
    Init->>FS: copy .claude/agents/ (ba, architect, pe, le, dev, reviewer)

    loop 7 questions
        Skill->>Dev: Q1…Q7 (what, platform, stack, safety, compliance, scale, constraints)
        Dev->>Skill: answers
    end

    loop up to 5 clarifying questions
        Skill->>Dev: follow-up gaps
        Dev->>Skill: answers or skip
    end

    Skill->>Sub: Task(sdd-scaffold, brief + answers)
    Sub->>FS: write constitution.md
    Sub->>FS: write .ai-sdd/ai-sdd.yaml  ← includes overlay_backends + remote_overlays
    Sub->>FS: write specs/workflow.yaml   (or specs/<feature>/workflow.yaml)
    Sub->>FS: write docs/init-report.md

    Sub-->>Skill: files created + Open Decisions list
    Skill->>Dev: "Review constitution.md, resolve open decisions, then /sdd-run"
```

**What gets wired in during scaffold:**
- `ai-sdd.yaml` is written with `overlay_backends` for both MCP servers and `remote_overlays`
  entries for `repeatability-gate` and `coding-standards-gate` (post_task on implement, non-blocking)
- `constitution.md` merges any `standards/**/*.md` found in the project — the coding-standards
  docs copied during init are auto-discovered here

---

## 3. /sdd-run: Full Workflow Loop

```mermaid
flowchart TD
    START(["/sdd-run"]) --> STATUS1["ai-sdd status --json\n→ find next READY task"]
    STATUS1 --> SPAWN["Spawn subagent\nTask(sdd-ba | sdd-architect | sdd-pe\n     sdd-le | sdd-dev | sdd-reviewer)"]
    SPAWN --> AGENT_WORK["Agent reads constitution.md\n+ task spec + outputs from prior tasks\nproduces artifact via complete-task"]
    AGENT_WORK --> HIL_CHECK["ai-sdd hil list --json\nany PENDING?"]

    HIL_CHECK -->|yes| HIL_SHOW["Show item to developer\nApprove / reject?"]
    HIL_SHOW -->|approve| HIL_RES["ai-sdd hil resolve &lt;id&gt;"]
    HIL_SHOW -->|reject| HIL_REJ["ai-sdd hil reject &lt;id&gt;"]
    HIL_RES --> STATUS2
    HIL_REJ --> STATUS2
    HIL_CHECK -->|no| STATUS2

    STATUS2["ai-sdd status --json\nshow updated table"] --> CONTINUE{{"Continue?\nyes / no / done"}}
    CONTINUE -->|yes| STATUS1
    CONTINUE -->|no / done| END([workflow complete])
```

---

## 4. Engine Overlay Chain (per task)

For every task the engine dispatches, it runs the overlay chain twice:
**pre_task** (before the agent runs) and **post_task** (after the agent produces output).

```mermaid
sequenceDiagram
    participant E as Engine
    participant HIL as HIL overlay\n(pre only)
    participant RG as repeatability-gate\n(post_task, implement)
    participant CSG as coding-standards-gate\n(post_task, implement)
    participant PG as PolicyGate overlay\n(post_task)
    participant CON as Confidence overlay
    participant A as Agent (e.g. sdd-dev)
    participant RMS as repeatability-mcp-server
    participant CS as coding-standards MCP

    note over E,CON: pre_task chain
    E->>HIL: invokePre(ctx)
    HIL-->>E: PASS (or HIL_PENDING → await resolution)

    note over E,A: agent execution
    E->>A: dispatch task prompt
    A-->>E: TaskResult (outputs, handover_state)

    note over E,CON: post_task chain (implement phase only for remote overlays)
    E->>RG: invokePost(ctx, result)
    RG->>RMS: MCP stdio connect + lock_validate(input)
    RMS-->>RG: OverlayInvokeOutput {verdict, feedback, evidence}
    RG-->>E: OverlayDecision {verdict, evidence}\n(blocking:false → FAIL shows in evidence only)

    E->>CSG: invokePost(ctx, result)
    CSG->>CS: MCP stdio connect + check_requirements(input)
    CS-->>CSG: OverlayInvokeOutput
    CSG-->>E: OverlayDecision\n(blocking:false)

    E->>PG: invokePost(ctx, result)
    PG-->>E: PASS / FAIL (risk tier check)

    E->>CON: invokePost(ctx, result)
    CON-->>E: advisory score
```

---

## 5a. Auto-Discovery: How ai-sdd Finds `overlay_invoke`

When `tool:` is absent from an `overlay_backends` entry, ai-sdd runs tool discovery at startup
before building the overlay chain:

```mermaid
sequenceDiagram
    participant R as run.ts (startup)
    participant RBT as resolveBackendTools()
    participant CW as McpClientWrapper
    participant RMS as MCP server process

    R->>RBT: resolveBackendTools(remoteConfig)
    loop each MCP backend with no tool: set
        RBT->>CW: new McpClientWrapper(backendConfig)
        RBT->>CW: connect()
        CW->>RMS: spawn subprocess + MCP initialize
        RBT->>CW: listTools()
        CW->>RMS: tools/list request
        RMS-->>CW: [{name:"graph_init",...}, {name:"overlay_invoke", inputSchema:{required:["protocol_version","overlay_id","hook"],...}}, ...]
        RBT->>RBT: fingerprint check — find first tool where\nrequired[] ⊇ [protocol_version, overlay_id, hook]
        note over RBT: match → "overlay_invoke"
        RBT->>CW: disconnect()
    end
    RBT-->>R: Map{ "repeatability-mcp" → "overlay_invoke",\n      "coding-standards-mcp" → "overlay_invoke" }
    R->>R: buildProviderChain({resolvedBackendTools: Map{...}})
    note over R: McpOverlayProvider constructed with\nresolvedToolName = "overlay_invoke"
```

The fingerprint (`required[]` ⊇ `[protocol_version, overlay_id, hook]`) is the full contract.
Any MCP server that exposes a tool matching it is automatically registered as a remote overlay
— no explicit `tool:` config needed.

---

## 5. What Each MCP Server Receives and Returns

```mermaid
graph LR
    subgraph INPUT["OverlayInvokeInput (sent by McpOverlayProvider)"]
        I1["protocol_version: '1'"]
        I2["overlay_id: 'repeatability-gate'"]
        I3["hook: 'post_task'"]
        I4["workflow.id + run_id"]
        I5["task.id, phase, requirement_ids,\nacceptance_criteria"]
        I6["result.outputs[]\nresult.handover_state"]
    end

    subgraph RMS_OUT["repeatability-mcp-server response"]
        R1["verdict: PASS | REWORK | FAIL | HIL"]
        R2["feedback: gap list or 'all covered'"]
        R3["evidence.checks[]: per-requirement status"]
    end

    subgraph CS_OUT["coding-standards MCP response"]
        C1["verdict: PASS | REWORK | FAIL"]
        C2["feedback: standards violations found"]
        C3["evidence.report_ref: schema check URL"]
    end

    INPUT -->|"MCP tool call\n(overlay_invoke — auto-discovered)"| RMS_OUT
    INPUT -->|"MCP tool call\n(overlay_invoke — auto-discovered)"| CS_OUT
```

---

## 6. Failure / Availability Paths

```mermaid
flowchart LR
    START["ai-sdd run startup"] --> PROBE["Probe backend paths\n(command[] absolute paths)"]

    PROBE -->|"path exists"| ACTIVE["overlay added to chain"]
    PROBE -->|"path missing"| WARN["console.warn + skip\n(no chain entry)"]

    ENV1["AI_SDD_DISABLE_REMOTE_OVERLAYS=true"] -->|override| SKIP_ALL["all remote overlays skipped"]
    ENV2["AI_SDD_DISABLE_OVERLAY_REPEATABILITY_GATE=true"] -->|override| SKIP_ONE["that overlay skipped"]
    CFG["enabled: false in ai-sdd.yaml"] -->|override| SKIP_SILENT["silently omitted"]

    ACTIVE --> INVOKE["invoke at post_task"]
    INVOKE -->|"connect/call fails"| T1{"failure_policy"}
    T1 -->|warn| WARN2["emit overlay.remote.failed\n+ overlay.remote.fallback\nreturn PASS"]
    T1 -->|skip| WARN3["emit overlay.remote.fallback only\nreturn PASS"]
    T1 -->|fail_closed| FAIL["return FAIL verdict"]

    INVOKE -->|"response received"| SCHEMA{"schema valid?"}
    SCHEMA -->|yes| DECISION["emit overlay.remote.decision\nreturn verdict"]
    SCHEMA -->|no| ALWAYS_FAIL["always FAIL\n(Tier 2 — never overridden)"]
```

---

## 7. Data Produced by Each System per Workflow Run

```mermaid
graph TB
    subgraph SCAFFOLD["After /sdd-scaffold"]
        A1["constitution.md\n(project rules + standards)"]
        A2[".ai-sdd/ai-sdd.yaml\n(adapter, overlays, MCP backends)"]
        A3["specs/workflow.yaml\n(task DAG)"]
        A4["docs/init-report.md\n(open decisions)"]
    end

    subgraph RUN["During /sdd-run (per task)"]
        B1["specs/define-requirements.md\n(BA output)"]
        B2["specs/design-l1.md\n(Architect output)"]
        B3["specs/design-l2.md\n(PE output)"]
        B4["specs/plan-tasks/plan.md\n(LE output)"]
        B5["src/**/*.ts\n(Dev output)"]
        B6["specs/review-*.md\n(Reviewer output)"]
    end

    subgraph OVERLAYS["Overlay evidence (implement phase)"]
        C1["overlay_evidence.checks[]\nin workflow-state.json\n(repeatability-gate)"]
        C2["overlay_evidence.feedback\nin workflow-state.json\n(coding-standards-gate)"]
        C3["constitution.md artifact manifest\n(updated by complete-task)"]
    end

    SCAFFOLD --> RUN
    RUN -->|"post_task MCP calls"| OVERLAYS
```

---

## Summary: Three-System Contract

| Moment | ai-sdd does | coding-standards does | repeatability-mcp-server does |
|--------|-------------|----------------------|-------------------------------|
| **scaffold** | writes `ai-sdd.yaml` with MCP backend entries | standards docs auto-discovered into `constitution.md` | — |
| **pre_task (any)** | HIL gate fires if T0/T2 or `hil.enabled` | — | — |
| **agent prompt assembly** | `ConstitutionResolver` merges `standards/**/*.md` | rules, schemas embedded in every agent prompt | — |
| **implement (agent runs)** | dispatches `sdd-dev` subagent with full context | standards docs are part of the constitution prompt | — |
| **implement post_task** | probes paths → connects MCP → calls tool → stores evidence | validates outputs against requirements schemas → returns verdict | validates requirement lock coverage → detects gaps → returns verdict |
| **FAIL verdict (blocking:false)** | records evidence in state, task still COMPLETES | — | — |
| **FAIL verdict (blocking:true)** | task → NEEDS_REWORK, agent retried | — | — |
