# TG-07: Frontend and Monetisation

> **Jira Epic:** Frontend and Monetisation

## Description

Implements the Next.js frontend application: SSR for job listing and search pages (SEO-critical, FCP target <2s on 4G), CSR for account and admin pages, the auth UI flows (register, login, OAuth, email verify), and Google AdSense integration loaded asynchronously without render blocking. Privacy Policy link in every page footer.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-031 | Implement Next.js app scaffold, search UI, and job detail page | L | T-021, T-022 | MEDIUM |
| T-032 | Implement auth UI flows (register, login, OAuth, email verification) | M | T-008, T-009, T-010 | MEDIUM |
| T-033 | Implement Google AdSense integration | S | T-031 | LOW |
| T-034 | Frontend performance optimisation and Privacy Policy footer | S | T-031, T-032, T-033 | LOW |

---

## T-031: Implement Next.js app scaffold, search UI, and job detail page

**Design-l2 reference:** Section 9 (Component 9 — Frontend), Section 9.1/9.2 (API contracts), NFR-001 (FCP <2s on 4G), FR-002 (Search and Discovery)

### Description

Scaffold the Next.js 14 (App Router) frontend in `services/frontend/`. Configure SSR for the search results page (`/jobs`) and job detail page (`/jobs/:id`); CSR for account management (`/account/*`), saved searches, alerts, and admin pages (`/admin/*`). Implement the search results page with keyword/filter UI and the job detail page with preparation resources and source attribution.

### Page routing

| Route | Rendering | Auth Required | Description |
|-------|-----------|---------------|-------------|
| `/` | SSR (static) | No | Home page with search bar |
| `/jobs` | SSR (dynamic) | No | Search results |
| `/jobs/[id]` | SSR (dynamic) | No | Job detail |
| `/account` | CSR | Yes | Account dashboard |
| `/account/saved-jobs` | CSR | Yes | Saved jobs list |
| `/account/saved-searches` | CSR | Yes | Saved searches |
| `/account/alerts` | CSR | Yes | Alert subscriptions |
| `/account/settings` | CSR | Yes | Profile and preferences |
| `/admin/*` | CSR | Admin | Admin CMS pages |
| `/content/[slug]` | SSR (dynamic) | No | Content article |
| `/agencies/[name]` | SSR (dynamic) | No | Agency profile with reviews |

### Acceptance criteria

- `GET /jobs?q=policy+analyst` renders via SSR using `fetch` to `GET /api/jobs/search?q=policy+analyst` in the Next.js server; the HTML includes job titles in the initial response body (SEO).
- `GET /jobs/:id` renders via SSR; the HTML includes the full job description in the initial response body.
- Search results page includes a filter sidebar with checkboxes for `governmentLevel`, `state`, `classification`, and a salary range slider; applying filters re-runs the search.
- Job detail page displays: title, agency, location, classification, salary band, closing date, description, source attribution (source name + link to original listing), and `preparationResources` links.
- The `isSaved` state is rendered client-side (not SSR) to avoid personalised HTML being cached by CDN.
- `GET /jobs?q=` (empty query) shows all active jobs with facets.
- Pagination: "Load more" button or page number navigation; uses `page` and `pageSize` query parameters.
- FCP on the job detail page under Lighthouse 4G throttle simulation is under 2000ms (verified in CI via `lighthouse-ci`).
- All pages include a Privacy Policy link in the `<footer>` element.

### Implementation notes

