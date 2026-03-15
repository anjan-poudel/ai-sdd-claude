# TG-04: Search and Discovery

> **Jira Epic:** Search and Discovery

## Description

Implements the public-facing Web API: the Express middleware stack, keyword search via ElasticSearch, semantic and hybrid vector search, and saved searches CRUD. Implements the full request/response contracts from design-l2.md Section 9. This is the latency-critical group — search p95 must be under 500ms (NFR-001).

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-020 | Implement Express web API scaffold and middleware stack | M | T-005, T-006, T-009, T-011 | MEDIUM |
| T-021 | Implement keyword search and job detail endpoints | M | T-003, T-020 | MEDIUM |
| T-022 | Implement semantic and hybrid vector search | M | T-018, T-021 | HIGH |
| T-023 | Implement saved searches and search history CRUD | S | T-020, T-002 | LOW |

---

## T-020: Implement Express web API scaffold and middleware stack

**Design-l2 reference:** Section 1.4 (Web API middleware stack order), Section 10.2 (Web API env vars)

### Description

Set up the Express application for the `api` service with the full middleware stack in the exact order specified in design-l2.md Section 1.4. Implement all 11 middleware layers: `X-Trace-ID` propagation, request logger, TLS redirect enforcer, rate limiter, body size limiter, PII input sanitiser, JWT authentication, RBAC, route handler slot, response logger, and error handler. Implement the `ApiResponse<T>` and `ApiErrorResponse` envelope types as the standard response shape for all routes.

### Middleware stack (in order)

1. `X-Trace-ID` — generate UUID v4 if absent; set on `req.traceId`; call `withTraceId(id, next)` from T-006 logger.
2. Request logger — structured JSON: `method`, `path`, `traceId`; mask `Authorization` header value.
3. TLS redirect enforcer — if `req.headers['x-forwarded-proto'] === 'http'` and `NODE_ENV === 'production'`, redirect 301 to HTTPS.
4. Rate limiter — `express-rate-limit` with `API_RATE_LIMIT_REQUESTS` / `API_RATE_LIMIT_WINDOW_MS` per IP; `standardHeaders: true`.
5. Body size limiter — `express.json({ limit: API_MAX_BODY_SIZE_BYTES })`.
6. PII input sanitiser — strip fields: `phone`, `phoneNumber`, `nationalId`, `taxFileNumber`, `dateOfBirth`, `address`, `postcode` from `req.body` before processing.
7. JWT authentication — verify `Authorization: Bearer <jwt>`, set `req.user`; continue on failure (public routes).
8. RBAC — for `/api/admin/*` routes: require `req.user?.role === 'admin'`; perform MongoDB double-check (T-011).
9. Route handlers (mounted here).
10. Response logger — log `status`, `durationMs`; no body content.
11. Error handler — map typed `ApiError` to HTTP status; strip stack traces in production; include `traceId` in response.

### Acceptance criteria

- Every response includes a `traceId` header (`X-Trace-ID`) matching the request or a new UUID.
- A request over HTTP (with `X-Forwarded-Proto: http`) in production returns `HTTP 301` redirect to HTTPS.
- A request that exceeds `API_RATE_LIMIT_REQUESTS` within the window returns `HTTP 429` with `code: "RATE_LIMITED"` and `retryAfterSeconds`.
- A request with `Content-Length` exceeding `API_MAX_BODY_SIZE_BYTES` returns `HTTP 413`.
- A registration request body containing `{ email, password, phone: "0400000000" }` — `phone` is stripped before the handler processes it.
- An unhandled exception in a route handler returns `HTTP 500` with `{ error: { code: "INTERNAL_ERROR", traceId } }` — no stack trace in production.
- `GET /api/health` returns `HTTP 200 { status: "ok", timestamp }` — used as ALB health check target.
- All routes return the `ApiResponse<T>` envelope: `{ data: T, meta?: {...} }` on success.

### Implementation notes

