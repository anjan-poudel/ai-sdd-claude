# T-025: Display advertising (Google AdSense)

## Metadata
- **Group:** [TG-06 — Web App & SEO](index.md)
- **Component:** apps/web/components/AdSlot
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-021
- **Blocks:** —
- **Requirements:** FR-010

## Description
Integrate Google AdSense with an `AdSlot` React component. Place ad slots on destination pages (sidebar), attraction pages (bottom), and itinerary builder results (between stopover cards). Ensure ads do not break page layout or LCP.

## Acceptance criteria

```gherkin
Feature: Display advertising

  Scenario: Ad slot renders on destination page
    Given NEXT_PUBLIC_ADSENSE_ID is set in environment
    When a destination page is loaded
    Then an AdSense ins element with the configured slot ID is present in the DOM

  Scenario: No ad slot rendered without AdSense ID
    Given NEXT_PUBLIC_ADSENSE_ID is not set
    When a destination page is loaded
    Then no AdSense script or ins element is present
```

## Implementation notes
- AdSlot component should be wrapped in a Suspense boundary to avoid blocking LCP.
- AdSense script loaded with `strategy="lazyOnload"` (Next.js Script component) — do NOT block page render.
- Slot positions: destination sidebar (desktop only), between stopover 2 and 3 on mobile.
- NFR-010: verify Lighthouse Performance score is not degraded by >5 points after adding ads.
- CLS: AdSlot must have a min-height placeholder to prevent layout shift.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Lighthouse CLS score ≤ 0.1 with ads present
- [ ] AdSense approval obtained (manual step — account setup, not code)
