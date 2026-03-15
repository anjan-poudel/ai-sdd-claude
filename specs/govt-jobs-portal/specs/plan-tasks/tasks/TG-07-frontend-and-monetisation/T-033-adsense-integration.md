# T-033: Google AdSense ad unit integration

## Metadata
- **Group:** [TG-07 — Frontend & Monetisation](index.md)
- **Component:** Frontend SPA — ad units
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-031](T-031-frontend-scaffold-and-search.md)
- **Blocks:** —
- **Requirements:** [FR-006](../../../../define-requirements.md#fr-006-revenue-and-monetisation), [NFR-001](../../../../define-requirements.md#nfr-001-performance)

## Description
Integrate Google AdSense (or equivalent) ad units on job listing, search results, and content pages per FR-006. Ad units must load asynchronously without blocking core content rendering. When `ADSENSE_PUBLISHER_ID` is absent from the environment, no ad request must be made and no broken ad container must appear in the layout.

## Acceptance criteria

```gherkin
Feature: AdSense integration

  Scenario: Ad unit renders on job detail page
    Given ADSENSE_PUBLISHER_ID is configured
    When a visitor loads a job detail page
    Then an ad unit must render in the designated placement zone
    And the ad must load asynchronously (after LCP content)
    And the core job content must be fully readable before the ad loads

  Scenario: Ad does not intercept Apply button click
    Given an ad unit is active on a job detail page
    When a user clicks the "Apply" or "View on source" button
    Then the user must navigate to the source URL
    And the ad must not intercept or redirect the click

  Scenario: Ad is suppressed when publisher ID is absent
    Given ADSENSE_PUBLISHER_ID is not set in the environment
    When a visitor loads any page that would normally carry an ad
    Then no ad request must be made (verified via network request log)
    And the page layout must render without a broken or empty ad container

  Scenario: Ad renders on search results page
    Given AdSense is configured and a search has been performed
    When the search results page loads
    Then an ad unit must appear in the designated zone without displacing search results
```

## Implementation notes
- Use the standard `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js">` loaded only when `ADSENSE_PUBLISHER_ID` is set.
- Ad placement zones: right sidebar on desktop search results; below job description on job detail; between paragraphs on content pages.
- Use `next/script` with `strategy="afterInteractive"` to ensure ad script does not block LCP.
- Apply button: plain anchor `<a href={job.applyUrl} target="_blank" rel="noopener noreferrer">`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Ad suppression verified in test by asserting no network request to pagead2.googlesyndication.com
- [ ] Apply button click tested to not be intercepted