- File: `services/api/src/app.ts` (Express app factory) and `services/api/src/main.ts` (starts the server).
- Use `express-rate-limit` 7.x with an in-process store (no Redis store needed for rate limiting — per-instance rate limiting is acceptable since the API is behind an ALB).
- PII sanitiser: implement as an Express middleware that recursively scans `req.body` for the prohibited field names and deletes them.
- Error handler: use the signature `(err: unknown, req: Request, res: Response, next: NextFunction)` (4-argument Express error handler). Map known `ApiError` types to HTTP status codes from design-l2.md Appendix A.
- Request timeout: use `req.setTimeout(API_REQUEST_TIMEOUT_MS)` and a timeout middleware that returns 503 if exceeded.
- CORS: allow origins from `CORS_ALLOWED_ORIGINS` env var (comma-separated); default to `*` in development.

### Test requirements

- Unit test: PII sanitiser strips `phone` from a nested request body `{ user: { phone: "0400000000", name: "Alice" } }`.
- Integration test: exceed rate limit — 301st request in a 60s window returns 429.
- Integration test: request body of 101KB returns 413.
- Unit test: error handler for `ApiError { code: "UNAUTHORIZED" }` returns 401 with the correct JSON envelope.
- Integration test: `GET /api/health` returns 200.
- Unit test: `withTraceId` from T-006 is called with the `X-Trace-ID` header value on each request.

### Estimated complexity: M

---

## T-021: Implement keyword search and job detail endpoints

**Design-l2 reference:** Section 9.1 (`GET /api/jobs/search`), Section 9.2 (`GET /api/jobs/:id`), Section 3.3 (Search Query Pattern)

### Description

Implement `GET /api/jobs/search` (keyword search with faceted filters and pagination) and `GET /api/jobs/:id` (job detail). The search endpoint builds the ES `bool` query from design-l2.md Section 3.3, applies filters, paginates, and returns facet aggregations. The detail endpoint fetches from MongoDB (not ES) for freshness. Both endpoints must handle ES unavailability gracefully (HTTP 503).

### Search query builder

The ES query for keyword mode:

```json
{
  "query": {
    "bool": {
      "must": [{ "multi_match": { "query": "<<q>>", "fields": ["title^3", "agency^2", "classification^1.5", "descriptionText^1"], "type": "best_fields", "fuzziness": "AUTO:4,8" } }],
      "filter": [
        { "term": { "status": "active" } },
        ...applied filters...
      ]
    }
  },
  "aggs": {
    "governmentLevels": { "terms": { "field": "governmentLevel", "size": 10 } },
    "states": { "terms": { "field": "state", "size": 10 } },
    "classifications": { "terms": { "field": "classification.keyword", "size": 20 } },
    "agencies": { "terms": { "field": "agency.keyword", "size": 20 } }
  },
  "sort": [{ "_score": "desc" }, { "expiryDate": "asc" }],
  "from": (page-1) * pageSize,
  "size": pageSize,
  "track_total_hits": true
}
```

### Acceptance criteria

- `GET /api/jobs/search?q=policy+analyst+canberra` returns results with `title`, `agency`, `location`, `salaryBand`, `expiryDate` for each result and facet buckets in `meta.facets`.
- `GET /api/jobs/search?agencies=ATO,ABS` filters results to only the specified agencies (applies `terms` filter on `agency.keyword`).
- `GET /api/jobs/search?page=2&pageSize=20` returns the correct offset slice (`from: 20`).
- `GET /api/jobs/search?q=` (empty query) returns all active jobs (no `must` clause in bool query; filter-only).
- `GET /api/jobs/search` when ES is unreachable returns `HTTP 503` with `code: "SEARCH_UNAVAILABLE"` and the message "Search is temporarily unavailable. Please try again shortly."
- `GET /api/jobs/:id` fetches from MongoDB (confirmed by test that mocks ES client as unavailable but MongoDB is up — detail still returns 200).
- `GET /api/jobs/:id` for a non-existent ObjectId returns `HTTP 404` with `code: "NOT_FOUND"`.
- `GET /api/jobs/:id` for a malformed `id` (not a 24-char hex string) returns `HTTP 404`.
- The `preparationResources` field on job detail response is populated if `content` documents with `associatedAgencies` matching `job.agency` exist.
- `isSaved: true/false` is returned for authenticated users; always `false` for anonymous.

### Implementation notes

