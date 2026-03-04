# Comprehensive Analysis: coding-standards → ai-sdd-claude Integration
**Date:** 2026-03-03
**Analysis by:** Claude Code (deepseek-chat model)
**Based on:** Existing MERGE-PROPOSAL-CODING-STANDARDS.md + Deep analysis of both codebases

---

## Executive Summary

Two perfectly complementary projects:
- **coding-standards** (v2.1): *What should be built?* — Requirements discipline, validation gates, gold-plating prevention
- **ai-sdd-claude** (current): *How should it be built?* — Workflow orchestration, overlay chain, state machine, multi-adapter support

**Strategic Opportunity:** Merge coding-standards' rigorous requirements discipline into ai-sdd-claude's orchestration engine to create a unified AI-assisted development platform with:
1. **Requirements traceability** throughout the workflow DAG
2. **Automated gold-plating prevention** via scope exclusion gates
3. **Confidence-based task dispatch** with explicit GO protocol
4. **Enterprise-grade validation** integrated into the overlay chain

---

## Deep Analysis of Both Projects

### coding-standards Core Strengths

#### 1. Requirements Discipline Framework
- **`requirements.lock.yaml`** — Immutable YAML contract with hash verification
- **Graph-encoded relationships** — REQ → DEC → CONTRACT → TEST traceability
- **Conservative specification** — Under-specify rather than over-specify; extract from evidence only

#### 2. Validation Gates (6-layer semantic drift detection)
- **Gate 0**: Spec Identity — Hash verification of lock + OpenAPI
- **Gate 1**: Contract Stability — Breaking/non-breaking change detection
- **Gate 2**: Scope Compliance — Active scanning for excluded terms (gold-plating prevention)
- **Gate 3**: Architecture Conformance — Dependency direction, layer violations
- **Gate 4**: Behavior Drift — Acceptance test immutability when spec unchanged
- **Gate 5**: Non-Functional Drift — Performance, security constraint verification

#### 3. Eval/Steering Engine (Proactive generation guidance)
- **Multi-candidate eval** — Generate 5 candidates, score, select best
- **Constrained generation** — Build prompts from lock constraints
- **Test-driven generation** — AC → tests → implementation workflow
- **Deterministic contracts** — Template-based generation (zero LLM variability)
- **Validation-as-steering** — Use validation failures to guide regeneration

#### 4. Agent System & Protocols
- **90% Confidence Rule** — No code before confidence ≥90%
- **GO Protocol** — Explicit "GO" approval required after confidence check
- **Agent Constitution** — Mandatory non-negotiable baseline for all agents
- **Planning Reviewer** — Mandatory review even at 100% confidence

#### 5. Tooling & Infrastructure
- **MCP Server** — Model Context Protocol integration for tool-agnostic validation
- **Query Engine** — Graph traversal for impact analysis
- **CI/CD Scripts** — `reproducibility-check.sh`, `semantic-drift-check.sh`
- **GitHub Actions Templates** — Ready-to-use validation pipelines

### ai-sdd-claude Core Strengths

#### 1. Orchestration Engine
- **Workflow DAG** — Topological sort with Kahn's algorithm, cycle detection
- **Concurrency Management** — Parallel task execution with dependencies
- **State Machine** — Strict `VALID_TRANSITIONS` enforcement
- **Atomic Transactions** — `complete-task` as single boundary with path allowlisting

#### 2. Overlay Chain (Fixed-order composition)
```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence → Agent Execution
```
- **Invariant enforcement** — T2 risk tier always triggers HIL; Paired/Review mutually exclusive
- **Composition rules** — Validated by `composition-rules.ts`

#### 3. Multi-Adapter Architecture
- **Base adapter interface** — Common interface for all AI providers
- **Factory pattern** — `claude-code-adapter.ts`, `openai-adapter.ts`, `mock-adapter.ts`
- **Tool-agnostic integration** — MCP server for CLI tooling

#### 4. Task Library System
- **12 reusable templates** — Role primitives + named stages
- **4-layer merge semantics** — ENGINE_TASK_DEFAULTS → workflow defaults → use: → task inline
- **Template substitution** — `{{task_id}}` in output paths

#### 5. Development Standards (From CLAUDE.md)
- **Config-to-behaviour tests** — Every config field must have a behavior test
- **Integration point tests** — Verify component wiring, not just unit tests
- **No silent stubs** — Deferred features must throw explicit failures
- **Error messages are contracts** — Verified by tests
- **No empty directories** — Dangling references prevention
- **One integration test per CLI command** — End-to-end validation

