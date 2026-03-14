# TG-05: Frontend

> **Jira Epic:** Frontend

## Description
Implements the React TypeScript frontend: TypeScript types and API client, the upload form (drag-and-drop), the result display panel (heatmap, score/verdict, EXIF table, regions list), error handling, and the useAnalyse hook that manages the UI state machine. Frontend development can proceed in parallel with TG-03 and TG-04 once the API contract is established (T-007).

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-017](T-017-frontend-types-api-client.md) | TypeScript types and API client | S | T-007 | LOW |
| [T-018](T-018-upload-form.md) | UploadForm component and useAnalyse hook | M | T-017 | MEDIUM |
| [T-019](T-019-result-display.md) | ResultPanel, HeatmapDisplay, ExifTable, RegionList, ErrorBanner | M | T-017 | MEDIUM |
| [T-020-fe](T-020-fe-frontend-integration-test.md) | Frontend integration test (MSW) | S | T-018, T-019 | MEDIUM |

## Group effort estimate
- Optimistic (T-017 → T-018 and T-019 in parallel → T-020-fe): 4 days
- Realistic (1–2 devs): 5–6 days
