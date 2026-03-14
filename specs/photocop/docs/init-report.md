# PhotoCop — Initialisation Report

**Date**: 2026-03-14
**Scaffold type**: Greenfield
**Session**: default

---

## Project Summary

| Field | Value |
|-------|-------|
| Name | PhotoCop |
| Type | Web application |
| Frontend | React (TypeScript) |
| Backend | Python / FastAPI |
| Processing | In-memory only |
| MVP scope | Upload → detect → heatmap + JSON |

---

## Answers Captured

| # | Question | Answer |
|---|----------|--------|
| Q1 | Project type | Greenfield |
| Q2 | Name & description | PhotoCop — image manipulation and fraud detection for any image type |
| Q3 | Primary users | Any user wanting to detect image manipulation and editing |
| Q4 | Platform & stack | React frontend, Python/FastAPI backend |
| Q5 | Core capabilities | Manipulation detection, heatmap visualisation, EXIF extraction |
| Q6 | Non-functional requirements | In-memory processing, high accuracy |
| Q7 | MVP definition | Web-based image processing with heatmap result and JSON of results |

---

## Files Generated

| File | Purpose |
|------|---------|
| `constitution.md` | Project purpose, standards, NFRs, artifact manifest placeholder |
| `.ai-sdd/ai-sdd.yaml` | Workflow engine config (pre-existing, sufficient) |
| `docs/init-report.md` | This file |

---

## Next Steps

1. Run `/sdd-run` to start the SDD workflow
2. The BA agent will produce detailed functional requirements (`specs/define-requirements.md`)
3. Review and approve the HIL gate before architecture begins
4. The workflow will proceed: BA → Architect → Principal Engineer → Lead Engineer → Developer → Reviewer

---

## Workflow

The default `default-sdd` workflow will be used:

```
define-requirements → design-l1 → design-l2 → plan-tasks → implement → review
```

Each phase has a HIL gate; you will be prompted to approve before the next phase begins.