---

## Gap Analysis: What Each Project Lacks

### What coding-standards lacks (ai-sdd has it)
| Feature | ai-sdd Implementation | Why Not to Port |
|---------|----------------------|-----------------|
| Workflow orchestration | DAG with topological sort | Core engine capability |
| Overlay chain | Fixed-order composition with rules | Sophisticated overlay system |
| Multi-adapter support | Factory pattern with common interface | Already superior |
| Atomic transactions | `complete-task` boundary | Critical for MCP server |
| State machine enforcement | `VALID_TRANSITIONS` in TypeScript | More rigorous than YAML |
| Expression DSL | `parser.ts` + `evaluator.ts` (no eval) | Already implemented |
| Development standards | Comprehensive testing requirements | Should adopt, not replace |

### What ai-sdd-claude lacks (coding-standards has it)
| # | Feature | Value | Phase |
|---|---------|-------|-------|
| CS-01 | `requirements.lock.yaml` as source of truth | Very High | 2 |
| CS-02 | 90% Confidence Rule + GO Protocol | Very High | 1 |
| CS-03 | Gherkin BDD acceptance criteria | Very High | 2 |
| CS-04 | Planning Reviewer gate | High | 3 |
| CS-05 | `scope.excluded` + Gate 2 scanning | High | 2 |
| CS-06 | Scope budgets (max_files, max_loc, max_apis) | Medium | 2 |
| CS-07 | Spec hash tracking | High | 2 |
| CS-08 | Phase-based model routing | High | 3 |
| CS-09 | Agent constitution (mandatory baseline) | High | 1 |
| CS-10 | Semantic drift detection scripts | Medium | 4 |
| CS-11 | Diff-aware lock regeneration | Medium | 4 |
| CS-12 | Toolgate.yaml evidence-gated config | Medium | 1 |
| CS-13 | Budget enforcement in CI | Medium | 4 |
| **NEW** | **MCP query engine integration** | **High** | **3** |
| **NEW** | **Cross-project validation** | **Medium** | **4** |

---

## Enhanced 5-Phase Integration Strategy

### Phase 0: Foundation & MCP Server Unification (Immediate)
**Goal:** Merge coding-standards MCP infrastructure with ai-sdd's existing MCP server

**Key Components:**
1. **Unified MCP Tool Registration** — Register coding-standards validation tools
2. **Query Engine Integration** — Graph-based requirement queries across workflows
3. **Centralized Gate Execution** — Run validation gates via MCP across all tools

**Implementation:**
- Merge `tools/mcp-server/` from coding-standards into ai-sdd's MCP infrastructure
- Create abstract tool registration layer with versioned APIs
- Maintain backward compatibility for existing tools

### Phase 1: Zero-Code Wins (1-2 days)
**Enhanced from original proposal:**

#### 1.1 Agent Constitution + MCP Tool Registration
- Embed constitution in ALL agent prompts (not just Claude Code)
- Register coding-standards validation scripts as MCP tools
- Add validation gate awareness to `ai-sdd status` output

#### 1.2 90% Confidence Rule + GO Protocol
- Formalize existing QnA loop with confidence scoring
- Add explicit "LOCKED REQUIREMENTS" header to specification outputs
- Require "GO" approval before task dispatch

#### 1.3 Toolgate Template + MCP Integration
- Include MCP tool references in `toolgate.yaml`
- Add budget configuration for future enforcement
- Document MCP tool usage in project initialization

#### 1.4 Planning Artefacts Convention + Query Support
- Standardize `plans/<feature-name>/` location
- Enable MCP query engine to index planning artefacts
- Add traceability links between plans and requirements

### Phase 2: Schema Extensions (3-5 days)
**Prioritized for maximum early value:**

#### 2.1 Gherkin Acceptance Criteria in Task Definitions (Highest Value)
```typescript
// Schema addition
interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}

interface TaskDefinition {
  acceptance_criteria?: AcceptanceCriterion[];
  requirement_ids?: string[]; // Traceability links
}
```

#### 2.2 Scope Excluded Enforcement in PolicyGateOverlay (Critical Prevention)
- Add `scope_excluded?: string[]` to task definitions
- Implement Gate 2 scanning in `PolicyGateOverlay.postTask`
- Fail task on excluded term detection (gold-plating prevention)