- File: `services/api/src/routes/jobs/search.ts` and `services/api/src/routes/jobs/detail.ts`.
- ES client: use `@opensearch-project/opensearch`. Catch `ConnectionError` and `TimeoutError` and map to `HTTP 503`.
- Query parameters are validated with Zod before processing: `page` min 1 max 100, `pageSize` min 1 max 50, `q` max 500 chars.
- Facet aggregations: always compute the four aggregations (`governmentLevels`, `states`, `classifications`, `agencies`) regardless of applied filters.
- Sort mapping: `"relevance"` → `[{ _score: "desc" }, { expiryDate: "asc" }]`; `"expiry_asc"` → `[{ expiryDate: "asc" }]`; `"created_desc"` → `[{ created_at: "desc" }]`.
- Job detail source: `Job.findById(id).lean()` (MongoDB). Do not call ES for the detail endpoint.
- `preparationResources`: `Content.find({ associatedAgencies: job.agency, status: 'published' }, { title: 1, slug: 1, category: 1, excerpt: 1 }).limit(3)`.
- `isSaved`: if `req.user`, check `SavedJob.exists({ userId: req.user.userId, jobId: id })`.

### Test requirements

- Unit test: `buildEsQuery({ q: "policy analyst", agencies: ["ATO"] })` returns correct ES query JSON with `multi_match` and `terms` filter.
- Unit test: `buildEsQuery({ q: "" })` omits the `must` clause entirely (filter-only query).
- Integration test (mock ES): search returns correct `JobSearchResult[]` shape with facets.
- Integration test: ES client throws `ConnectionError` → `GET /api/jobs/search` returns 503 with `code: "SEARCH_UNAVAILABLE"`.
- Integration test: `GET /api/jobs/:id` with a valid MongoDB ObjectId returns job detail from MongoDB, not ES.
- Integration test: `GET /api/jobs/not-a-valid-id` returns 404.
- Integration test: job detail includes `preparationResources` when matching content exists.

### Estimated complexity: M

---

## T-022: Implement semantic and hybrid vector search

**Design-l2 reference:** Section 8 (Vector Search Integration), Section 8.2 (Semantic Search Query Path), Section 9.1 (`mode` parameter)

### Description

Extend `GET /api/jobs/search` with `mode=semantic` and `mode=hybrid`. For semantic mode: embed the query using the `EmbeddingModel` interface, query the vector DB for top-100 similar job IDs, then enrich with a filtered ES `ids` query. For hybrid: run both keyword and vector search in parallel, merge and re-rank results. Implement the 500ms latency budget enforcement with vector DB fallback to keyword search if `VECTOR_QUERY_TIMEOUT_MS` is exceeded.

### Latency budget

- Query embedding: ≤ 100ms
- Vector DB query: ≤ 100ms (timeout: `VECTOR_QUERY_TIMEOUT_MS` = 3000ms)
- ES enrichment: ≤ 200ms (timeout: `ES_QUERY_TIMEOUT_MS` = 2000ms)
- Overhead: ≤ 100ms
- Total p95: ≤ 500ms

### Acceptance criteria

- `GET /api/jobs/search?q=legal+writing+government&mode=semantic` embeds the query, queries the vector DB for top-100 similar job IDs, and fetches those job documents from ES.
- If the vector DB query exceeds `VECTOR_QUERY_TIMEOUT_MS`, the response falls back to a keyword search and sets `searchMode: "degraded_keyword"` in the response.
- The fallback to keyword search is logged at WARN level with `trace_id`.
- `mode=hybrid`: runs keyword ES query and vector query concurrently (using `Promise.allSettled`); merges results by re-scoring with `0.5 * esScore + 0.5 * vectorScore`; deduplicates by job ID.
- `mode=semantic` with `VECTOR_DB_PROVIDER=mock` (in tests) returns results using the mock adapter without OpenAI API calls.
- Semantic search results respect the same facet filters (`governmentLevels`, `states`, `classifications`, `agencies`) as keyword search.
- The response `searchMode` field accurately reflects the mode actually used: `"keyword"`, `"semantic"`, `"hybrid"`, or `"degraded_keyword"`.

### Implementation notes

- File: `services/api/src/routes/jobs/search.ts` — extend with mode handling.
- EmbeddingModel and VectorDbAdapter instances are initialised once at startup and injected into the route handler via Express app-level middleware (`app.set('embeddingModel', model)`).
- For `mode=semantic`:
  ```typescript
  const vector = await embeddingModel.embed(q);  // timeout: EMBEDDING_REQUEST_TIMEOUT_MS
  const vectorResults = await vectorDb.querySimilar(vector, 100, filter);
  const jobIds = vectorResults.map(r => r.jobId);
  const esResults = await esClient.search({ index: 'jobs', body: { query: { ids: { values: jobIds } }, ... } });
  ```
