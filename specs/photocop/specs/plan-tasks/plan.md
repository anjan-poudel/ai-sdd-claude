# Task Breakdown — PhotoCop

## Summary
- Task groups: 6 (Jira Epics)
- Total tasks: 22 (+ 4 subtasks)
- Estimated effort: 12–15 days (parallel, 2 devs) / 30–35 days (sequential)
- Critical path: T-001 → T-003 → T-004 → T-009 → T-011 → T-012 → T-014 → T-015 → T-020 → T-021

## Contents
- [tasks/index.md](tasks/index.md) — all task groups

## Critical path

The critical path runs through TG-01 (project scaffold) into TG-02 (backend core), then through TG-03 (analysis engine), then TG-04 (output pipeline), and finally into TG-06 (integration tests). The scaffold task (T-001) must be completed first as it establishes the monorepo layout, Docker Compose, and CI pipeline that every subsequent task depends on. The backend app factory (T-004) must exist before any backend service module can be integrated. The ELA analyser (T-009) is the most complex forensic algorithm and sits on the critical path to the score aggregator (T-011). The full pipeline integration test (T-020) gates QA sign-off (T-021).

Frontend development (TG-05) is largely independent of TG-03 and TG-04 once the API contract is established in T-004, enabling parallel frontend / backend tracks.

## Key risks

1. **HIGH — T-009 (ELA Analyser)**: ELA accuracy is highly sensitive to the re-save quality parameter. False-positive / false-negative thresholds from NFR-002 may not be met without iterative tuning. Requires benchmark fixtures.
2. **HIGH — T-010 (Noise Analyser)**: Noise residual estimation quality depends on denoising filter selection. Incorrect filter parameters can produce high false-positive rates.
3. **HIGH — T-011 (Clone Detector)**: SIFT/ORB descriptor matching on large images is CPU-intensive. May breach the 10-second performance target (NFR-003) without image-resize preprocessing.
4. **HIGH — T-003 (Image Ingestion Service)**: The `python-magic` / `filetype` dual-path magic-byte detection must correctly reject executable and non-image content (NFR-005). Both libraries must be tested under CI.
5. **MEDIUM — T-014 (Heatmap Renderer)**: In-memory PNG compositing must not write temporary files to disk (NFR-001). PIL `BytesIO` pattern must be enforced.
6. **MEDIUM — T-020 (Full pipeline integration test)**: NFR-002 accuracy test requires a 200-image labelled benchmark dataset. Dataset procurement must happen before T-020 begins.

## Security blockers

No `specs/security-design-review.md` is present for this project. Security constraints are derived from the constitution:
- NFR-005 (magic-byte validation) is a hard dependency of T-003.
- No secrets in source code applies to all tasks; enforced by T-022 (secret scan CI gate).
- No disk writes of image data applies to T-003, T-009, T-010, T-011, T-014, T-015 — verified by T-020.
