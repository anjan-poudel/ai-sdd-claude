# T-002: MongoDB schemas and indexes (Mongoose)

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** MongoDB / Data layer
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** T-009, T-010, T-011, T-014, T-015, T-020, T-021, T-022, T-023, T-024, T-028, T-029, T-030
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement all 12 Mongoose schemas as specified in L2 Section 2: `jobs`, `sources`, `users`, `refresh_tokens`, `saved_jobs`, `saved_searches`, `alerts`, `notifications`, `content`, `agency_reviews`, `es_schema_versions`, `scraper_runs`. Each schema must include all indexes from the spec, Zod-compatible validation, and `updated_at` pre-save hooks.

## Acceptance criteria

```gherkin
Feature: MongoDB schemas and indexes

  Scenario: Duplicate deduplication key is rejected
    Given the jobs collection has a unique index on deduplicationKey
    When two job documents with the same deduplicationKey are inserted
    Then the second insert must fail with a MongoDB duplicate key error (E11000)
    And the first document must remain intact

  Scenario: User role cannot be set via user input
    Given the users Mongoose schema does not include role in the user-settable field set
    When a registration input object containing role: "admin" is processed through the schema
    Then the role field must be ignored and default to "user"
    And no error must be returned for the unrecognised field

  Scenario: TTL index auto-expires refresh tokens
    Given a refresh_token document with expiresAt set to 1 second ago
    When MongoDB's TTL monitor runs (within 60 seconds)
    Then the document must be automatically deleted from the refresh_tokens collection

  Scenario: All required indexes are present at startup
    Given the application has connected to MongoDB and run index sync
    When the indexes on the jobs collection are listed via db.jobs.getIndexes()
    Then the deduplicationKey unique index must be present
    And the compound index { status, expiryDate, lastSeenAt } must be present
```

## Implementation notes
- `updated_at` must be set via a Mongoose `pre('save')` hook AND a `pre('findOneAndUpdate')` hook.
- The `users` schema must strip `role` from all user-facing input schemas (not from the internal Mongoose schema itself).
- `emailVerificationToken` must store the SHA-256 hash, not the raw token.
- `passwordHash` must be `null` for OAuth-only accounts.
- Use `mongoose.Schema.Types.ObjectId` for all cross-collection references.
- Apply write concern `{ w: "majority" }` to all writes in the Ingest Service transactions.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] All 12 schemas implemented with correct indexes
- [ ] Index presence verified by integration test against a real MongoDB instance
- [ ] Mongoose pre-save hooks tested for updated_at propagation
