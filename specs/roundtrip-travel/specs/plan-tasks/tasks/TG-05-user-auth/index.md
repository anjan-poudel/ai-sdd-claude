# TG-05: User & Auth

> **Jira Epic:** User & Auth

## Description
NextAuth.js authentication, user profile management, saved itineraries, and privacy-compliant account deletion. Implements FR-003, FR-009, NFR-005, NFR-006.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-017](T-017-nextauth-google-oauth.md) | NextAuth.js + Google OAuth setup | M | T-003 | MEDIUM |
| [T-018](T-018-user-profile-api.md) | User profile and preferences API | S | T-017 | LOW |
| [T-019](T-019-save-and-share-itinerary.md) | Save and share itinerary | M | T-017, T-013 | MEDIUM |
| [T-020](T-020-account-deletion.md) | Account deletion (Privacy Act compliance) | S | T-017 | HIGH |

## Group effort estimate
- Optimistic: 4 days
- Realistic: 5 days
