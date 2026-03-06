# Review: `merged-<CODING_TOOL>.md` Proposals

Date: 2026-03-05
Reviewed files:
- `specs/merge-coding-standards/merged-claude.md`
- `specs/merge-coding-standards/merged-codex.md`

Note: there is no `merged-deepseek.md` in this folder.

## `merged-claude.md` — Pros

1. Strongest implementation detail: concrete file-level integration points and code snippets.
2. Clear additive strategy: optional fields, opt-in overlays, backward-compatible defaults.
3. Best architectural guardrails: explicit "what not to merge" and rationale.
4. Good operational depth: includes policy sub-gates, phase routing precedence, CI and task-library additions.
5. Explicit mapping from features to specific ai-sdd files.

## `merged-claude.md` — Cons

1. High verbosity and scope breadth; risk of turning one merge into a multi-quarter program.
2. Phase ordering may be heavy for near-term execution (many parallel additions in Phases 2-4).
3. Contains at least one factual inconsistency: claims `tools/validators` and `tools/query-engine` are hallucinated/non-existent in `coding-standards`; they do exist in that source repo.
4. Adds many moving parts at once (new overlay + new CLI + new scripts + phase routing), increasing integration risk.

## `merged-codex.md` — Pros

1. Most pragmatic sequencing: concise, staged, and easy to operationalize.
2. Strong delivery focus: clear "first 10 tickets" and short dependency path.
3. Good balance of ambition vs risk: explicitly avoids replacing ai-sdd runtime/state architecture.
4. Clear phase objectives and exit criteria with lower implementation ambiguity for planning.
5. Good maintainability posture: emphasizes opt-in -> enforce adoption.

## `merged-codex.md` — Cons

1. Less implementation depth than `merged-claude.md` (fewer concrete file-level changes).
2. Some items are broad and may need decomposition before coding.
3. Under-specifies exact behavior for certain checks (for example, how AC coverage evidence is represented and validated).
4. Weaker architecture detail for MCP/tool integration than the Claude version.

## Significant Differences Worth Incorporating

1. **Foundation philosophy**
   - `merged-codex.md`: compact execution backbone.
   - `merged-claude.md`: deep technical design.
   - Synthesis: use Codex for roadmap, Claude for implementation details.

2. **MCP sequencing**
   - `merged-codex.md`: introduces MCP traceability very early (Phase 0).
   - `merged-claude.md`: places MCP traceability after CLI foundation.
   - Synthesis: keep MCP thin and early only for pass-through wrappers; avoid deep MCP refactor until traceability CLI is stable.

3. **Traceability engine posture**
   - `merged-codex.md`: integrate `tools/validators` + `tools/query-engine`.
   - `merged-claude.md`: avoids those modules based on an incorrect premise.
   - Synthesis: validate and import selectively from existing coding-standards tooling, but gate with adapter/compatibility layer.

4. **Governance strictness**
   - `merged-claude.md`: richer prompt-level governance (constitution + GO protocol details).
   - `merged-codex.md`: cleaner config-level governance mode (`off|warn|enforce`).
   - Synthesis: combine both; config-level controls decide enforcement, prompt-level controls shape behavior.

## Proposed Synthesis (Recommended Baseline)

Use **`merged-codex.md` as execution backbone**, then inject the following from `merged-claude.md`:

1. Adopt detailed schema additions:
   - `acceptance_criteria`
   - `requirement_ids`
   - `scope_excluded`
   - `budget`
2. Adopt detailed policy gate sub-check design (including explicit failure messaging).
3. Adopt prompt template hardening:
   - agent constitution baseline
   - confidence + GO protocol text
4. Adopt explicit file-map style for each major phase to reduce implementation ambiguity.

And incorporate the following correction:

1. Replace the "hallucinated module" statement with a verified integration decision:
   - `coding-standards` **does** contain `tools/validators` and `tools/query-engine`.
   - Decide explicitly whether to vendor/import/adapt, rather than dismiss.

## Final Recommendation

1. Keep current ticket execution aligned to the Codex-style phased plan (already reflected in `MCS-*` tickets).
2. Add a short "technical appendix" per ticket (from Claude-style details) for:
   - touched files
   - interface/type additions
   - failure modes
3. Run a dedicated feasibility spike before full traceability integration:
   - evaluate direct reuse of `coding-standards/tools/validators`
   - evaluate direct reuse of `coding-standards/tools/query-engine`
   - produce a go/no-go import note.

