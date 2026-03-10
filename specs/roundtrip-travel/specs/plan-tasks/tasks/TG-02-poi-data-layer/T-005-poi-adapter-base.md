# T-005: POI adapter base interface and registry

## Metadata
- **Group:** [TG-02 — POI Data Layer](index.md)
- **Component:** services/poi
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-003
- **Blocks:** T-006, T-007, T-008, T-009
- **Requirements:** FR-005, NFR-004

## Description
Define the `PoiSourceAdapter` Kotlin interface and `PoiAdapterRegistry` Spring component. Implement `RawPoi`, `Attraction` entity, and `DemographicTags` data classes. No concrete adapter logic in this task.

## Acceptance criteria

```gherkin
Feature: POI adapter interface

  Scenario: Registry loads all registered adapters
    Given 2 adapters are registered as Spring beans
    When the registry is queried
    Then both adapters are returned with their names

  Scenario: Adapter interface enforces contract at compile time
    Given a class implementing PoiSourceAdapter
    When Kotlin compiles the class
    Then compilation fails if fetchUpdates or normalise is not implemented
```

## Implementation notes
- Interface defined in `backend/src/main/kotlin/com/roadtrip/poi/PoiSourceAdapter.kt`:
  ```kotlin
  interface PoiSourceAdapter {
      val name: String
      fun fetchUpdates(since: Instant? = null): Flow<RawPoi>
      fun normalise(raw: RawPoi): Attraction
  }
  ```
- `PoiAdapterRegistry` is a `@Component` that takes a `List<PoiSourceAdapter>` via constructor injection (Spring collects all beans implementing the interface automatically).
- `Flow<RawPoi>` (Kotlin coroutines) enables streaming/backpressure-aware ingestion.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (unit tests with MockK)
- [ ] `./gradlew build` passes
