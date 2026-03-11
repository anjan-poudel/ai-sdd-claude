# TG-08: End-to-End Integration

> **Jira Epic:** End-to-End Integration

## Description
Wires all adapters into the engine configuration and implements the end-to-end async workflow integration test covering the full approval flow with mock adapters. Covers FR-014 and validates the complete system.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-025](T-025-wire-adapters-into-engine.md) | Wire Adapters into Engine Config | L | T-002, T-003, T-008 | HIGH |
| [T-026](T-026-end-to-end-async-test.md) | End-to-End Async Workflow Test | L | T-025, T-009, T-010, T-017 | HIGH |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 4 days
