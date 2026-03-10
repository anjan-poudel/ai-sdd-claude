# NFR-011: POI Content Quality Standard

## Metadata
- **Category:** Content Quality
- **Priority:** SHOULD
- **Source:** Market research (OTA State 2026) — platforms that clearly explain what experiences deliver (e.g. practical info like "skip the line means bypassing ticket purchase queues, not security") reduce refunds and build trust. Structured practical fields are a differentiator vs SEO-only content pages.

## Description
Every POI record ingested or created on the platform should carry a defined set of practical information fields. Content that lacks these fields must be flagged as "incomplete" and deprioritised in display until enriched. This standard applies to all POI types: attractions, rest areas, natural sites, playgrounds, and bookable products.

### Required fields (MUST be populated to be shown as "complete")
| Field | Description |
|---|---|
| `name` | Display name |
| `category` | POI type (attraction / rest_area / playground / natural_site / product) |
| `coordinates` | Latitude / longitude |
| `description` | Min 50-word free-text description |
| `opening_hours` | Structured hours or "always open" |

### Enrichment fields (SHOULD be populated; displayed if available)
| Field | Description |
|---|---|
| `time_to_spend_minutes` | Recommended visit duration |
| `has_toilets` | Boolean |
| `has_playground` | Boolean |
| `has_parking` | Boolean |
| `accessibility` | Wheelchair accessible, pram-friendly, etc. |
| `family_suitability` | Age range tags (toddler / 5–12 / teen / all ages) |
| `cost_type` | free / paid / donation |
| `booking_required` | Boolean |
| `practical_notes` | Free text — e.g. "entry queue can be long; book ahead" |

## Acceptance criteria

```gherkin
Feature: POI Content Quality Standard

  Scenario: Incomplete POI is flagged in ingestion pipeline
    Given a POI record is ingested from an external source
    When the record is missing one or more required fields
    Then the record must be stored with status "incomplete"
    And it must not appear in public-facing destination or stopover results

  Scenario: Complete POI is promoted in search and stopover results
    Given a POI record has all required fields populated
    When the stopover engine queries POIs for a route segment
    Then complete POIs must be ranked above incomplete POIs of the same type

  Scenario: Enrichment fields improve stopover matching
    Given a user's travel party includes children under 12
    When the stopover engine selects rest stops
    Then stops with has_playground=true and family_suitability containing "5–12" must be ranked higher
    Than stops without those enrichment fields

  Scenario: Content team can view incomplete POI queue
    Given there are POIs with status "incomplete"
    When an admin accesses the content dashboard
    Then they must see a list of incomplete POIs sorted by most-viewed first
```

## Related
- FR: FR-002 (Stopover Intelligence — enrichment fields feed the demographic calibration)
- FR: FR-005 (POI Indexing — ingestion pipeline must apply this standard at load time)
- FR: FR-008 (Demographic-Based Filtering — relies on family_suitability and age tags)
