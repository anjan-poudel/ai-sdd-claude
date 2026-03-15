# TG-02: Auth and User Accounts

> **Jira Epic:** Auth and User Accounts

## Description

Implements all authentication and user account management functionality: email/password registration with email verification, JWT login, RS256 token issuance, refresh token rotation with reuse detection, Google and LinkedIn OAuth2, RBAC middleware with admin MongoDB double-check, and the async account deletion worker. All security constraints from NFR-004 and the plan-tasks security blockers are enforced in this group.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-008 | Implement registration with email verification | M | T-002, T-005, T-006, T-007 | HIGH |
| T-009 | Implement login, JWT issuance, and refresh token rotation | M | T-008 | CRITICAL |
| T-010 | Implement Google and LinkedIn OAuth2 sign-in | M | T-009 | HIGH |
| T-011 | Implement RBAC middleware and user profile endpoints | S | T-009 | HIGH |
| T-012 | Implement async account deletion worker | M | T-004, T-011 | MEDIUM |

---

## T-008: Implement registration with email verification

**Design-l2 reference:** Section 1.5 (Auth Service), Section 2.3 (`users` collection), Section 7.1 (Registration Flow)

### Description

Implement `POST /api/auth/register`, `GET /api/auth/verify-email`, and `POST /api/auth/resend-verification`. The registration flow: validate input with Zod, check email uniqueness, hash password with argon2id (cost 12), generate a 32-byte random hex verification token, store SHA-256 hash of the token in the user document, send the verification email via SES asynchronously, and return `HTTP 201 { userId }`. Email verification sets `emailVerified: true` and clears the token fields. Token expires after 24 hours.

### Acceptance criteria

- `POST /api/auth/register` with a valid email and password of 10+ characters returns `HTTP 201 { data: { userId } }`.
- The password is stored as an argon2id hash; the plain-text value `"hunter2"` does not appear in the `users` document.
- `users.emailVerificationToken` stores the SHA-256 hash of the token (not the raw token); the raw token appears only in the email URL.
- `GET /api/auth/verify-email?token=<<rawHex>>` sets `emailVerified: true` and clears both `emailVerificationToken` and `emailVerificationTokenExpiresAt`.
- A token that has passed its `emailVerificationTokenExpiresAt` returns `HTTP 400` with a meaningful error.
- `POST /api/auth/resend-verification` is rate-limited to 3 calls per hour per email (using a Redis counter key `resend-verify:${emailHash}`).
- Attempting to register with an already-registered email returns `HTTP 409` with `code: "EMAIL_ALREADY_REGISTERED"`.
- No PII (email address) appears in any log entry during registration processing (enforced by T-006 redaction).

### Implementation notes

- File: `services/api/src/routes/auth/register.ts` and `services/api/src/services/auth.service.ts`.
- Use `argon2` npm package with `{ type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }` (cost ~12 equivalent).
- Token generation: `crypto.randomBytes(32).toString('hex')` — 64-char hex string.
- Token hash storage: `createHash('sha256').update(rawToken).digest('hex')`.
- Email verification URL: `${OAUTH_REDIRECT_BASE_URL}/verify-email?token=${rawToken}`.
- SES email dispatch: use `@aws-sdk/client-ses`; do NOT await the send in the request handler — dispatch and respond with 201 immediately.
- Input validation schema (Zod): `email` RFC 5321 format, `password` min 10 max 128 chars.
- The `role` field must be stripped from any registration request body via Zod `strict()` or explicit `.omit({ role: true })`.
- Rate limit key for resend: `resend-verify:${sha256(email.toLowerCase())}` — hash the email so it is not stored in Redis.

### Test requirements

- Unit test: `hashPassword("hunter2")` returns an argon2id hash that verifies correctly with `argon2.verify`.
- Unit test: registration with `password` of 9 characters returns 422 validation error.
- Integration test: register a user, confirm `users` document has `emailVerified: false` and `passwordHash` is not `"hunter2"`.
- Integration test: call `GET /api/auth/verify-email?token=<<validToken>>`, confirm `emailVerified: true`.
- Integration test: re-use an already-consumed token, confirm 400 response.
- Integration test: register with duplicate email, confirm 409.
- Unit test: `resend-verification` 4th call within an hour returns 429.

### Estimated complexity: M

---

## T-009: Implement login, JWT issuance, and refresh token rotation

**Design-l2 reference:** Section 1.5 (Auth Service interfaces), Section 2.4 (`refresh_tokens` collection), Section 7.2 (Login Flow), Section 7.4 (Token Refresh Flow), Section 9.3 (`POST /api/auth/login`), Section 9.5 (`POST /api/auth/refresh`)

