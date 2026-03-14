# T-021: QA sign-off and production readiness checklist

## Metadata
- **Group:** [TG-06 — Quality & Integration](index.md)
- **Component:** All components (cross-cutting)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-003](../TG-01-infrastructure-scaffold/T-003-ci-pipeline.md), [T-020](T-020-full-pipeline-integration-test.md)
- **Blocks:** —
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [FR-003](../../../define-requirements/FR/FR-003-heatmap-generation.md), [FR-004](../../../define-requirements/FR/FR-004-exif-extraction.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../define-requirements/NFR/NFR-002-accuracy.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md), [NFR-004](../../../define-requirements/NFR/NFR-004-privacy.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Perform the final QA sign-off by verifying that the CI pipeline is fully green, all Gherkin acceptance criteria are passing, the NFR-002 accuracy benchmark results are within tolerance, the secret scan finds no violations, no disk writes of image data occur under production-like conditions, and the Docker Compose stack starts cleanly from a fresh checkout. Document the sign-off in a `QA_SIGN_OFF.md` report.

## Acceptance criteria

```gherkin
Feature: QA sign-off

  Scenario: All CI steps pass on the main branch
    Given the main branch is checked out with no local modifications
    When the CI workflow runs
    Then all lint, typecheck, test, and secret-scan steps complete with exit code 0

  Scenario: Docker Compose stack starts cleanly from a fresh checkout
    Given no .env file is present (only .env.example)
    When "docker compose up --build" is run
    Then the backend health check passes within 60 seconds
    And the frontend is accessible on the configured port

  Scenario: NFR-002 accuracy benchmark is within tolerance
    Given the 200-image labelled benchmark dataset is available
    When the benchmark script is executed against the running backend
    Then false-positive rate is <= 15%
    And false-negative rate is <= 15%

  Scenario: Secret scan finds zero violations on the main branch
    Given detect-secrets is run against the full repository on the main branch
    When the scan completes
    Then zero new secrets are detected beyond the committed baseline
```

## Implementation notes
- The QA sign-off report (`QA_SIGN_OFF.md`) must include: CI run link, benchmark results table (FP rate, FN rate), secret scan output, and sign-off date and reviewer name.
- This task should be performed by a developer other than the primary implementors where possible.
- If the benchmark dataset is not available, the accuracy section of the sign-off must be marked "PENDING — dataset procurement required" with a ticket reference.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] All CI steps green on the main branch
- [ ] `QA_SIGN_OFF.md` committed with all sections completed (or PENDING with justification)
- [ ] No open HIGH or CRITICAL issues in the issue tracker
- [ ] Docker Compose `up --build` verified clean from a fresh checkout
