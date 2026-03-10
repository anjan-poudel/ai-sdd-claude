# T-016: Affiliate click audit logging

## Metadata
- **Group:** [TG-04 — Affiliate Module](index.md)
- **Component:** packages/db, services/affiliate
- **Agent:** dev
- **Effort:** S
- **Risk:** HIGH
- **Depends on:** T-015
- **Blocks:** —
- **Requirements:** NFR-005, NFR-007

## Description
Ensure the `AffiliateClick` table is insert-only (no UPDATE/DELETE). Implement IP hashing for privacy. Add database-level protection (trigger or row-level security) against modification.

## Acceptance criteria

```gherkin
Feature: Affiliate click audit trail

  Scenario: Click is recorded with hashed IP
    Given a user clicks an affiliate link
    When the redirect handler processes the click
    Then an AffiliateClick row is created with a hashed IP (not raw IP)
    And userId is null if the user is not authenticated

  Scenario: Delete on AffiliateClick table is blocked
    Given an AffiliateClick row exists
    When a DELETE statement is attempted on the row
    Then the operation is rejected
    And the row still exists
```

## Implementation notes
- IP hash: `crypto.createHash('sha256').update(rawIp + AFFILIATE_SECRET).digest('hex')` — keyed hash (not reversible, not a global rainbow table target).
- DB trigger: `CREATE RULE no_delete_affiliate_clicks AS ON DELETE TO "AffiliateClick" DO INSTEAD NOTHING;` or PostgreSQL RLS.
- NFR-007: verify with `EXPLAIN` that no `DELETE` path exists in application code.
- Do NOT store raw IP or user agent in this table.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Verify via integration test: DELETE attempt on table is rejected
- [ ] No PII in logs (no raw IP, no full URL)
