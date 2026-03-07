# MCS-006: Types + Zod Schemas

**Phase:** 2.1
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-005b (Phase 1 complete)
**Effort:** 1.5d
**Ticket:** MCS-006

## Context

All new governance, budget, AC, and handover types must be defined in `src/types/index.ts` with both TypeScript interfaces and Zod schemas for runtime YAML validation. Zero breaking changes — all new fields are optional.

## Scope

Add to `src/types/index.ts`:

### New TypeScript interfaces

```typescript
export type GovernanceMode = "off" | "warn" | "enforce";
export type LockMode = "greenfield" | "brownfield";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;  // default: "warn"
  lock_mode?: LockMode;               // default: "greenfield"
}

export interface RequirementsLockConfig {
  path?: string;  // default: ".ai-sdd/requirements.lock.yaml"
}

export interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}

export interface TaskBudget {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
}

export interface ACCoverageReport {
  claimed: number;
  total: number;
  uncovered: string[];  // scenario names not covered
}

export interface GatedHandoverState {
  ac_coverage?: ACCoverageReport;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
  raw_output?: string;  // Gate 2 scans this for scope drift
}
```

### New Zod schemas

```typescript
export const AcceptanceCriterionSchema = z.object({
  scenario: z.string(),
  given: z.union([z.string(), z.array(z.string())]),
  when: z.string(),
  then: z.array(z.string()),
  and: z.array(z.string()).optional(),
});

export const TaskBudgetSchema = z.object({
  max_new_files: z.number().int().nonneg().optional(),
  max_loc_delta: z.number().int().nonneg().optional(),
  max_new_public_apis: z.number().int().nonneg().optional(),
});

export const GovernanceModeSchema = z.enum(["off", "warn", "enforce"]);
export const LockModeSchema = z.enum(["greenfield", "brownfield"]);

export const GovernanceConfigSchema = z.object({
  requirements_lock: GovernanceModeSchema.default("warn"),
  lock_mode: LockModeSchema.default("greenfield"),
}).optional();

export const RequirementsLockConfigSchema = z.object({
  path: z.string().default(".ai-sdd/requirements.lock.yaml"),
}).optional();
```

### Additive fields on existing `TaskDefinition` (all optional)

- `acceptance_criteria?: AcceptanceCriterion[]`
- `requirement_ids?: string[]`
- `scope_excluded?: string[]`
- `budget?: TaskBudget`
- `phase?: string`

### Update existing `TaskOverlays` interface

Add: `planning_review?: { enabled?: boolean; phases?: string[] }`

### Update `WorkflowState`

Add: `requirements_lock?: { spec_hash: string; path: string; locked_at: string }`

## Acceptance Criteria

- scenario: "Types compile without error"
  given: "updated src/types/index.ts"
  when: "bun run typecheck"
  then:
    - "Zero TypeScript errors"
    - "All new interfaces exported"

- scenario: "Zod schemas validate correctly"
  given: "valid and invalid AcceptanceCriterion YAML"
  when: "schema.parse() called"
  then:
    - "Valid input passes"
    - "Invalid input (missing 'scenario') throws ZodError"

- scenario: "No breaking changes to existing types"
  given: "existing workflow YAML fixtures"
  when: "workflow-loader parses them"
  then:
    - "All 177 existing tests still pass"

## Tests Required

- Zod: valid AcceptanceCriterion → passes
- Zod: missing required field → ZodError
- Zod: invalid GovernanceMode value → ZodError
- Zod: TaskBudget with negative number → ZodError
- Types: GatedHandoverState fields are all optional (no required fields)

## Dependency Section

**Blocked by:** MCS-005b
**Blocks:** MCS-001, MCS-007, MCS-009a, MCS-009b, MCS-009c, MCS-012
