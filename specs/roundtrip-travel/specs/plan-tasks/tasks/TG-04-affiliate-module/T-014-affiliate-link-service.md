# T-014: Affiliate link generation service

## Metadata
- **Group:** [TG-04 — Affiliate Module](index.md)
- **Component:** services/affiliate
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-003
- **Blocks:** T-015, T-013 (product links in StopoverCard)
- **Requirements:** FR-006, NFR-007

## Description
Implement `AffiliateService.generateLink()` for GetYourGuide, Viator, and Klook. HMAC-sign ref tokens with 24h expiry. Include allowed-domain validation.

## Acceptance criteria

```gherkin
Feature: Affiliate link generation

  Scenario: Generates valid link for each partner
    Given product IDs for Viator, GetYourGuide, and Klook
    When generateLink is called for each partner
    Then each returns a /api/affiliate/redirect URL with a ref token
    And the ref token is HMAC-signed and not guessable

  Scenario: Expired token fails validation
    Given a ref token generated 25 hours ago
    When verifyPayload is called with the token
    Then null is returned (expired)
```

## Implementation notes
- HMAC: `crypto.createHmac('sha256', AFFILIATE_SECRET).update(payload).digest('base64url')`.
- Token payload: `{ p: partner, pid: productId, uid: userId | null, exp: epoch_ms }`.
- `AFFILIATE_SECRET` must be ≥32 chars (enforced by Zod EnvSchema).
- Do not put plain partner URLs in query params — only the signed ref and encoded dest.
- NFR-007: the `refToken` stored in AffiliateClick is the HMAC token (auditable but not re-exploitable).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Security review: HMAC key rotation procedure documented
