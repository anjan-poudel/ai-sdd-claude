# TG-02: Auth & User Accounts

> **Jira Epic:** Auth & User Accounts

## Description
Implements user registration, email/password login, OAuth2 (Google + LinkedIn), JWT access tokens, refresh token rotation, and user profile/preference management. This group also includes account deletion and the admin RBAC middleware.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-008](T-008-registration-and-email-verification.md) | User registration and email verification | M | T-002, T-007 | HIGH |
| [T-009](T-009-login-jwt-and-refresh-tokens.md) | Email/password login, JWT issuance and refresh token rotation | L | T-002, T-007 | HIGH |
| [T-010](T-010-oauth2-google-linkedin.md) | OAuth2 sign-in (Google & LinkedIn) | M | T-009 | MEDIUM |
| [T-011](T-011-user-profile-and-rbac.md) | User profile management, RBAC middleware, and admin role elevation | M | T-009 | MEDIUM |
| [T-012](T-012-account-deletion-worker.md) | Account deletion worker (deletion-queue consumer) | M | T-002, T-004 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 4 days
- Realistic (2 devs): 8 days
