# T-004: PostGIS extension and spatial index

## Metadata
- **Group:** [TG-01 — Infrastructure & Database](index.md)
- **Component:** packages/db
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** T-003
- **Blocks:** T-010
- **Requirements:** NFR-001, NFR-002

## Description
Add the `geom` column (geometry(Point, 4326)) to the Attraction table, populate it from lat/lon, and create the GIST spatial index. Validate with a test ST_DWithin query.

## Acceptance criteria

```gherkin
Feature: PostGIS spatial index

  Scenario: Spatial query returns nearby attractions
    Given 10 attractions seeded with known lat/lon values
    When a ST_DWithin query is run for a point 15km from 3 attractions
    Then exactly 3 attractions are returned
    And the query completes in under 100ms

  Scenario: geom column stays in sync with lat/lon
    Given an attraction is upserted with new lat/lon
    Then the geom column is updated automatically via a DB trigger or application logic
```

## Implementation notes
- Raw SQL migration (not Prisma native): `ALTER TABLE "Attraction" ADD COLUMN geom geometry(Point,4326); CREATE INDEX attractions_geom_idx ON "Attraction" USING GIST (geom);`
- Prisma `$executeRaw` or separate migration SQL file.
- Add a Prisma middleware or DB trigger to keep `geom` in sync with lat/lon on write.
- Use `geography` type for distance calculations (correct spherical distance), not `geometry` (planar).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] `EXPLAIN ANALYZE` on ST_DWithin query confirms index is used (no seq scan)
