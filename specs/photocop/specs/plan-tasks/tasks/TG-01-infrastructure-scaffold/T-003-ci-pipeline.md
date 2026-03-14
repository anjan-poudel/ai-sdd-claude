# T-003: CI pipeline (lint, typecheck, test gate)

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Scaffold](index.md)
- **Component:** CI (GitHub Actions or equivalent)
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-monorepo-scaffold.md)
- **Blocks:** [T-021](../TG-06-quality-integration/T-021-qa-sign-off.md)
- **Requirements:** [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Configure a CI workflow that runs on every pull request and merge to main. The pipeline must include: Python linting (ruff or flake8, PEP 8), Python type checking (mypy or pyright), Python tests (pytest), TypeScript type checking (tsc --noEmit), frontend tests (vitest), and a secret-scan step (detect-secrets or trufflehog) that fails the build if any secret pattern is matched in source code.

## Acceptance criteria

```gherkin
Feature: CI pipeline

  Scenario: CI passes on a clean codebase
    Given all source files conform to PEP 8 and TypeScript strict mode
    And no secret patterns are present in the repository
    When a pull request is opened
    Then the CI workflow completes with all steps green

  Scenario: CI fails when a Python PEP 8 violation is introduced
    Given a Python source file is committed with a line exceeding 120 characters
    When the CI lint step runs
    Then the lint step exits with a non-zero code
    And the pull request is blocked from merging

  Scenario: CI fails when a secret pattern is detected in source code
    Given a Python file is committed containing a string matching an AWS access key pattern
    When the secret-scan step runs
    Then the secret-scan step exits with a non-zero code
    And the pull request is blocked from merging
```

## Implementation notes
- The secret-scan step satisfies NFR-005 ("No secrets in source code").
- Use `detect-secrets` with a baseline file committed to the repo so only new secrets trigger failures.
- Python linting: line length 120 (PEP 8 relaxed to match FastAPI community convention).
- The test step must run `pytest backend/tests/` with exit code propagated to CI.
- The frontend typecheck step runs `tsc --noEmit` inside `frontend/`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] CI workflow file committed and passing on the main branch
- [ ] Secret scan baseline file committed
