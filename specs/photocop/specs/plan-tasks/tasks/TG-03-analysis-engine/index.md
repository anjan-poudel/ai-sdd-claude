# TG-03: Analysis Engine

> **Jira Epic:** Analysis Engine

## Description
Implements the forensic analysis pipeline: shared types, the engine orchestrator (concurrent fan-out), ELA Analyser, Noise Analyser, Clone Detector, and Score Aggregator. This is the highest-risk group because algorithm accuracy and performance targets (NFR-002, NFR-003) depend on implementation quality.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-008](T-008-analysis-engine-orchestrator.md) | Analysis Engine orchestrator and shared types | M | T-006, T-007 | HIGH |
| [T-009](T-009-ela-analyser/) | ELA Analyser | L | T-008 | HIGH |
| [T-010](T-010-noise-analyser.md) | Noise Analyser | M | T-008 | HIGH |
| [T-011](T-011-clone-detector.md) | Clone Detector | L | T-008 | HIGH |
| [T-012](T-012-score-aggregator.md) | Score Aggregator | S | T-009, T-010, T-011 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel — T-009, T-010, T-011 run concurrently after T-008): 5 days
- Realistic (2 devs): 8–10 days
