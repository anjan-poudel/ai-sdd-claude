# T-021: Destination SSR/ISR pages

## Metadata
- **Group:** [TG-06 — Web App & SEO](index.md)
- **Component:** apps/web/app/destination/[slug]
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** T-005, T-008
- **Blocks:** T-022, T-024, T-025
- **Requirements:** FR-007, NFR-009, NFR-010

## Description
Build ISR destination pages at `/destination/[slug]` with canonical URLs, OG tags, schema.org TouristDestination structured data, nearby attraction listings, and affiliate product blocks.

## Acceptance criteria

```gherkin
Feature: Destination pages

  Scenario: Destination page renders with SEO metadata
    Given destination "sydney-nsw" exists in the database
    When GET /destination/sydney-nsw is called
    Then the page returns 200 with SSR HTML
    And <title> and <meta description> are present
    And schema.org JSON-LD with @type TouristDestination is in <head>
    And <link rel="canonical"> points to the page URL

  Scenario: Unknown destination returns 404
    Given no destination with slug "unknown-place"
    When GET /destination/unknown-place is called
    Then a 404 page is returned
```

## Implementation notes
- `export const revalidate = 3600` — ISR, revalidate hourly.
- `generateStaticParams`: pre-generate top 100 destinations at build time.
- Use Next.js `notFound()` for missing slugs.
- Mixed content: list free attractions first, then affiliate products below fold.
- NFR-010: LCP target <2s. Profile with Lighthouse.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Lighthouse Performance ≥ 90 on desktop and mobile
- [ ] Structured data validated by Google Rich Results Test