#### 2.3 Requirements Lock Integration (Foundation)
```typescript
// workflow-state.json extension
interface WorkflowState {
  requirements_lock?: {
    path: string;
    spec_hash: string;
    locked_at: string;
  };
}
```

#### 2.4 Spec Hash Tracking (Simple Drift Detection)
- Compute SHA256 of lock file at workflow start
- Emit `requirements.lock.changed` event on hash mismatch
- Display hash status in `ai-sdd status --metrics`

#### 2.5 Scope Budgets (Optional, Deferrable)
```typescript
interface TaskBudget {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
}
```

### Phase 3: New Overlay Features & MCP Integration (5-8 days)

#### 3.1 Planning Review Overlay with MCP-powered Validation
```typescript
// New overlay chain order
HIL → Planning Review → Evidence Gate → [Coding-Standards Gates] → Agentic Review → Paired → Confidence → Dispatch
```

**MCP Integration:**
- Use coding-standards query engine for impact analysis
- Validate against organization-wide requirements libraries
- Cross-project dependency validation

#### 3.2 Phase-Based Model Routing with Budget Awareness
```yaml
# Enhanced adapter configuration
adapter:
  type: claude_code
  phase_routing:
    planning:
      type: openai
      model: gpt-4o
      temperature: 0.2
    planning_review:
      type: claude_code
      model: claude-opus-4-6
      temperature: 0.0
    # ... other phases
```

#### 3.3 Requirements Traceability in `complete-task`
- Validate AC coverage in `handover_state.ac_coverage`
- Transition to `NEEDS_REWORK` for uncovered acceptance criteria
- Generate traceability reports via MCP query engine

### Phase 4: Tooling & CI/CD Integration (3-5 days)

#### 4.1 Unified Validation Scripts with MCP Support
- Port `reproducibility-check.sh` and `semantic-drift-check.sh`
- Add MCP tool invocation options
- Integrate with ai-sdd's existing script architecture

#### 4.2 GitHub Actions Template with Multi-Project Support
```yaml
# Enhanced CI template
- name: Cross-project requirements validation
  run: |
    mcp-tool validate-requirements \
      --project . \
      --library ../shared-requirements
```

#### 4.3 Toolgate Budget Enforcement with MCP Metrics
- Extend budget checking with MCP metric collection
- Track budget compliance across organization
- Generate budget utilization reports

#### 4.4 Diff-Aware Lock Regeneration Workflow Task
- Add `regenerate-requirements-lock` to task library
- Integrate diff classification (breaking/significant/minor)
- Update spec hash in workflow-state.json automatically

### Phase 5: Advanced Features & Scaling (Future)

#### 5.1 Organization-Scale Requirements Management
- Shared requirement libraries across projects
- Cross-project impact analysis
- Organization-wide compliance reporting

#### 5.2 Predictive Scope Analysis
- ML-based scope complexity prediction
- Automatic budget recommendation
- Risk-based task routing

#### 5.3 Real-time Collaboration Features
- Multi-user requirement review
- Live validation dashboards
- Collaborative planning sessions

---

## Critical Integration Points

### 1. Enhanced Overlay Chain with Coding-Standards Gates
```
Current: HIL → Evidence Gate → Agentic Review → Paired → Confidence → Agent Execution

Enhanced: HIL → Planning Review → Evidence Gate → [Sub-gates from coding-standards] → Agentic Review → Paired → Confidence → Agent Execution
                                  │
                                  ├─ Gate 0: Spec Identity (hash verification)
                                  ├─ Gate 1: Contract Stability (OpenAPI comparison)
                                  ├─ Gate 2: Scope Compliance (excluded terms)
                                  ├─ Gate 3: Architecture Conformance
                                  ├─ Gate 4: Behavior Drift (test immutability)
                                  └─ Gate 5: Non-Functional Drift
```

### 2. State Machine Integration with Requirements Validation
```typescript
// Enhanced state transitions
PENDING → [REQUIREMENTS_VALIDATED] → RUNNING → COMPLETED
                           ↓
                    REQUIREMENTS_INVALID → HIL_PENDING
```

