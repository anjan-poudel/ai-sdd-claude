# T-017: NextAuth.js + Google OAuth setup

## Metadata
- **Group:** [TG-05 — User & Auth](index.md)
- **Component:** apps/web (NextAuth.js), backend/ (Spring Security JWT validation)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-003
- **Blocks:** T-018, T-019, T-020
- **Requirements:** FR-003, NFR-006

## Description
Configure NextAuth.js v5 with Google OAuth provider in the Next.js frontend. On successful sign-in, NextAuth issues a JWT that is forwarded as `Authorization: Bearer <token>` to the Spring Boot API. Configure Spring Security in the backend to validate these JWTs and extract the user principal.

## Acceptance criteria

```gherkin
Feature: Google OAuth authentication

  Scenario: User signs in with Google
    Given a user clicks "Sign in with Google"
    When they complete the Google OAuth flow
    Then a NextAuth JWT session is created with the user's email and id
    And a User record is created in PostgreSQL via the Spring Boot API (or updated if exists)
    And the user is redirected to the previous page

  Scenario: Next.js passes JWT to Spring Boot API
    Given an authenticated user with a NextAuth session
    When the Next.js frontend calls a protected Spring Boot endpoint
    Then the request includes Authorization: Bearer <jwt>
    And Spring Security validates the JWT and returns 200

  Scenario: Unauthenticated request to protected Spring Boot route returns 401
    Given no Authorization header is present
    When a request is made to POST /api/user/itinerary
    Then the Spring Boot API returns 401 Unauthorized
```

## Implementation notes
- **Frontend (Next.js):** NextAuth.js v5 with Google provider. Session strategy: `jwt`. JWT stored in HTTP-only cookie. CSRF handled by NextAuth automatically. Google OAuth PKCE enabled by default.
- **Backend (Spring Boot):** Add `spring-boot-starter-oauth2-resource-server`. Configure `application.yml` with `spring.security.oauth2.resourceserver.jwt.secret` (shared HMAC secret with NextAuth). All `/api/**` routes except `/api/affiliate/redirect` and `/api/health` require valid JWT.
- **User provisioning:** `POST /api/user/provision` called by Next.js after first sign-in to create/update the User record in PostgreSQL.
- NFR-006: session cookie `sameSite: 'lax'`, `secure: true` in production; Spring Security CSRF disabled (JWT-based, not cookie-based for API).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] E2E test: full OAuth flow (mocked Google callback in Next.js) + JWT validation in Spring Boot
- [ ] Session cookie is HTTP-only and secure in production config
