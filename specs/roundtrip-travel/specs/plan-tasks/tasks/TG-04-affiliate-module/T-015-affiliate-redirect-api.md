# T-015: /api/affiliate/redirect endpoint

## Metadata
- **Group:** [TG-04 — Affiliate Module](index.md)
- **Component:** apps/web/app/api/affiliate/redirect
- **Agent:** dev
- **Effort:** S
- **Risk:** HIGH
- **Depends on:** T-014
- **Blocks:** T-016
- **Requirements:** FR-006, NFR-005, NFR-007

## Description
Implement the Next.js redirect handler. Validates HMAC token, checks allowed affiliate domains, logs click (fire-and-forget), and issues 302 to partner URL.

## Acceptance criteria

```gherkin
Feature: Affiliate redirect

  Scenario: Valid link redirects to partner
    Given a valid HMAC-signed ref token for a Viator product
    When GET /api/affiliate/redirect?ref=... is called
    Then a 302 redirect to the Viator partner URL is returned
    And an AffiliateClick record is created

  Scenario: Invalid token returns 410
    Given a tampered or expired ref token
    When GET /api/affiliate/redirect?ref=... is called
    Then a 410 Gone response is returned
    And no AffiliateClick is created

  Scenario: Non-affiliate destination is blocked
    Given a valid token but dest pointing to a non-affiliate domain
    When GET /api/affiliate/redirect is called
    Then a 403 Forbidden response is returned
```

## Implementation notes
- Allowed affiliate hosts: `['www.viator.com', 'www.getyourguide.com', 'www.klook.com']`.
- Click logging: fire-and-forget (`Promise.catch(logger.error)`) — do not block redirect on log failure.
- NFR-005: do NOT log the full destination URL (may contain PII in query params).
- Security: validate `dest` param domain before redirect to prevent open redirect.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Security test: verify no open redirect to arbitrary domains
- [ ] Load test: 1000 concurrent redirects complete in under 1s (mostly I/O bound)