### Description

Implement `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/.well-known/jwks.json`. Login: verify email is verified, verify argon2id hash, issue RS256 JWT (15-minute TTL), generate and store hashed refresh token (30-day TTL), set HTTP-only `SameSite=Strict` cookie. Refresh: hash incoming cookie token, look up in DB, check for reuse (if `usedAt` already set, revoke all tokens for user and return 401). Token rotation: mark old token `usedAt = now`, issue new JWT and new refresh token. Login lockout: 5 failed attempts in 15 minutes locks account for 15 minutes using Redis.

### Acceptance criteria

- `POST /api/auth/login` with valid credentials returns `HTTP 200` with `accessToken` (JWT RS256) and sets a `refreshToken` HTTP-only cookie with `Path=/api/auth/refresh`.
- The `accessToken` JWT has `sub: userId`, `role`, `iat`, `exp: iat + 900`, and `jti` fields.
- `POST /api/auth/refresh` with a valid refresh token cookie returns a new `accessToken` and sets a new `refreshToken` cookie; the old token's `usedAt` is set.
- Refresh token reuse detection: if the same raw token is used twice, ALL refresh tokens for that user are revoked (`revokedAt = now`) and the response is `HTTP 401` with `code: "REFRESH_TOKEN_REUSE_DETECTED"`.
- 5 consecutive failed login attempts for the same email within 15 minutes returns `HTTP 429` with `code: "RATE_LIMITED"` on the 6th attempt; the lockout expires after 15 minutes.
- `GET /api/auth/.well-known/jwks.json` returns the RS256 public key as a valid JWKS document.
- `POST /api/auth/logout` revokes all refresh tokens for the current user and clears the cookie.
- An expired JWT (past `exp`) returns `HTTP 401` on any authenticated endpoint.

### Implementation notes

- Use `jsonwebtoken` for JWT signing/verification with `{ algorithm: 'RS256' }`.
- RS256 keys loaded from `config.JWT_PRIVATE_KEY` / `config.JWT_PUBLIC_KEY` (from Secrets Manager via T-007).
- `refresh_tokens` document: store `tokenHash = sha256(rawToken)`, `usedAt: null` initially.
- Token rotation atomicity: use `findOneAndUpdate` with `{ tokenHash }` filter; set `usedAt = now` and check previous value in the same operation to detect concurrent reuse.
- Lockout Redis key: `login:lockout:${sha256(email.toLowerCase())}` with TTL `LOGIN_LOCKOUT_DURATION_MS / 1000`.
- Login failed attempt counter: Redis key `login:attempts:${sha256(email)}` with 15-minute TTL; increment on each failure; if >= 5, set lockout key.
- Cookie: `res.cookie('refreshToken', rawToken, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth/refresh', maxAge: REFRESH_TOKEN_TTL_DAYS * 86400 * 1000 })`.
- JWKS: generate the JWKS JSON from the RSA public key PEM using `jwk-to-pem` or `node-jose`.

### Test requirements

- Unit test: `signJwt(payload)` produces a token verifiable by `jsonwebtoken.verify` with the public key.
- Integration test: login, store access token, make authenticated request, confirm 200.
- Integration test: login, wait for token expiry (or mock `Date.now`), make request, confirm 401.
- Integration test: refresh token rotation — login, use refresh token to get new access token, confirm old refresh cookie is invalidated.
- Integration test: reuse detection — replay the same raw refresh token value after it has already been used, confirm 401 and all tokens revoked.
- Integration test: 5 failed logins, 6th returns 429; wait for lockout expiry (or advance Redis TTL in test), confirm login succeeds.
- Unit test: JWKS endpoint returns JSON with `keys[0].kty === "RSA"`.

### Estimated complexity: M

---

## T-010: Implement Google and LinkedIn OAuth2 sign-in

**Design-l2 reference:** Section 1.5 (AuthService.oauthCallback), Section 2.3 (`users.oauthIdentities`), Section 7.3 (OAuth2 Flow), Section 7.5 (JWT Signing Key Management)

### Description

Implement `GET /api/auth/oauth/:provider` (redirect initiation) and `GET /api/auth/oauth/:provider/callback` (code exchange + user upsert). Providers: `google` and `linkedin`. Anti-CSRF: `state` parameter is a 16-byte random hex nonce stored in Redis with 10-minute TTL (`oauth:state:${nonce}`). On callback: verify state, exchange code for tokens, fetch user profile (email + provider ID), upsert user by `(provider, providerId)`, issue JWT + refresh token as in T-009.

### Acceptance criteria

