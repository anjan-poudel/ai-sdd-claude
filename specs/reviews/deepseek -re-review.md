# Updated Review: ai-sdd-synthesis-2-claude Spec

**Reviewer:** Claude
**Date:** 2026-02-28
**Scope:** Post-fix assessment after addressing unified feedback

## Executive Summary

The specification has improved significantly through the resolution of P0 and P1 issues. The `CONTRACTS.md` appendix provides a solid single source of truth, and the `PRE-IMPLEMENTATION-GATE` correctly reflects `READY_FOR_SIGNOFF` status. However, **three critical spec-level gaps remain** that could derail implementation, plus the **strategic risks are still present** despite being pushed back.

**Overall Status:** Spec is 85% ready for implementation. Remaining 15% consists of missing operational safeguards and unaddressed integration realities.

---

## 1. Improvements Since Last Review

### ✅ Resolved Contract Inconsistencies
1. **Idempotency keys:** `operation_id` (stable) + `attempt_id` (per-retry) standardized across all adapters
2. **Tool naming:** `--tool codex` (CLI) vs `adapter.type: openai` (runtime) clearly distinguished
3. **Security namespace:** Unified under `security.secret_patterns`
4. **Constitution ownership:** Engine owns only `## Workflow Artifacts`; `## Reading Convention` is user-authored
5. **HIL config hierarchy:** Consistent `overlays.hil:` across all docs

### ✅ Added Quantitative Targets
- **Time to first workflow:** ≤ 30 minutes (new user)
- **Crash recovery:** ≤ 5 minutes
- **CI performance:** PR validation ≤ 15 min, full suite ≤ 30 min
- **Task reliability:** ≥ 99% (excluding HIL rejections)

### ✅ Enhanced Observability
- `run_id` + `task_run_id` correlation IDs in all events
- Cost/token tracking (`tokens_used`, `estimated_cost_usd`)
- Context assembly events with token counts

---

## 2. Remaining Spec-Level Gaps (Must Fix Before Implementation)

### Gap 1: Missing Context Limit Warning System
**Problem:** The pull model assumes agents will read only what they need, but there's no mechanism to:
- Warn agents when they're approaching context limits
- Provide guidance on which artifacts are largest
- Trigger HIL escalation when context limits are exceeded

**Current Spec:** `context.assembled` event includes `token_count` but no thresholds or warnings.

**Risk:** Long workflows will silently fail with context limit errors, causing confusing failures.

**Quantifiable Fix:**
- Add `engine.context_warning_threshold_pct: 80` (default)
- Emit `context.warning` event at threshold with list of largest artifacts
- Add HIL escalation path when `token_count > engine.context_hard_limit`

### Gap 2: Artifact Contract Validation vs Pull Model Conflict
**Problem:** Artifact contracts validate required sections (e.g., `acceptance_criteria`), but the pull model encourages agents to read only sections they need. This creates a mismatch: agents might validate entire artifacts but read only parts.

**Current Spec:** T013 validates full artifacts; T016 assumes partial reading.