- Framework: Next.js 14 with App Router. `services/frontend/` package in the monorepo.
- SSR pages use `async function Page({ params, searchParams })` server components. They call the internal API directly (not via HTTP — use the service function directly in the same process, or via server-side fetch to `http://api:3000`).
- In production on Vercel, the API is a separate ECS service. The Next.js SSR pages call `NEXT_PUBLIC_API_BASE_URL` (set to the API's ALB URL).
- State management for CSR pages: use `zustand` or React Context.
- Search form: use URL search params for state (`/jobs?q=X&governmentLevels=federal,state`) — this enables shareable, bookmarkable search URLs.
- Job detail page `description`: render sanitised HTML via `dangerouslySetInnerHTML` (the HTML was sanitised at ingest time by T-013).
- Source attribution: render `Sources: <a href="${source.sourceUrl}">${source.sourceName}</a>` links.
- Image optimisation: Next.js `<Image>` component for any logos; agency logos are optional.
- CSS: use Tailwind CSS 3.x.

### Test requirements

- Unit test (React Testing Library): `SearchResultCard` renders job `title`, `agency`, `location`, `salaryBand`, `expiryDate`.
- Unit test: `JobDetailPage` renders the `preparationResources` section when `preparationResources.length > 0`.
- Unit test: `JobDetailPage` renders source attribution link with `href` pointing to `source.sourceUrl`.
- Integration test (Playwright): `GET /jobs?q=policy` — the page HTML contains at least one `.job-result-card` element in the server-rendered HTML (confirm SSR).
- Integration test (Playwright): filter by `governmentLevel=federal` — URL updates to include `governmentLevels=federal` and results update.
- Lighthouse CI test: job detail page FCP < 2000ms on 4G throttle (run in CI).
- Unit test: footer contains a link with `href="/privacy"`.

### Estimated complexity: L

---

## T-032: Implement auth UI flows (register, login, OAuth, email verification)

**Design-l2 reference:** Section 7 (Auth Flow Detail), FR-007 (User Accounts)

### Description

Implement the frontend auth pages: `/auth/register`, `/auth/login`, `/auth/verify-email`, `/auth/forgot-password` (stub — out of scope for MVP, but route must exist with a "coming soon" message). Implement Google and LinkedIn OAuth button flows. Handle JWT access token storage (in-memory only, never localStorage) and refresh token auto-renewal via the API's cookie mechanism. Implement the auth React context that provides `currentUser`, `login()`, `logout()`, and auto-refresh logic.

### Auth client architecture

- `accessToken`: stored in React state (in-memory only — no localStorage, no sessionStorage). Clears on page reload (intentional — refresh token in HTTP-only cookie handles re-authentication).
- `currentUser`: stored in React context; populated on login or on app load via a silent `POST /api/auth/refresh` call (uses the HTTP-only refresh token cookie if present).
- Auto-refresh: before making any authenticated API call, check if `accessToken` is within 60s of expiry; if so, call `POST /api/auth/refresh` silently.
- On 401 from any API call: attempt one silent refresh; if refresh also returns 401, redirect to `/auth/login`.

### Acceptance criteria

- `/auth/register` form: email, password (min 10 chars), confirm password fields with client-side validation; on submit calls `POST /api/auth/register`; on success shows "Check your email" message.
- `/auth/login` form: email, password; on success stores `accessToken` in React state and redirects to `/` or the originally-requested page.
- "Sign in with Google" button initiates the OAuth flow by navigating to `GET /api/auth/oauth/google`; on callback, the app is redirected back with a new JWT session.
- "Sign in with LinkedIn" button works identically to Google.
- `/auth/verify-email?token=X` page calls `GET /api/auth/verify-email?token=X` on load; shows success or error message.
- After login, the `currentUser` context is populated; the navbar shows the user's `displayName` or email.
- Logout: calls `POST /api/auth/logout` (which revokes all refresh tokens and clears the cookie), then clears `currentUser` from context.
- The `accessToken` is NOT stored in `localStorage` or `sessionStorage` (verified by Playwright test that checks these are empty after login).
- An unauthenticated user visiting `/account/saved-jobs` is redirected to `/auth/login?next=/account/saved-jobs`.

### Implementation notes

- File: `services/frontend/src/app/auth/` — Next.js App Router page components.
- Auth context: `services/frontend/src/contexts/auth-context.tsx`.
- `useAuthenticatedFetch` hook: wraps `fetch` with automatic token refresh and 401 handling.
- On app load (`layout.tsx`): attempt `POST /api/auth/refresh` silently to restore the session from the HTTP-only cookie. On 401, set `currentUser = null`.
- OAuth callback: the backend redirects to `OAUTH_REDIRECT_BASE_URL/auth/callback?accessToken=X` (fragment or query). The frontend page component parses the token and stores it in context.
- Password strength indicator: visual indicator on the register form (e.g. weak/medium/strong based on length and character variety).
- Client-side validation: use `react-hook-form` + Zod resolver for form validation.

### Test requirements

- Unit test: register form with password shorter than 10 chars shows a client-side validation error before submitting.
- Unit test: `AuthContext.login()` stores `accessToken` in React state but NOT in `localStorage`.
- Integration test (Playwright): complete register flow → redirected to login; complete login → redirected to home; navbar shows user email.
- Integration test (Playwright): visit `/account/saved-jobs` when not logged in → redirected to `/auth/login?next=/account/saved-jobs`.
- Integration test: after login, `localStorage` and `sessionStorage` are both empty (no token leak).
- Unit test: auto-refresh hook — when access token is < 60s from expiry, calling `useAuthenticatedFetch` triggers a silent `POST /api/auth/refresh` first.

### Estimated complexity: M

---

## T-033: Implement Google AdSense integration

**Design-l2 reference:** Section 9 (Frontend — Component 9), FR-006 (Revenue and Monetisation)

### Description

Implement asynchronous Google AdSense ad unit loading in the designated placement zones on three page types: search results, job detail, and content articles. AdSense is conditional on `NEXT_PUBLIC_ADSENSE_PUBLISHER_ID` being set. If not set, no ad request is made and the page layout renders without a broken ad container (graceful no-ad mode).

### Ad placement zones

| Page | Zone | Placement |
|------|------|-----------|
| `/jobs` (search results) | `search-sidebar` | Right sidebar, below filters |
| `/jobs/[id]` (job detail) | `job-detail-bottom` | Below job description, above preparation resources |
| `/content/[slug]` (article) | `article-sidebar` | Right sidebar, sticky |

### Acceptance criteria

- When `NEXT_PUBLIC_ADSENSE_PUBLISHER_ID` is set, the AdSense `<script>` tag is loaded asynchronously via `next/script` with `strategy="afterInteractive"` — it does not block rendering of job content.
- An `<ins class="adsbygoogle">` element is rendered in each placement zone; the `data-ad-client` attribute is set to the publisher ID and `data-ad-slot` to the slot ID.
- When `NEXT_PUBLIC_ADSENSE_PUBLISHER_ID` is NOT set: no `<script>` tag is injected and no `<ins>` element is rendered; the page layout has no empty ad container visible to users.
- Clicking the job detail page "Apply" or "View on source" button navigates to the external source URL; the ad does not intercept the click.
- The ad unit does not overlap or displace any search result entries (verified by Playwright visual snapshot test).
- The AdSense `<script>` tag includes `async` and `crossOrigin="anonymous"` attributes (standard AdSense snippet).

### Implementation notes

- File: `services/frontend/src/components/ad-unit.tsx` — reusable `<AdUnit placementId="..." />` component.
- `AdUnit` component:
  ```tsx
  const publisherId = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID;
  if (!publisherId) return null;  // graceful no-ad mode
  return <ins className="adsbygoogle" data-ad-client={publisherId} data-ad-slot={props.slot} style={{ display: 'block' }} />;
  ```
- AdSense script in `services/frontend/src/app/layout.tsx`:
  ```tsx
  {process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID && (
    <Script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
      strategy="afterInteractive"
      async crossOrigin="anonymous"
      data-ad-client={process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID} />
  )}
  ```
- Ad slot IDs are stored in `services/frontend/src/config/adsense.config.ts` as named constants (`SEARCH_SIDEBAR_SLOT`, `JOB_DETAIL_BOTTOM_SLOT`, `ARTICLE_SIDEBAR_SLOT`).

### Test requirements

- Unit test: `<AdUnit />` with `NEXT_PUBLIC_ADSENSE_PUBLISHER_ID=undefined` renders `null` (no DOM node).
- Unit test: `<AdUnit />` with publisher ID set renders an `<ins>` element with `data-ad-client` attribute.
- Integration test (Playwright): with publisher ID unset, confirm no `<ins class="adsbygoogle">` elements in the DOM on the search results page.
- Integration test (Playwright): with publisher ID set, confirm the AdSense script tag has `async` attribute and `strategy="afterInteractive"`.
- Playwright visual snapshot: ad on job detail page does not overlap the job title or "Apply" button.

### Estimated complexity: S

---

## T-034: Frontend performance optimisation and Privacy Policy footer

**Design-l2 reference:** NFR-001 (FCP <2s on 4G, LCP <4s), NFR-005 (Privacy Policy accessible from every page)

### Description

Implement performance optimisations for the SSR pages to ensure Lighthouse FCP < 2000ms on a 4G throttled connection. Implement the `/privacy` page (Privacy Policy) and ensure every page layout includes a footer link to `/privacy`. Set up `lighthouse-ci` as a CI step that fails the build if FCP exceeds 2000ms on the job detail page.

### Acceptance criteria

- Every page rendered by the app includes a `<footer>` element containing an `<a href="/privacy">Privacy Policy</a>` link.
- The `/privacy` page is publicly accessible without authentication; it renders the Privacy Policy text.
- Lighthouse CI test on the job detail page shows FCP < 2000ms and LCP < 4000ms on 4G throttle.
- The Next.js build produces a `.next/` directory with no TypeScript errors.
- Images on the search results page use `next/image` (lazy loading, correct `sizes` attribute).
- Search results page uses `Suspense` boundaries so the initial HTML skeleton loads immediately and job cards stream in.
- Critical CSS is inlined in the HTML `<head>` (Next.js default with Tailwind purge; verify the `<style>` tag is present in the page source).
- HTTP headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300` is set on SSR pages via Next.js route segment config.

### Performance optimisation checklist

- [ ] `next/font` for Google Fonts (prevents render-blocking font fetching).
- [ ] `next/image` for all images with `priority` on above-the-fold images.
- [ ] `Suspense` + React `use()` for data streaming on search results page.
- [ ] Route segment config `export const revalidate = 60` on job detail page for ISR.
- [ ] Tailwind CSS `purge` configured for `services/frontend/**/*.{ts,tsx}`.
- [ ] Bundle analysis via `@next/bundle-analyzer` (run in CI; fail if any route bundle > 250KB).

### Implementation notes

- File: `services/frontend/src/app/privacy/page.tsx` — static page with Privacy Policy text.
- Shared layout: `services/frontend/src/app/layout.tsx` includes the `<Footer>` component.
- `Footer` component: `services/frontend/src/components/footer.tsx` — includes Privacy Policy link and copyright.
- Lighthouse CI config: `.lighthouserc.json` with `assertions: { "first-contentful-paint": ["error", { "maxNumericValue": 2000 }] }`.
- `@next/bundle-analyzer`: `ANALYZE=true bun run build` generates the bundle report; CI step asserts no bundle exceeds 250KB.

### Test requirements

- Integration test (Playwright): navigate to 5 different pages; each page DOM contains `<a href="/privacy">Privacy Policy</a>` in the `<footer>`.
- Integration test: `GET /privacy` returns 200 and the page body contains the text "Privacy Policy".
- Lighthouse CI test (automated): job detail page FCP < 2000ms on simulated 4G; LCP < 4000ms.
- Unit test: `<Footer />` component renders an anchor with `href="/privacy"`.
- CI gate: bundle size for `/jobs` route does not exceed 250KB (fail build if exceeded).

### Estimated complexity: S
