# TG-04: Output Pipeline

> **Jira Epic:** Output Pipeline

## Description
Implements the three output-generation components (Heatmap Renderer, EXIF Extractor, Response Assembler) and wires them into the API router to complete the end-to-end request cycle. All components must operate entirely in memory with no disk writes.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-013](T-013-shared-response-types.md) | Shared Pydantic response types | S | T-007 | LOW |
| [T-014](T-014-heatmap-renderer.md) | Heatmap Renderer | M | T-012, T-013 | MEDIUM |
| [T-015](T-015-exif-extractor.md) | EXIF Extractor | S | T-006, T-013 | MEDIUM |
| [T-016](T-016-response-assembler.md) | Response Assembler and router wiring | M | T-014, T-015 | HIGH |

## Group effort estimate
- Optimistic (T-014 and T-015 in parallel): 3 days
- Realistic (2 devs): 4–5 days
