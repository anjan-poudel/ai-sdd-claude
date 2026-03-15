# T-005: Environment variable validation (Zod startup check)

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** Shared config module
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** —
- **Requirements:** [NFR-006](../../../../define-requirements.md#nfr-006-observability)

## Description
Implement a shared `config` module used by every service that validates all required environment variables on startup using Zod. Per L2 §10.8, missing required variables with no default must cause a hard startup failure (exit code 1) with a descriptive error listing all missing or type-invalid variables. Each service has its own Zod schema covering its specific variables (L2 §§10.2–10.7).

## Acceptance criteria

```gherkin
Feature: Environment variable validation

  Scenario: Service exits with code 1 when required variable is missing
    Given the api service is started without the JWT_PRIVATE_KEY environment variable
    When the process starts up
    Then the process must exit with code 1
    And the error output must list JWT_PRIVATE_KEY as missing
    And the error must not include any secret values

  Scenario: Service starts successfully when all required variables are present
    Given all required environment variables for the api service are set
    When the process starts up
    Then the startup validation must pass without error
    And the service must proceed to listen for requests
```

## Implementation notes
- Create a shared `packages/config/src/index.ts` module that each service imports.
- Each service calls `validateConfig(serviceSchema)` at the top of its entry point before any other initialisation.
- Type-coerce numeric variables (e.g. `PORT`, `API_RATE_LIMIT_REQUESTS`) from strings using `z.coerce.number()`.
- Do not log secret variable values in the error output; log only variable names.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Each of the 8 services has a Zod config schema covering its variables from L2 §10