- For hybrid: `const [esRes, vectorRes] = await Promise.allSettled([keywordSearch(), vectorSearch()])`.
- Fallback: wrap vector DB call with `Promise.race([vectorDb.querySimilar(...), sleep(VECTOR_QUERY_TIMEOUT_MS).then(() => { throw new Error('timeout') })])`.
- `VectorFilter` from design-l2.md Section 1.7 maps query params: `{ status: 'active', classification, location }`.

### Test requirements

- Unit test: `mode=semantic` path calls `embeddingModel.embed()` once and `vectorDb.querySimilar()` once.
- Unit test: vector DB timeout causes fallback to keyword search and sets `searchMode: "degraded_keyword"`.
- Unit test: hybrid merge correctly deduplicates when a job appears in both keyword and vector results.
- Integration test with mock embedding and mock vector adapter: `mode=semantic` returns results whose IDs match what the mock adapter returns.
- Unit test: `mode=semantic` with `q=""` (empty) returns empty results immediately without calling the embedding model.
- Integration test: `mode=semantic` when `VECTOR_DB_PROVIDER=mock` completes within 50ms (no real network calls).

### Estimated complexity: M

---

## T-023: Implement saved searches and search history CRUD

**Design-l2 reference:** Section 2.6 (`saved_searches` collection), Section 9 (user endpoints)

### Description

Implement the saved searches API: `GET /api/users/me/saved-searches`, `POST /api/users/me/saved-searches`, `DELETE /api/users/me/saved-searches/:id`. Enforce the per-user limit of `SAVED_SEARCHES_PER_USER` (default 20). Also implement in-session search history tracking: store the last 10 search queries in the user's session (stored in MongoDB `users.searchHistory` or a separate short-lived Redis key per user).

### Acceptance criteria

- `POST /api/users/me/saved-searches` with a valid `SavedSearchDocument` creates a new saved search and returns `HTTP 201` with the created document.
- `GET /api/users/me/saved-searches` returns the user's saved searches sorted by `created_at` descending.
- `DELETE /api/users/me/saved-searches/:id` deletes the search if it belongs to the authenticated user; returns 404 if not found or not owned.
- Creating a 21st saved search returns `HTTP 422` with a message "Maximum saved searches limit (20) reached."
- `POST /api/users/me/saved-searches` requires at least one non-empty criterion in `criteria` (Zod validation); an empty `SearchCriteriaInput` returns 422.
- Search history: each `GET /api/jobs/search` request by an authenticated user appends the query and filters to a Redis key `search-history:${userId}` (TTL 30 days); the list is capped at 10 most recent entries.
- `GET /api/users/me/search-history` returns the last 10 searches in reverse chronological order.

### Implementation notes

- File: `services/api/src/routes/users/saved-searches.ts` and `services/api/src/routes/users/search-history.ts`.
- Saved searches limit: check count before insert: `const count = await SavedSearch.countDocuments({ userId })`. If `count >= SAVED_SEARCHES_PER_USER`, return 422.
- `SavedSearchDocument.criteria` validated by Zod: at least one of `query`, `agencies`, `classifications`, `locations`, `governmentLevels`, `states` must be non-empty or non-null.
- Search history: stored as a Redis list `search-history:${userId}`. `LPUSH` on each search, `LTRIM` to keep only 10 entries, `EXPIRE` to 30 days.
- `GET /api/users/me/search-history`: `LRANGE search-history:${userId} 0 9` returns 10 most recent (LPUSH means newest is at index 0).
- History items are NOT stored for anonymous users.

### Test requirements

- Integration test: create 20 saved searches, attempt 21st — returns 422.
- Integration test: `DELETE /api/users/me/saved-searches/:id` by a different user returns 404.
- Unit test: `SearchCriteriaInput` with all empty arrays and null query fails Zod validation.
- Integration test: `GET /api/jobs/search?q=test` by an authenticated user — query `"test"` appears in `GET /api/users/me/search-history`.
- Integration test: 11th search pushes the 1st one out of the history (cap at 10).

### Estimated complexity: S
