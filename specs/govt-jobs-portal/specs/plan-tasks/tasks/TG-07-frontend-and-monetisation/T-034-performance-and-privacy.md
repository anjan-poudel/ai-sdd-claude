# T-034: Performance optimisation (FCP < 2s on 4G) and Privacy Policy page

## Metadata
- **Group:** [TG-07 — Frontend & Monetisation](index.md)
- **Component:** Frontend SPA — performance
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-031](T-031-frontend-scaffold-and-search.md)
- **Blocks:** —
- **Requirements:** [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Optimise the portal to meet NFR-001 performance targets: FCP < 2000ms on 4G simulation (Lighthouse), LCP < 4000ms. Techniques: Next.js SSR for job detail pages, CDN caching for static assets, image optimisation (`next/image`), font preloading, CSS critical path inlining. Create the Privacy Policy static page at `/privacy-policy` accessible without login. Footer link to Privacy Policy must be present on every page.

## Acceptance criteria

```gherkin
Feature: Performance and Privacy Policy

  Scenario: Job detail page FCP meets target on 4G
    Given the portal is running in production configuration with CDN enabled
    When a Lighthouse audit simulates a 4G mobile connection loading a job detail page
    Then the First Contentful Paint must be under 2000ms
    And the Largest Contentful Paint must be under 4000ms

  Scenario: Privacy Policy is accessible from every page
    Given the portal is rendered on any page (home, search, job detail, content article)
    When the page HTML is inspected
    Then a link to /privacy-policy must be present in the page footer
    And GET /privacy-policy must return HTTP 200 without requiring login

  Scenario: Static assets are served with long-term cache headers
    Given a visitor loads the portal
    When the browser inspects the Cache-Control header for CSS and JS bundles
    Then the header must include max-age >= 31536000 (1 year) and immutable
    And the asset URL must include a content hash for cache busting
```

## Implementation notes
- Use Next.js `getServerSideProps` for job detail (fresh data on every request) and `getStaticProps` for the Privacy Policy (static).
- CDN: configure CloudFront (or equivalent) with appropriate cache behaviours.
- Font: preload the primary font in `<head>` with `<link rel="preload" as="font">`.
- Lighthouse CI: add a Lighthouse CI step to the GitHub Actions workflow that enforces FCP < 2000ms.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Lighthouse CI gate in the CI pipeline passes with FCP < 2000ms
- [ ] Privacy Policy footer link presence verified by automated DOM test across all page types
- [ ] Cache-Control headers tested with a mock CDN response