- `GET /api/auth/oauth/google` redirects to the Google authorization URL with `state`, `client_id`, `redirect_uri`, `scope=openid email profile`, and `response_type=code`.
- `GET /api/auth/oauth/google/callback?code=X&state=Y` with a valid state nonce: exchanges code for Google tokens, fetches the Google user profile, upserts the MongoDB `users` document with the Google OAuth identity, and returns JWT + refresh token.
- If `state` nonce in the callback does not match the Redis-stored nonce, the callback returns `HTTP 400` (CSRF protection).
- A first-time OAuth user (no existing account with that email or provider ID) gets a new `users` document created with `emailVerified: true` (Google/LinkedIn already verified).
- A returning OAuth user with an existing account retrieves the existing document and issues new tokens.
- If the OAuth provider returns an error in the callback (e.g. `error=access_denied`), the user is redirected to the frontend login page with a descriptive error query parameter.
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` are loaded from Secrets Manager (not hardcoded).
- LinkedIn scopes: `["r_emailaddress", "r_liteprofile"]`.

### Implementation notes

- Use `passport` with `passport-google-oauth20` and `passport-linkedin-oauth2`, OR implement the OAuth2 code exchange manually with `node-fetch` (the latter avoids Passport's opinionated session management).
- Manual implementation is preferred: `GET /initiate` → generate nonce → store `oauth:state:${nonce}` in Redis with 60s TTL → redirect to provider auth URL.
- Callback: verify `state` by checking Redis key exists (one-time use: delete after verify). Exchange `code` for tokens via `POST` to provider token endpoint.
- Google user info: fetch `https://www.googleapis.com/oauth2/v3/userinfo` with the access token.
- LinkedIn user info: fetch `https://api.linkedin.com/v2/me` and `https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))`.
- User upsert: `findOneAndUpdate({ 'oauthIdentities.provider': provider, 'oauthIdentities.providerId': providerId }, { $setOnInsert: { email, emailVerified: true, role: 'user' }, $addToSet: { oauthIdentities: { provider, providerId, linkedAt: new Date() } } }, { upsert: true, new: true })`.
- After successful OAuth sign-in, issue JWT and refresh token identically to T-009 login flow.

### Test requirements

- Unit test (mocked HTTP): `exchangeOAuthCode('google', 'mock-code', 'mock-redirect')` calls the Google token endpoint and returns a parsed profile.
- Unit test: CSRF state verification — callback with wrong `state` returns error.
- Unit test: nonce is single-use — second use of same nonce fails even if not expired.
- Integration test: end-to-end OAuth flow with a mock OAuth server (use `nock` to intercept provider HTTP calls), confirm user document created and JWT returned.
- Integration test: second OAuth login with same provider ID returns same `userId`.

### Estimated complexity: M

---

## T-011: Implement RBAC middleware and user profile endpoints

**Design-l2 reference:** Section 1.4 (Web API middleware stack), Section 1.5 (Admin role double-check), Section 7.6 (Admin Role Elevation), Section 9 (API contracts)

### Description

Implement the Express RBAC middleware that: (1) verifies the JWT in the `Authorization: Bearer` header; (2) sets `req.user = { userId, email, role }` on all routes; (3) for admin routes, performs a MongoDB double-check on `users.role` to prevent stale-token privilege escalation. Implement user profile endpoints: `GET /api/users/me`, `PATCH /api/users/me/preferences`, `GET/POST/DELETE /api/users/me/saved-jobs`.

### Acceptance criteria

- A request to an admin endpoint with a valid `role: "admin"` JWT but where the MongoDB `users` document has `role: "user"` returns `HTTP 403` (stale token protection).
- A request to an authenticated endpoint with no `Authorization` header proceeds but `req.user` is `null` (public routes remain accessible to anonymous users).
- An expired JWT returns `HTTP 401` with `code: "UNAUTHORIZED"`.
- `GET /api/users/me` returns the authenticated user's profile (excluding `passwordHash`, `emailVerificationToken`, `fcmTokens`).
- `PATCH /api/users/me/preferences` updates `notificationPreferences`; the `role` field is stripped from the request body by Zod validation.
- `POST /api/users/me/saved-jobs` saves a job for the authenticated user; duplicate saves return `HTTP 409`.
- `DELETE /api/users/me/saved-jobs/:jobId` removes a saved job.
- Admin MongoDB check timeout: if the DB check for admin role exceeds `AUTH_ADMIN_CHECK_TIMEOUT_MS` (2000ms), the request proceeds with a WARN log and the JWT role is trusted (fail-open to prevent service degradation).

### Implementation notes