### 3. MCP Server Unification Architecture
```typescript
// Unified MCP server capabilities
ai-sdd MCP Server {
  // Existing ai-sdd tools
  - run, status, complete-task, hil, constitution

  // Integrated coding-standards tools
  - validate-requirements-lock
  - check-semantic-drift
  - generate-requirements-lock
  - query-requirements-graph
  - check-scope-compliance
  - analyze-impact
  - generate-traceability-report

  // New unified tools
  - validate-workflow-requirements (combines both)
  - check-organization-compliance
  - generate-validation-dashboard
}
```

### 4. Data Flow Integration
```
User Requirements
        ↓
[Clarification + 90% Confidence Check]
        ↓
requirements.lock.yaml (immutable contract)
        ├─→ [Engine: spec hash tracking]
        ├─→ [Overlay: scope exclusion validation]
        ├─→ [Agent: constrained generation]
        └─→ [MCP: query and impact analysis]
        ↓
Workflow DAG Execution
        ↓
[Overlay Chain with Coding-Standards Gates]
        ↓
Validated Output + Traceability Report
```

---

## Implementation Roadmap (Revised 8-Week Plan)

### Week 1-2: Foundation & MCP Unification
- [ ] Merge MCP server infrastructure
- [ ] Register coding-standards validation tools
- [ ] Update agent constitution in all prompts
- [ ] Implement GO protocol in pre-init agent
- [ ] Add validation awareness to status output

### Week 3-4: Schema & Core Integration
- [ ] Implement Gherkin AC schema in task definitions
- [ ] Add scope excluded enforcement in PolicyGateOverlay
- [ ] Integrate requirements lock reading in engine
- [ ] Add spec hash tracking and change events
- [ ] Update workflow-loader for AC validation

### Week 5-6: Overlays & MCP Integration
- [ ] Implement Planning Review overlay
- [ ] Integrate coding-standards gates as sub-gates
- [ ] Add phase-based model routing
- [ ] Implement AC coverage validation in complete-task
- [ ] Enable MCP query engine for impact analysis

### Week 7-8: Tooling & CI/CD
- [ ] Port semantic drift scripts with MCP support
- [ ] Create unified CI template with multi-project support
- [ ] Implement budget enforcement scripts
- [ ] Add lock regeneration task library entry
- [ ] Create organization-scale validation examples

---

## Risk Assessment & Mitigation

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| **Schema migration complexity** | High | Medium | Provide migration tool; maintain backward compatibility; phased rollout |
| **Performance overhead from gates** | Medium | High | Make gates optional; cache validation results; parallel execution |
| **Agent prompt bloat** | Medium | High | Layer constitution: core (mandatory) + extensions (optional) |
| **MCP server compatibility issues** | High | Medium | Abstract tool registration; versioned APIs; compatibility layer |
| **Team adoption resistance** | High | High | Phased rollout; opt-in features; clear value demonstration; training |
| **Integration testing complexity** | High | High | Comprehensive test suite; reference implementation; staged deployment |

---

## Success Metrics & KPIs

### 1. Quality Metrics
- **Rework Reduction**: Track `NEEDS_REWORK` transitions before/after implementation
- **Scope Compliance**: Measure excluded term violations caught by Gate 2
- **Requirements Traceability**: Percentage of tasks with AC coverage validation
- **Drift Prevention**: Count of semantic drift incidents caught by gates

### 2. Efficiency Metrics
- **Validation Time**: Average time spent in coding-standards gates
- **First-Pass Success Rate**: Tasks completing without rework
- **Planning Accuracy**: Reduction in planning review iterations

### 3. Adoption Metrics
- **Feature Usage**: Percentage of projects using requirements lock integration
- **Tool Utilization**: MCP tool invocation frequency
- **Team Satisfaction**: Survey scores on requirements clarity and predictability

### 4. Business Metrics
- **Time-to-Market**: Reduction in development cycle time
- **Quality Improvement**: Reduction in post-deployment defects
- **Cost Savings**: Reduction in rework and scope creep costs

---

## Organizational Impact

### Development Teams
- **Predictable AI output** — No surprise features or refactorings
- **Reduced review burden** — Code matches locked requirements
- **Clear scope boundaries** — Explicit inclusions and exclusions
- **Confidence in regeneration** — Drift detection catches regressions

### Engineering Leadership
- **Auditable requirements traceability** — Full REQ → TEST lineage
- **Consistent quality gates** — Automated validation across all projects
- **Predictable delivery** — Confidence-based planning and estimation
- **Risk mitigation** — Gold-plating prevention at scale

