# T-024: Sitemap.xml and structured data

## Metadata
- **Group:** [TG-06 — Web App & SEO](index.md)
- **Component:** apps/web/app/sitemap.ts
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-021
- **Blocks:** —
- **Requirements:** NFR-009

## Description
Generate dynamic sitemap.xml using Next.js sitemap convention. Include destination pages, attraction pages, and public itinerary share pages. Add canonical URL logic.

## Acceptance criteria

```gherkin
Feature: Sitemap

  Scenario: Sitemap includes all destination pages
    Given 50 destinations in the database
    When GET /sitemap.xml is called
    Then the sitemap contains 50 destination URLs
    And each URL has a lastmod date

  Scenario: Private itineraries are excluded from sitemap
    Given itineraries with isPublic = false
    When the sitemap is generated
    Then those itinerary URLs are NOT in the sitemap
```

## Implementation notes
- Next.js `app/sitemap.ts` convention (not manually written XML).
- Incremental sitemap: destinations + attractions may be 10k+ entries → use sitemap index.
- Submit sitemap URL to Google Search Console (manual step — not a code task).
- NFR-009: `robots.txt` should reference sitemap URL.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Sitemap validates with Google's sitemap validator
- [ ] robots.txt references sitemap