- JWT middleware: use `jsonwebtoken.verify` with the RS256 public key. If verification throws, set `req.user = null` and call `next()`.
- RBAC middleware for admin routes: after JWT verify, `const dbUser = await User.findById(req.user.userId, { role: 1 }).maxTimeMS(AUTH_ADMIN_CHECK_TIMEOUT_MS)`; if `dbUser.role !== 'admin'`, return 403.
- The admin check middleware is applied only to routes under `/api/admin/*`.
- `req.user` type: `{ userId: string; email: string; role: 'user' | 'admin' } | null`.
- Saved jobs: `savedJobs.model` upsert with `{ userId, jobId }` unique index (T-002); handle `MongoError code 11000` as 409.
- Profile response: use a Zod `transform` to strip `passwordHash`, `emailVerificationToken`, etc., before returning.
- User profile PATCH: only allow updating `displayName`, `notificationPreferences`; strip all other fields.

### Test requirements

- Unit test: `authenticateJwt` middleware with a valid token sets `req.user` correctly.
- Unit test: expired JWT causes `req.user = null` on public routes; causes 401 on protected routes.
- Integration test: sign in as `role: "admin"` via JWT but change `users.role` to `"user"` in DB mid-test; confirm 403 on admin endpoint.
- Integration test: `POST /api/users/me/saved-jobs` twice with same `jobId` returns 409 on second call.
- Unit test: `PATCH /api/users/me/preferences` request body containing `{ role: "admin" }` does not update the role.

### Estimated complexity: S

---

## T-012: Implement async account deletion worker

**Design-l2 reference:** Section 4.1 (`deletion-queue`, account-worker note), Section 2.3 (`users.deletionScheduledFor`)

### Description

Implement the `account-worker` ECS service and the `DELETE /api/users/me` endpoint. The API endpoint creates a `deletion-queue` BullMQ job and marks the user with `deletionRequestedAt = now`, `deletionScheduledFor = now + 30 days`. The worker cascades deletion of: saved jobs, saved searches, alerts, notifications, refresh tokens, agency reviews, FCM tokens, and finally the user document itself. The worker sends a confirmation email via SES before deleting the email.

### Acceptance criteria

- `DELETE /api/users/me` returns `HTTP 202 Accepted` and enqueues a deletion job with `jobId = "deletion:${userId}"`.
- After deletion is enqueued, `users.deletionRequestedAt` is set and `users.deletionScheduledFor = deletionRequestedAt + 30 days`.
- The account-worker processes the deletion job by: deleting all `saved_jobs`, `saved_searches`, `alerts`, `notifications` for the user, revoking all `refresh_tokens`, and setting `users.email = null`, `users.displayName = null`, `users.passwordHash = null`, `users.oauthIdentities = []`.
- A confirmation email is sent via SES to the original email address before it is nulled out.
- After deletion completes, login attempts with the original email return `HTTP 403` with `code: "ACCOUNT_DELETED"`.
- The deletion job uses `attempts: 5` with exponential backoff from 60s (Section 4.1).
- If the user document has already been deleted (e.g. second enqueue), the worker completes silently without error.

### Implementation notes

- File: `services/account-worker/src/main.ts` — registers a BullMQ worker for `deletion-queue` only.
- The deletion must be performed as a MongoDB transaction spanning all collections to ensure atomicity.
- Cascade order to prevent foreign-key-like dangling references: first delete child collections (`saved_jobs`, `saved_searches`, `alerts`, `notifications`, `refresh_tokens`), then null PII fields on the `users` document (do not delete the document to preserve audit trail via `deletionScheduledFor`).
- The `users` document is soft-deleted by nulling PII fields, not hard-deleted. This preserves the `agency_reviews` authorId reference for moderation records.
- SES send: use `@aws-sdk/client-ses`; the email subject is "Your GovJobs Portal account deletion is in progress".
- After deletion, if the user attempts to authenticate: the auth service checks `users.deletionRequestedAt !== null` and `users.email === null`; returns `ACCOUNT_DELETED` error.

### Test requirements

- Integration test: call `DELETE /api/users/me`, confirm `HTTP 202` and `deletionRequestedAt` is set on user document.
- Integration test: process the deletion job, confirm `saved_jobs`, `saved_searches`, `alerts`, and `refresh_tokens` records for the user are all deleted.
- Integration test: after deletion, `POST /api/auth/login` with the original email returns 403 `ACCOUNT_DELETED`.
- Unit test: worker handles a `DeletionQueueJob` where the user document has already been deleted (idempotency — no error thrown).
- Integration test: deletion cascade runs in a MongoDB transaction — if an error occurs mid-cascade, no partial deletion is committed.

### Estimated complexity: M