### Platform Teams
- **Unified tooling** — Single MCP server for all validation needs
- **Scalable architecture** — Organization-wide requirements management
- **Extensible framework** — Plugin architecture for custom gates
- **Comprehensive observability** — Metrics across development lifecycle

---

## Recommendations

### Immediate Actions (Week 1)
1. **Start Phase 1 implementation** — Zero risk, immediate value
2. **Merge MCP servers** — Unlocks tool-agnostic validation
3. **Update elderly-ai-assistant example** — Create reference implementation

### Strategic Prioritization
1. **Gherkin AC integration** — Enables test-driven workflows (highest value)
2. **Scope excluded enforcement** — Critical for gold-plating prevention
3. **Planning Review overlay** — Prevents entire categories of rework
4. **MCP query engine** — Enables organization-scale traceability

### Adoption Strategy
1. **Opt-in by default** — All new features optional initially
2. **Phased team onboarding** — Start with pilot teams, expand based on success
3. **Comprehensive documentation** — Clear migration guides and examples
4. **Training and support** — Workshops on requirements discipline

### Technical Considerations
1. **Maintain backward compatibility** — No breaking changes to existing workflows
2. **Design for extensibility** — Plugin architecture for custom validation gates
3. **Prioritize performance** — Cache validation results, parallel gate execution
4. **Comprehensive testing** — Reference implementation with full test coverage

---

## Conclusion

The integration of coding-standards into ai-sdd-claude creates a **unified AI-assisted development platform** that combines:

1. **Requirements Discipline** with **Workflow Orchestration**
2. **Validation Gates** with **Overlay Chain Composition**
3. **Gold-Plating Prevention** with **Human-in-the-Loop Oversight**
4. **Traceability** with **State Machine Enforcement**

This merger addresses the fundamental challenge of AI-assisted development: ensuring that AI agents build *exactly what's needed* while maintaining the flexibility and orchestration capabilities required for complex software projects.

The incremental 5-phase approach ensures minimal disruption while delivering compounding value with each phase. By starting with zero-code wins and progressively integrating more sophisticated capabilities, teams can adopt the framework at their own pace while immediately benefiting from improved requirements discipline.

**The result is an enterprise-grade platform that prevents scope creep, ensures requirements traceability, and provides automated validation—all while maintaining the powerful orchestration capabilities that make ai-sdd-claude uniquely valuable.**

---

## Appendix: Detailed File Mapping

### Phase 1: Zero-Code Wins
| Feature | Source (coding-standards) | Target (ai-sdd-claude) |
|---------|--------------------------|------------------------|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` |
| GO protocol | `CLAUDE.md` §Confidence Protocol | `data/integration/claude-code/agents/sdd-scaffold.md` + `ba.md` |
| MCP tool registration | `tools/mcp-server/` | `src/integration/mcp-server/` (enhancement) |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` |

### Phase 2: Schema Extensions
| Feature | Source | Target |
|---------|--------|--------|
| Gherkin AC schema | `rules/acceptance-criteria-format.md` | `src/types/index.ts` `AcceptanceCriterion` interface |
| Scope excluded | `scripts/semantic-drift-check.sh` Gate 2 | `src/overlays/policy-gate/gate-overlay.ts` |
| Requirements lock | `rules/example.requirements.lock.yaml` | `src/types/index.ts` `RequirementsLock` interface |
| Spec hash tracking | `scripts/spec-hash.sh` | `src/core/engine.ts` `run()` startup |

### Phase 3: Overlay Features
| Feature | Source | Target |
|---------|--------|--------|
| Planning Reviewer | `agents/planning-reviewer.md` | `src/overlays/planning-review/` (new) |
| Phase routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` schema |
| MCP query engine | `tools/query-engine/` | `src/integration/query-engine/` (new) |
| AC validation | `rules/pull-request-checklist.md` | `src/cli/commands/complete-task.ts` |

### Phase 4: Tooling & CI/CD
| Feature | Source | Target |
|---------|--------|--------|
| Drift scripts | `scripts/reproducibility-check.sh` | `data/integration/scripts/` (with MCP support) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` |
| Budget enforcement | `toolgate.yaml` budgets | `scripts/check-budgets.sh` (new) |
| Lock regeneration | `agents/requirements-lock/` | `data/task-library/regenerate-requirements-lock.yaml` |

---

*Analysis complete. Ready for implementation planning and task breakdown.*