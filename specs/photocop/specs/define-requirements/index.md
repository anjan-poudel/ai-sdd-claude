# Requirements — PhotoCop

## Summary
- Functional requirements: 5
- Non-functional requirements: 5
- Areas covered: File Ingestion, Image Analysis, Visualisation, Metadata Analysis, API Response, Privacy, Reliability, Performance, Security

## Contents
- [FR/index.md](FR/index.md) — functional requirements
- [NFR/index.md](NFR/index.md) — non-functional requirements

## Open decisions
- **Verdict threshold boundaries**: The constitution does not define exact numeric cutoffs for "authentic" vs "suspicious" vs "likely manipulated". The thresholds 0.0–0.3 / 0.3–0.7 / 0.7–1.0 used in FR-002 are provisional and must be confirmed before implementation.
- **Heatmap delivery mechanism**: The constitution specifies "heatmap_url" but does not mandate whether this is a data URI or a server-hosted URL. NFR-001 (no persistence) constrains this to a data URI or ephemeral in-memory URL; a final decision is required before design.
- **Stateless API wording in constitution**: The constitution references "no session state on the server" but does not define rate limiting or concurrent request handling. These are deferred to a post-MVP release.
- **Benchmark dataset**: NFR-002 references a labelled benchmark of 200 images. The source and curation criteria for this dataset are not defined in the constitution and must be agreed before QA sign-off.

## Out of scope
- User authentication or accounts
- Persistent storage of images, reports, or analysis history
- Batch / bulk upload of multiple images in a single request
- Asynchronous job queuing or webhook callbacks
- Export formats other than JSON (PDF, CSV, etc.)
- Mobile native applications (iOS / Android)
- Rate limiting and abuse prevention (post-MVP)
- AI-generated image detection beyond the forensic techniques listed (ELA, noise analysis, clone detection)
- Image editing or redaction tools
