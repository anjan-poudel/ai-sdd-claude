# MCS-009a: Spec Hash Tracking in engine.ts + --acknowledge-spec-change Flag

**Phase:** 2.3
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-007
**Effort:** 1d
**Ticket:** MCS-009a

## Context

When `requirements.lock.yaml` changes between runs, the engine must detect it and require an explicit acknowledgement (OD-8). First run establishes a baseline without blocking; subsequent runs where the hash changed require `--acknowledge-spec-change=<reason>` or throw a ConfigError.

## Scope

1. Update `src/core/engine.ts` `run()` startup to compute and compare spec hash.
2. Add `--acknowledge-spec-change <reason>` flag to `src/cli/commands/run.ts`.
3. Emit events for first-run baseline, hash change, and lock missing.

## Implementation

Insert after `stateManager.initializeTasks()` in `engine.ts run()`:

```typescript
if (governanceMode !== "off" && config.requirements_lock?.path) {
  const lockFile = resolve(projectPath, config.requirements_lock.path);
  if (existsSync(lockFile)) {
    const hash = createHash("sha256").update(readFileSync(lockFile)).digest("hex");
    const prev = state.requirements_lock?.spec_hash;
    if (!prev) {
      // First run: establish baseline, warn, don't block (OD-8)
      emitter.emit("requirements.lock.baseline_set", { hash, path: lockFile });
    } else if (prev !== hash) {
      // Subsequent run: hash changed — require acknowledgement
      if (!flags.acknowledgeSpecChange) {
        throw new ConfigError(
          "requirements.lock.yaml changed since last run. " +
          "Re-run with --acknowledge-spec-change=<reason> to proceed."
        );
      }
      emitter.emit("requirements.lock.changed", {
        previous_hash: prev,
        current_hash: hash,
        reason: flags.acknowledgeSpecChange,
      });
    }
    await stateManager.patch({
      requirements_lock: { spec_hash: hash, path: lockFile, locked_at: new Date().toISOString() },
    });
  } else if (governanceMode === "enforce") {
    throw new ConfigError(
      `requirements.lock.yaml not found at ${lockFile}; governance mode is 'enforce'`
    );
  } else if (governanceMode === "warn") {
    emitter.emit("requirements.lock.missing", { path: lockFile });
  }
}
```

## Acceptance Criteria

- scenario: "First run establishes baseline without blocking"
  given: "requirements.lock.yaml exists, no prior spec_hash in state"
  when: "engine run() starts"
  then:
    - "requirements.lock.baseline_set event emitted"
    - "spec_hash stored in workflow-state.json"
    - "Workflow proceeds normally"

- scenario: "Changed hash without flag throws ConfigError"
  given: "requirements.lock.yaml changed since last run"
  when: "engine run() starts without --acknowledge-spec-change"
  then:
    - "ConfigError thrown with actionable message"
    - "Workflow does not start"

- scenario: "Changed hash with flag proceeds and emits event"
  given: "requirements.lock.yaml changed since last run"
  when: "engine run() starts with --acknowledge-spec-change=<reason>"
  then:
    - "requirements.lock.changed event emitted with reason"
    - "Workflow proceeds"

- scenario: "governance: off skips all hash checks"
  given: "governance.requirements_lock: off"
  when: "engine run() starts"
  then:
    - "No spec hash logic runs"
    - "No events emitted for hash"

## Tests Required

- Spec hash: first run → baseline_set event, hash stored, no block
- Spec hash: second run, hash unchanged → no event, proceeds
- Spec hash: second run, hash changed, no flag → ConfigError with correct message
- Spec hash: second run, hash changed, with flag → changed event emitted, reason recorded, proceeds
- governance off: lock file changes → no ConfigError, no event
- enforce + missing lock file → ConfigError at startup

## Dependency Section

**Blocked by:** MCS-007
**Blocks:** MCS-009b, MCS-009c