**Risk:** Performance overhead (validating large artifacts agents won't fully read) or missed validation (if validation is skipped for partial reads).

**Quantifiable Fix:**
- Define validation levels: `full` (default), `section_presence_only`, `none`
- Allow per-artifact override: `contract: requirements_doc@1(validate=section_presence_only)`
- Document trade-off: stricter validation vs performance

### Gap 3: Missing Integration Compatibility Matrix
**Problem:** While integration volatility was pushed back as an "execution concern," the spec lacks a framework for tracking compatibility between ai-sdd versions and target tool versions.

**Current Spec:** No version compatibility requirements documented.

**Risk:** Framework breaks silently when target tools update, causing support burden and user frustration.

**Quantifiable Fix:**
- Add `integration/compatibility.yaml` schema in spec
- Define minimum/maximum supported versions for each tool
- Add `ai-sdd check-compatibility` CLI command
- Require compatibility checks in CI for integration tests

---

## 3. Strategic Risks (Still Valid Despite Pushback)

### Risk 1: MVP Scope Remains Too Large
**Current:** Phase 1 = 58 developer-days (2.9 months solo)
**Quantifiable Target:** ≤ 30 developer-days (1.5 months solo)

**Recommended Cuts:**
- Defer T013 (Artifact Contract) to Phase 2 (keep basic path validation only)
- Defer T012 (Expression DSL) to Phase 2 (keep simple boolean conditions)
- Keep T016 (Manifest) as essential for pull model

### Risk 2: Testing Complexity Still High
**Current:** 5 overlays → 32 combinations, pairwise testing (10 combos)
**Quantifiable Target:** Test 8 representative combinations maximum

**Recommendation:** Define "representative" as:
- Single overlay active (5 tests)
- High-risk pairs: HIL+Gate, Confidence+Paired, Gate+Review (3 tests)
- All overlays active (1 test)

### Risk 3: Adoption Friction Despite SLOs
**Current:** `ai-sdd init --tool <name>` + constitution + YAML configs
**Quantifiable Target:** Interactive wizard covering 80% of common use cases

**Recommendation:** Add `ai-sdd init --wizard` that:
- Asks 5-7 questions (project type, tools, rigor level)
- Generates complete configuration
- Validates setup before first run

---

## 4. Missing Operational Safeguards

### Safeguard 1: Cost Budget Enforcement
**Current:** Cost tracking exists but no automatic pause/stop.
**Quantifiable Fix:** Add `engine.cost_enforcement: warn|pause|stop` with default `pause`.

### Safeguard 2: Retry Storm Protection
**Current:** Exponential backoff but no circuit breaker.
**Quantifiable Fix:** Add `adapter.circuit_breaker_failures: 5` (default) → temporary disable after threshold.

### Safeguard 3: Memory Usage Limits
**Current:** No memory limits for engine or adapters.
**Quantifiable Fix:** Add `engine.max_memory_mb: 1024` (default) with OOM protection.

---

## 5. Quantifiable Improvement Targets

| Area | Current | Target | Gap |
|------|---------|--------|-----|
| **MVP Developer-Days** | 58 days | ≤ 30 days | 28 days (93%) |
| **Context Warning Threshold** | None | Warn at 80%, HIL at 95% | New feature |
| **Integration Compatibility** | None | Document min/max versions | New feature |
| **Test Combinations** | 10+ combos | ≤ 8 combos | 20% reduction |
| **Interactive Setup** | None | Wizard covering 80% use cases | New feature |
| **Cost Enforcement** | Tracking only | Automatic pause at budget | New feature |

---

## 6. Critical Questions Unanswered

1. **What happens when an agent ignores the "Reading Convention" and reads all artifacts?**
   - Does the engine detect this? Should it?
   - Is there any penalty or guidance?

2. **How are schema migrations handled between Phase 1 and Phase 2?**
   - If artifact contracts are added later, how do existing workflows upgrade?
   - Is there a migration path for `constitution.md` changes?

3. **What's the fallback when native tools are unavailable?**
   - Example: Claude Code's `Read` tool fails or times out
   - Does the engine retry? Escalate to HIL?

4. **How are "partial reads" validated for artifact contracts?**
   - If an agent reads only `## Functional Requirements` section, how does contract validation work?

---

## 7. Implementation Readiness Assessment

### Ready for Implementation (85%)
- Core engine architecture (T001-T004, T010)
- HIL overlay (T005)
- Observability foundation (T011)
- Constitution system (T003, T016)
- CLI structure (T010)

### Needs Spec Refinement (10%)
- Context limit warnings (add to T011)
- Integration compatibility matrix (add to T018-T020)
- Validation levels for artifact contracts (refine T013)

### High Risk / Deferrable (5%)
- Expression DSL (T012) - can start with simple boolean conditions
- Full artifact contracts (T013) - can start with path validation only
- Advanced overlays (T006-T009) - Phase 2 items

---

## 8. Final Recommendations

### Immediate Actions (Before Sign-off)
1. **Add context warning system** to T011 acceptance criteria
2. **Define integration compatibility matrix** in CONTRACTS.md
3. **Clarify validation levels** in T013 for pull model compatibility

### First 30 Days Implementation Plan
1. **Week 1-2:** Core engine + HIL + basic CLI (T001, T002, T004, T005, T010 partial)
2. **Week 3-4:** Constitution + manifest + observability (T003, T016, T011)
3. **Week 5-6:** Basic workflow execution + validation (T002 completion, simple artifact validation)

### Success Metrics for First Month
- ✅ Simple BA→Architect workflow executes end-to-end
- ✅ HIL queue created and resolved
- ✅ Observability events captured with cost tracking
- ✅ Manifest updated after each task
- ✅ Time to first workflow ≤ 60 minutes (initial target)

---

## Conclusion

The specification has reached **contractual completeness** but lacks **operational completeness**. The three identified gaps (context warnings, validation levels, compatibility matrix) are relatively small additions that will prevent significant implementation pain later.

**Recommendation:** Address the three gaps before final sign-off, then proceed with implementation using the 30-day incremental plan. The strategic risks remain but can be managed through disciplined scope control and continuous user feedback.

**Final Score:** 8.5/10 (Excellent technical foundation, needs operational safeguards)