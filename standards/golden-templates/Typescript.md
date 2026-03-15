# 🏆 Golden Template: TypeScript · Event-Driven Microservices · Resiliency-First

> **Purpose:** Authoritative engineering standard for AI agents and LLMs generating TypeScript code in this stack.
> Every pattern, snippet, and rule targets Distinguished Engineer–level quality.
> **Immutable law:** When guidelines conflict with convenience, guidelines win.
> **Scope:** Technology-agnostic at the infrastructure layer — patterns apply whether
> you use Kafka, RabbitMQ, AWS SQS, or GCP Pub/Sub; PostgreSQL, MongoDB, or DynamoDB.
> **TypeScript-first:** No JavaScript idioms ported to TypeScript. If `any` appears,
> it is wrong. If the type system is being fought rather than used, the design is wrong.

---

## Table of Contents

1. [Immutable Principles](#1-immutable-principles)
2. [TypeScript Language Standards](#2-typescript-language-standards)
3. [Architecture Boundaries](#3-architecture-boundaries)
4. [Project Structure — Hexagonal Architecture](#4-project-structure--hexagonal-architecture)
5. [Async Patterns — The Concurrency Model](#5-async-patterns--the-concurrency-model)
6. [Resiliency Patterns — First-Class Citizen](#6-resiliency-patterns--first-class-citizen)
7. [Domain Modeling Standards](#7-domain-modeling-standards)
8. [Event-Driven Architecture Patterns](#8-event-driven-architecture-patterns)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Observability & Operability](#10-observability--operability)
11. [Testing Standards](#11-testing-standards)
12. [Security Standards](#12-security-standards)
13. [API Design Standards](#13-api-design-standards)
14. [Configuration Management](#14-configuration-management)
15. [Build & Dependency Standards](#15-build--dependency-standards)
16. [Anti-Patterns — Forbidden List](#16-anti-patterns--forbidden-list)
17. [PR Checklist](#17-pr-checklist)

---

## 1. Immutable Principles

These are architectural axioms. No exception, no override, no "just this once."

| ID  | Principle                              | Rule                                                                                        |
|-----|----------------------------------------|---------------------------------------------------------------------------------------------|
| P01 | **TypeScript-strict, always**          | `strict: true` in tsconfig. Zero `any`. Zero `as unknown as X` escape hatches              |
| P02 | **Type the domain, not the framework** | Domain types are pure TypeScript — no framework decorators inside domain layer              |
| P03 | **Explicit over implicit**             | Every timeout, retry, queue bound, and dispatcher is declared — no runtime surprises        |
| P04 | **Immutability first**                 | `readonly` on all domain types. `as const` for literals. Mutation is an explicit operation  |
| P05 | **Fail fast, recover gracefully**      | Every external call has an explicit timeout, circuit breaker, and fallback                  |
| P06 | **Idempotency by default**             | Every command handler and event consumer is safe to replay                                  |
| P07 | **No unhandled Promise rejections**    | Every Promise chain has `.catch()`. Every `async` function has try/catch at the boundary    |
| P08 | **Errors are values**                  | Use `Result<T, E>` for expected failures. Reserve `throw` for programmer errors             |
| P09 | **Secrets never in code**              | No hardcoded credentials, tokens, or keys anywhere in the codebase                         |
| P10 | **Service owns its data**              | No cross-service database access; data shared only via events or APIs                       |
| P11 | **Events are versioned contracts**     | Schema-versioned, backward-compatible, documented, never silently changed                   |
| P12 | **Test behaviour, not mocks**          | Integration tests exercise real infrastructure (Testcontainers) wherever feasible           |
| P13 | **Observability is not optional**      | Every service ships metrics, traces, and structured logs from day one                       |
| P14 | **Graceful degradation > hard fail**   | A degraded response is almost always better than an unhandled exception                     |

---

## 2. TypeScript Language Standards

### 2.1 tsconfig — Non-Negotiable Compiler Settings

```json
// tsconfig.json — base settings every service inherits
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    // ── Strict mode — all of these must be true ──────────────────────────────
    "strict": true,                        // Enables all below
    "noImplicitAny": true,                 // No inferred any
    "strictNullChecks": true,              // null/undefined are distinct types
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,

    // ── Additional quality gates ──────────────────────────────────────────────
    "noUnusedLocals": true,                // Unused vars are errors
    "noUnusedParameters": true,            // Unused params are errors
    "noImplicitReturns": true,             // All code paths must return
    "noFallthroughCasesInSwitch": true,    // switch fall-through is a bug
    "exactOptionalPropertyTypes": true,    // undefined !== absent
    "noUncheckedIndexedAccess": true,      // array[i] returns T | undefined
    "noPropertyAccessFromIndexSignature": true,

    // ── Path aliases ──────────────────────────────────────────────────────────
    "paths": {
      "@domain/*": ["src/domain/*"],
      "@application/*": ["src/application/*"],
      "@infrastructure/*": ["src/infrastructure/*"],
      "@api/*": ["src/api/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

### 2.2 `any` — Absolutely Forbidden

```typescript
// ❌ FORBIDDEN — any defeats the entire type system
function process(data: any): any { ... }
const result = JSON.parse(response) as any;
const value = (obj as any).deepProperty;

// ✅ REQUIRED — use unknown for external/untyped data
function process(data: unknown): ProcessResult {
  // Narrow before use
  if (!isOrderPayload(data)) {
    throw new ValidationError('Invalid order payload');
  }
  return processOrder(data); // data is OrderPayload here
}

// ✅ Parse external data at the boundary — use a validation library
import { z } from 'zod';

const OrderPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  totalAmount: z.number().positive(),
  currency: z.string().length(3),
  createdAt: z.string().datetime(),
});

type OrderPayload = z.infer<typeof OrderPayloadSchema>;

function parseOrderPayload(raw: unknown): OrderPayload {
  return OrderPayloadSchema.parse(raw); // throws ZodError with full context on failure
}

// ✅ Type guards — explicit narrowing
function isOrderPayload(value: unknown): value is OrderPayload {
  return OrderPayloadSchema.safeParse(value).success;
}
```

### 2.3 Branded Types — Type Safety Over Primitive Obsession

```typescript
// ❌ WRONG — primitives are interchangeable, compiler can't help
function createOrder(customerId: string, productId: string): Order { ... }
createOrder(productId, customerId); // Compiler accepts this bug!

// ✅ REQUIRED — branded types make argument swaps a compile error
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

type OrderId   = Brand<string, 'OrderId'>;
type CustomerId = Brand<string, 'CustomerId'>;
type ProductId = Brand<string, 'ProductId'>;
type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

// Factory functions with validation
const OrderId = {
  generate: (): OrderId => crypto.randomUUID() as OrderId,
  of: (value: string): OrderId => {
    if (!value || value.trim().length === 0) {
      throw new Error('OrderId must not be blank');
    }
    return value as OrderId;
  },
};

const CustomerId = {
  of: (value: string): CustomerId => {
    if (!value || value.trim().length === 0) {
      throw new Error('CustomerId must not be blank');
    }
    return value as CustomerId;
  },
};

// ✅ Now the compiler catches argument swaps
function createOrder(customerId: CustomerId, productId: ProductId): Order { ... }
createOrder(productId, customerId); // ← Type error: Argument of type 'ProductId' is not assignable to 'CustomerId'

// ✅ Branded Money type
type CurrencyCode = Brand<string, 'CurrencyCode'>;

interface Money {
  readonly amount: bigint;        // Use bigint for monetary amounts — no float precision bugs
  readonly currency: CurrencyCode;
}

const Money = {
  of: (amount: bigint, currency: CurrencyCode): Money => {
    if (amount < 0n) throw new Error(`Money amount cannot be negative: ${amount}`);
    return { amount, currency } as const;
  },
  add: (a: Money, b: Money): Money => {
    if (a.currency !== b.currency) {
      throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
    }
    return Money.of(a.amount + b.amount, a.currency);
  },
  zero: (currency: CurrencyCode): Money => Money.of(0n, currency),
  toCents: (m: Money): bigint => m.amount,
};
```

### 2.4 Discriminated Unions — Exhaustive Domain Modeling

```typescript
// ✅ Discriminated unions — model ALL outcomes, force exhaustive handling
// Use a literal 'type' discriminant field (not 'kind' or '_tag' — be consistent)

type OrderResult =
  | { readonly type: 'Created';              readonly order: Order }
  | { readonly type: 'AlreadyExists';        readonly orderId: OrderId; readonly originalCreatedAt: Date }
  | { readonly type: 'Rejected';             readonly reason: string; readonly orderId: OrderId }
  | { readonly type: 'InsufficientInventory'; readonly productId: ProductId; readonly requested: number; readonly available: number };

// ✅ Exhaustive switch — TypeScript narrows to 'never' if a case is missing
function handleOrderResult(result: OrderResult): Response {
  switch (result.type) {
    case 'Created':
      return Response.created(toOrderResponse(result.order));
    case 'AlreadyExists':
      return Response.conflict(`Already created at ${result.originalCreatedAt.toISOString()}`);
    case 'Rejected':
      return Response.unprocessable(result.reason);
    case 'InsufficientInventory':
      return Response.unprocessable(
        `Only ${result.available} of ${result.requested} available for product ${result.productId}`,
      );
    default:
      return assertNever(result); // ← Compile error if a case above is missing
  }
}

// ✅ assertNever — compile-time exhaustiveness guard
function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union case: ${JSON.stringify(value)}`);
}

// ✅ Event processing outcomes — same pattern
type EventProcessingResult =
  | { readonly type: 'Processed'; readonly eventId: string; readonly durationMs: number }
  | { readonly type: 'Skipped';   readonly eventId: string; readonly reason: string }
  | { readonly type: 'Failed';    readonly eventId: string; readonly errorCode: string; readonly retryable: boolean };
```

### 2.5 `readonly` — Immutability Everywhere

```typescript
// ✅ ALL domain objects are readonly — mutation is a compile error
interface Order {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly status: OrderStatus;
  readonly lines: ReadonlyArray<OrderLine>;
  readonly totalAmount: Money;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

// ✅ Readonly on function parameters — signal intent to callers
function calculateDiscount(order: Readonly<Order>, customer: Readonly<Customer>): Money {
  // Cannot accidentally mutate order or customer
}

// ✅ ReadonlyMap, ReadonlySet for collections
const statusLabels: ReadonlyMap<OrderStatus, string> = new Map([
  ['PENDING', 'Awaiting confirmation'],
  ['CONFIRMED', 'Confirmed'],
  ['FULFILLED', 'Fulfilled'],
]);

// ✅ as const for literal objects — deepens to readonly recursively
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNPROCESSABLE: 422,
  SERVICE_UNAVAILABLE: 503,
} as const;

type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS]; // 200 | 201 | 400 | 422 | 503

// ✅ Produce updated copies — never mutate
function confirmOrder(order: Order): Order {
  if (order.status !== 'PENDING') {
    throw new InvalidOrderStateError(order.id, order.status, 'confirm');
  }
  return {
    ...order,
    status: 'CONFIRMED',
    updatedAt: new Date(),
    version: order.version + 1,
  };
}
```

### 2.6 Utility Types — Use the Type System Fully

```typescript
// ✅ Leverage built-in utility types for transformations
type CreateOrderRequest = Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'status'>;
type OrderSummary = Pick<Order, 'id' | 'status' | 'totalAmount' | 'createdAt'>;
type PartialOrderUpdate = Partial<Pick<Order, 'status' | 'updatedAt'>>;

// ✅ Template literal types for event names — typo-proof at compile time
type AggregateType = 'Order' | 'Payment' | 'Customer';
type EventVerb = 'Created' | 'Updated' | 'Cancelled' | 'Fulfilled';
type EventName = `${AggregateType}${EventVerb}`;

// ✅ Mapped types for transformations
type ApiResponse<T> = {
  readonly [K in keyof T]: T[K] extends Date ? string : T[K];
};

// ✅ Conditional types for type-level logic
type NonNullableRecord<T> = {
  [K in keyof T]-?: NonNullable<T[K]>;
};

type IsArray<T> = T extends ReadonlyArray<infer _> ? true : false;

// ✅ Discriminated union exhaustion with Extract/Exclude
type PendingOrConfirmed = Extract<OrderResult, { type: 'Created' | 'AlreadyExists' }>;
type FailedResults = Exclude<OrderResult, { type: 'Created' }>;
```

### 2.7 Async/Await — Correct Patterns

```typescript
// ✅ Always use async/await over raw .then/.catch chains
// Exception: when composing Promises at the application boundary

// ❌ WRONG — pyramid of doom with callbacks / .then
function fetchOrder(orderId: OrderId) {
  return orderRepository.findById(orderId)
    .then(order => {
      if (!order) throw new Error('not found');
      return customerService.getProfile(order.customerId)
        .then(customer => ({ order, customer }));
    });
}

// ✅ CORRECT — flat, readable async/await
async function fetchOrder(orderId: OrderId): Promise<EnrichedOrder> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new OrderNotFoundError(orderId);

  const customer = await customerService.getProfile(order.customerId);
  return { order, customer };
}

// ✅ Parallel fetches — Promise.all (not sequential awaits)
// ❌ WRONG — sequential: total time = A + B + C
const order    = await orderRepository.findById(orderId);
const customer = await customerService.getProfile(order.customerId);
const products = await productService.getProducts(order.lines);

// ✅ CORRECT — parallel: total time = max(A, B, C)
const [order, customer, products] = await Promise.all([
  orderRepository.findById(orderId),
  customerService.getProfile(orderId),
  productService.getProductsForOrder(orderId),
]);

// ✅ Promise.allSettled — partial results, independent failure handling
const results = await Promise.allSettled([
  inventoryService.check(productId),   // Optional — degrade if unavailable
  pricingService.getPrice(productId),  // Optional — degrade if unavailable
]);

const inventory = results[0].status === 'fulfilled'
  ? results[0].value
  : InventoryStatus.Unknown;

const pricing = results[1].status === 'fulfilled'
  ? results[1].value
  : PricingResult.defaultFor(productId);
```

---

## 3. Architecture Boundaries

### 3.1 Microservice Scope Rules

```
ONE microservice owns:
  ✅ One bounded context
  ✅ One primary aggregate root (e.g., Order, Customer, Payment)
  ✅ Its own database — never shared
  ✅ Its own deployment lifecycle and version

ONE microservice must NOT:
  ❌ Make synchronous calls to >2 downstream services per request
  ❌ Own business logic for another bounded context
  ❌ Access another service's database directly
  ❌ Have a single point of failure in its critical path
```

### 3.2 Communication Decision Matrix

```
Use SYNCHRONOUS (HTTP/gRPC) when:
  ✅ Response required immediately to fulfil the caller's request
  ✅ Operation is a query (read-only)
  ✅ SLA coupling is acceptable

Use ASYNCHRONOUS (Events/Messages) when:
  ✅ Caller does not need the result immediately
  ✅ Multiple consumers need the same information
  ✅ Cross-service workflows (sagas)
  ✅ The operation is a state change

NEVER:
  ❌ Synchronous call chain deeper than 2 hops
  ❌ Fire-and-forget without delivery guarantee (use Outbox)
  ❌ Distributed transactions — use Saga or Outbox
```

---

## 4. Project Structure — Hexagonal Architecture

### 4.1 Module Layout

```
src/
├── api/                          # Public contracts — shared with consumers
│   ├── command/                  # Inbound command types (interfaces, zod schemas)
│   ├── query/                    # Inbound query types
│   ├── response/                 # Outbound response types
│   └── event/                    # Domain event schemas (versioned)
│
├── domain/                       # Pure business logic — ZERO framework deps
│   ├── model/                    # Aggregates, entities, value objects (pure TypeScript)
│   ├── service/                  # Domain services (pure functions)
│   ├── event/                    # Internal domain events
│   └── port/
│       ├── inbound/              # Use-case interfaces
│       └── outbound/             # Repository / publisher interfaces
│
├── application/                  # Orchestrates domain + ports
│   ├── usecase/                  # One file per use case
│   └── saga/                     # Saga orchestrators (if used)
│
├── infrastructure/               # Technical adapters
│   ├── persistence/              # DB repositories, entities, mappers
│   ├── messaging/                # Publishers, subscribers, serializers
│   ├── http/                     # Outbound HTTP clients
│   ├── cache/                    # Cache adapters
│   └── config/                   # DI container / framework config
│
└── bootstrap/                    # Entry point — wiring only
    └── index.ts
```

### 4.2 Dependency Rules

```
domain        → imports only from node stdlib and utility libs (zod, date-fns)
application   → imports from domain only
infrastructure → imports from application + domain + frameworks
bootstrap     → imports from all layers (wires everything)

NO import from domain into infrastructure types.
Enforced via ESLint import/no-restricted-paths rules.
```

### 4.3 ESLint Architecture Enforcement

```javascript
// .eslintrc.js — enforce hexagonal architecture at lint time
module.exports = {
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        {
          // Domain must not import from infrastructure
          target: './src/domain',
          from: './src/infrastructure',
          message: 'Domain layer must not import from infrastructure',
        },
        {
          // Domain must not import from application
          target: './src/domain',
          from: './src/application',
          message: 'Domain layer must not import from application',
        },
        {
          // Application must not import from infrastructure
          target: './src/application',
          from: './src/infrastructure',
          message: 'Application layer must not import from infrastructure — use ports',
        },
      ],
    }],
  },
};
```

---

## 5. Async Patterns — The Concurrency Model

### 5.1 Core Rules

```
RULE 1: Every Promise must be awaited or have .catch() — no floating Promises.
RULE 2: Never use Promise constructor (new Promise) when async/await suffices.
RULE 3: Always set a finite timeout on external calls.
RULE 4: Use AbortController for cancellable operations.
RULE 5: Backpressure must be explicit — never let queues grow unbounded.
RULE 6: setInterval/setTimeout in production services must be clearable on shutdown.
RULE 7: EventEmitters must remove listeners on service teardown.
```

### 5.2 AbortController — Cancellable Operations

```typescript
// ✅ AbortController — cancellable fetch and timeout
async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status} from ${url}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ✅ Composable timeout — wraps any Promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );
  return Promise.race([promise, timeout]);
}

// Usage:
const result = await withTimeout(
  inventoryService.check(productId),
  2_000,
  'inventory check',
);
```

### 5.3 Concurrency Limiting

```typescript
// ✅ Semaphore — limit concurrent operations without blocking the event loop
class Semaphore {
  private readonly waiting: Array<() => void> = [];
  private current = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    await new Promise<void>(resolve => this.waiting.push(resolve));
    this.current++;
  }

  release(): void {
    this.current--;
    const next = this.waiting.shift();
    if (next) next();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

// ✅ Bounded parallel processing
async function processBatch<T, R>(
  items: ReadonlyArray<T>,
  processor: (item: T) => Promise<R>,
  maxConcurrent: number,
): Promise<R[]> {
  const semaphore = new Semaphore(maxConcurrent);
  return Promise.all(
    items.map(item => semaphore.run(() => processor(item))),
  );
}

// Usage: process 100 orders, max 10 at a time
const results = await processBatch(orders, processOrder, 10);
```

### 5.4 Async Iteration — Streaming Large Datasets

```typescript
// ✅ AsyncGenerator for streaming — backpressure built-in
async function* streamPendingOrders(since: Date): AsyncGenerator<Order> {
  let page = 0;
  const pageSize = 100;

  while (true) {
    const orders = await orderRepository.findPendingPage(since, page, pageSize);
    for (const order of orders) {
      yield order;
    }
    if (orders.length < pageSize) break;
    page++;
  }
}

// ✅ Consumer — processes one at a time, backpressure respected
for await (const order of streamPendingOrders(since)) {
  await processOrder(order);
  // Next page only fetched when this loop body completes
}

// ✅ Transform pipeline with async generators
async function* filterHighValue(
  orders: AsyncIterable<Order>,
  threshold: Money,
): AsyncGenerator<Order> {
  for await (const order of orders) {
    if (order.totalAmount.amount > threshold.amount) {
      yield order;
    }
  }
}

async function* enrichOrders(
  orders: AsyncIterable<Order>,
): AsyncGenerator<EnrichedOrder> {
  for await (const order of orders) {
    const customer = await customerService.getProfile(order.customerId);
    yield { ...order, customer };
  }
}

// ✅ Composed pipeline
const pipeline = enrichOrders(
  filterHighValue(
    streamPendingOrders(since),
    Money.of(50000n, 'USD' as CurrencyCode),
  ),
);

for await (const enrichedOrder of pipeline) {
  await notifyHighValueOrder(enrichedOrder);
}
```

### 5.5 Graceful Shutdown

```typescript
// ✅ Graceful shutdown — drain in-flight work before process exit
class GracefulShutdown {
  private readonly shutdownCallbacks: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  register(name: string, callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(async () => {
      logger.info('Shutting down component', { component: name });
      await callback();
    });
  }

  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Graceful shutdown initiated', { signal });

    // Run all shutdown callbacks in parallel with a hard deadline
    await withTimeout(
      Promise.all(this.shutdownCallbacks.map(cb => cb())),
      30_000,
      'graceful shutdown',
    ).catch(err => {
      logger.error('Graceful shutdown timed out', { error: err });
    });

    logger.info('Graceful shutdown complete');
  }

  install(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM').then(() => process.exit(0)));
    process.on('SIGINT',  () => this.shutdown('SIGINT').then(() => process.exit(0)));
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Promise rejection', { reason });
      // In production: alert, then graceful shutdown
      this.shutdown('unhandledRejection').then(() => process.exit(1));
    });
  }
}

// ✅ Bootstrap usage
const shutdown = new GracefulShutdown();
shutdown.register('http-server',    () => httpServer.close());
shutdown.register('message-broker', () => broker.disconnect());
shutdown.register('db-pool',        () => dbPool.end());
shutdown.register('outbox-poller',  () => outboxPoller.stop());
shutdown.install();
```

---

## 6. Resiliency Patterns — First-Class Citizen

### 6.1 The Resiliency Stack

```
Every outbound call MUST be wrapped in this stack — no exceptions:

 ┌─────────────────────────────────────────────────┐
 │  1. RateLimiter  (protect external SLAs)        │
 │  2. CircuitBreaker (stop calling failing deps)  │
 │  3. Retry  (handle transient failures)          │
 │  4. Bulkhead  (isolate failure domains)         │
 │  5. Timeout  (bound worst-case latency)         │
 └─────────────────────────────────────────────────┘
         ↓
   External Service / DB / Queue

RULE: Inner timeout < Outer timeout (always leave headroom)
RULE: Retry count × maxWait < Circuit breaker evaluation window
RULE: All resiliency config is named, externalized, never hardcoded
RULE: Every fallback logs a WARN + records a metric
```

### 6.2 Circuit Breaker Implementation

```typescript
// ✅ Circuit breaker — state machine with metrics
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  readonly name: string;
  readonly failureThreshold: number;       // failures before opening
  readonly successThreshold: number;       // successes in HALF_OPEN before closing
  readonly openDurationMs: number;         // how long to stay OPEN
  readonly slidingWindowSize: number;      // number of calls to track
  readonly timeoutMs: number;              // per-call timeout
  readonly isRetryable: (error: unknown) => boolean;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private readonly recentCalls: Array<'success' | 'failure'> = [];

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly metrics: MetricsClient,
  ) {}

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: (error: unknown) => T | Promise<T>,
  ): Promise<T> {
    this.transitionIfDue();

    if (this.state === 'OPEN') {
      this.metrics.increment('circuit_breaker.rejected', { name: this.options.name });
      if (fallback) return fallback(new CircuitOpenError(this.options.name));
      throw new CircuitOpenError(this.options.name);
    }

    try {
      const result = await withTimeout(
        operation(),
        this.options.timeoutMs,
        `${this.options.name} circuit breaker`,
      );
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallback) return fallback(error);
      throw error;
    }
  }

  private onSuccess(): void {
    this.recordCall('success');
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.transition('CLOSED');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(error: unknown): void {
    if (!this.options.isRetryable(error)) return; // Don't count business errors
    this.recordCall('failure');
    this.lastFailureTime = Date.now();
    this.failureCount++;

    const recentFailureRate = this.getRecentFailureRate();
    if (recentFailureRate >= this.options.failureThreshold / 100) {
      this.transition('OPEN');
    }
  }

  private transitionIfDue(): void {
    if (
      this.state === 'OPEN' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.options.openDurationMs
    ) {
      this.transition('HALF_OPEN');
    }
  }

  private transition(newState: CircuitState): void {
    const prev = this.state;
    this.state = newState;
    this.failureCount = 0;
    this.successCount = 0;
    this.metrics.increment('circuit_breaker.state_transition', {
      name: this.options.name,
      from: prev,
      to: newState,
    });
    logger.warn('Circuit breaker state transition', {
      name: this.options.name,
      from: prev,
      to: newState,
    });
  }

  private recordCall(outcome: 'success' | 'failure'): void {
    this.recentCalls.push(outcome);
    if (this.recentCalls.length > this.options.slidingWindowSize) {
      this.recentCalls.shift();
    }
  }

  private getRecentFailureRate(): number {
    if (this.recentCalls.length < this.options.slidingWindowSize / 2) return 0;
    const failures = this.recentCalls.filter(c => c === 'failure').length;
    return failures / this.recentCalls.length;
  }

  getState(): CircuitState { return this.state; }
}
```

### 6.3 Retry with Exponential Backoff + Jitter

```typescript
// ✅ Retry — exponential backoff with jitter to prevent thundering herd
interface RetryOptions {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitterFactor: number;          // 0.0 – 1.0, adds randomness
  readonly isRetryable: (error: unknown) => boolean;
  readonly onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!options.isRetryable(error) || attempt === options.maxAttempts) {
        throw error;
      }

      const baseDelay = Math.min(
        options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
        options.maxDelayMs,
      );
      // Full jitter: [0, baseDelay * jitterFactor]
      const jitter = baseDelay * options.jitterFactor * Math.random();
      const delayMs = Math.round(baseDelay + jitter);

      options.onRetry?.(attempt, error, delayMs);
      logger.warn('Retrying operation', {
        operation: operationName,
        attempt,
        maxAttempts: options.maxAttempts,
        delayMs,
        error: errorMessage(error),
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

// ✅ Retry predicate — only retry transient failures
function isTransientError(error: unknown): boolean {
  if (error instanceof DomainError) return false;      // Never retry business errors
  if (error instanceof ValidationError) return false;  // Never retry client errors
  if (error instanceof TimeoutError) return true;
  if (error instanceof NetworkError) return true;
  if (error instanceof HttpError) return error.status >= 500 && error.status !== 501;
  return false;
}

// ✅ Composing the full resiliency stack
class InventoryAdapter implements InventoryPort {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly semaphore: Semaphore;

  constructor(
    private readonly client: InventoryHttpClient,
    private readonly metrics: MetricsClient,
  ) {
    this.circuitBreaker = new CircuitBreaker({
      name: 'inventory-service',
      failureThreshold: 50,
      successThreshold: 3,
      openDurationMs: 30_000,
      slidingWindowSize: 20,
      timeoutMs: 2_000,
      isRetryable: isTransientError,
    }, metrics);

    this.semaphore = new Semaphore(25); // max concurrent calls
  }

  async checkInventory(productId: ProductId): Promise<InventoryStatus> {
    return this.circuitBreaker.execute(
      () => this.semaphore.run(
        () => withRetry(
          () => this.client.check(productId),
          {
            maxAttempts: 3,
            initialDelayMs: 300,
            maxDelayMs: 5_000,
            backoffMultiplier: 2,
            jitterFactor: 0.3,
            isRetryable: isTransientError,
          },
          'inventory.check',
        ),
      ),
      // Fallback — never fake "available", always return UNKNOWN
      (error) => {
        this.metrics.increment('inventory.fallback', { reason: errorCode(error) });
        logger.warn('Inventory service degraded, returning UNKNOWN', {
          productId,
          error: errorMessage(error),
        });
        return InventoryStatus.Unknown;
      },
    );
  }
}
```

### 6.4 Idempotency — Universal Pattern

```typescript
// ✅ Idempotency store interface — pluggable backend
interface IdempotencyStore {
  isAlreadyProcessed(key: string): Promise<boolean>;
  markProcessed(key: string, ttlMs: number): Promise<void>;
  getStoredResult<T>(key: string): Promise<T | null>;
  markProcessedWithResult<T>(key: string, result: T, ttlMs: number): Promise<void>;
}

// ✅ Every mutating command carries an idempotency key
interface IdempotentCommand {
  readonly idempotencyKey: IdempotencyKey;
  readonly serviceId: string;
  readonly operationName: string;
  readonly idempotencyTtlMs?: number;     // Default: 24h
}

// ✅ Idempotency wrapper — wraps any async handler
async function executeIdempotent<C extends IdempotentCommand, R>(
  command: C,
  store: IdempotencyStore,
  handler: (command: C) => Promise<R>,
): Promise<R> {
  const key = `${command.serviceId}:${command.operationName}:${command.idempotencyKey}`;
  const ttlMs = command.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;

  const stored = await store.getStoredResult<R>(key);
  if (stored !== null) {
    logger.info('Idempotent replay — returning stored result', { key });
    return stored;
  }

  const result = await handler(command);
  await store.markProcessedWithResult(key, result, ttlMs);
  return result;
}

// ✅ Usage in application layer
class CreateOrderUseCase {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly eventPublisher: DomainEventPublisher,
    private readonly idempotencyStore: IdempotencyStore,
  ) {}

  async execute(command: CreateOrderCommand): Promise<OrderResult> {
    return executeIdempotent(command, this.idempotencyStore, async (cmd) => {
      const order = createOrder(cmd);
      await this.orderRepository.save(order);
      await this.eventPublisher.publish(toOrderCreatedEvent(order));
      return { type: 'Created' as const, order };
    });
  }
}
```

---

## 7. Domain Modeling Standards

### 7.1 Pure Domain Functions — No Classes Required

```typescript
// ✅ Domain logic as pure functions — no OOP overhead needed
// Functions over classes when there is no shared mutable state

// Order creation — factory function
function createOrder(command: CreateOrderCommand): Order {
  if (command.lines.length === 0) {
    throw new ValidationError('Order must have at least one line');
  }
  if (command.lines.length > 100) {
    throw new ValidationError('Order cannot exceed 100 lines');
  }

  const lines = command.lines.map(createOrderLine);
  const totalAmount = lines.reduce(
    (sum, line) => Money.add(sum, line.lineTotal),
    Money.zero('USD' as CurrencyCode),
  );

  return {
    id: OrderId.generate(),
    customerId: command.customerId,
    status: 'PENDING',
    lines,
    totalAmount,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 0,
  };
}

// State transitions — return new state, never mutate
function confirmOrder(order: Order): Order {
  if (order.status !== 'PENDING') {
    throw new InvalidOrderStateError(order.id, order.status, 'confirm');
  }
  return {
    ...order,
    status: 'CONFIRMED',
    updatedAt: new Date(),
    version: order.version + 1,
  };
}

function cancelOrder(order: Order, reason: CancellationReason): Order {
  const nonCancellableStatuses: ReadonlyArray<OrderStatus> = ['FULFILLED', 'SHIPPED'];
  if (nonCancellableStatuses.includes(order.status)) {
    throw new InvalidOrderStateError(order.id, order.status, 'cancel');
  }
  return {
    ...order,
    status: 'CANCELLED',
    cancellationReason: reason,
    updatedAt: new Date(),
    version: order.version + 1,
  };
}

// ✅ Business rules as named predicate functions
const isEligibleForDiscount = (order: Order, customer: Customer): boolean =>
  order.status === 'CONFIRMED' &&
  order.totalAmount.amount > 100_00n &&
  customer.tier === 'PREMIUM';

const isHighValueOrder = (order: Order): boolean =>
  order.totalAmount.amount > 1_000_00n;
```

### 7.2 Domain Types

```typescript
// ✅ Complete domain type definitions — exhaustive, documented
type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'FULFILLED' | 'CANCELLED';

interface OrderLine {
  readonly productId: ProductId;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
}

interface Order {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly status: OrderStatus;
  readonly lines: ReadonlyArray<OrderLine>;
  readonly totalAmount: Money;
  readonly idempotencyKey: IdempotencyKey;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;                   // Optimistic concurrency
  readonly cancellationReason?: CancellationReason;
}

interface CancellationReason {
  readonly description: string;
  readonly initiator: 'customer' | 'system' | 'operator';
  readonly cancelledAt: Date;
}

// ✅ Repository interface — pure TypeScript, zero infrastructure
interface OrderRepository {
  findById(orderId: OrderId): Promise<Order | null>;
  findByIdOrThrow(orderId: OrderId): Promise<Order>;
  findByIdempotencyKey(key: IdempotencyKey): Promise<Order | null>;
  findByCustomerAndStatus(customerId: CustomerId, status: OrderStatus): Promise<Order[]>;
  existsById(orderId: OrderId): Promise<boolean>;
  save(order: Order): Promise<Order>;
  stream(filter: OrderFilter): AsyncGenerator<Order>;
}
```

### 7.3 Domain Events

```typescript
// ✅ Domain events — discriminated union, immutable, versioned
interface BaseDomainEvent {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly occurredAt: Date;
  readonly schemaVersion: number;
}

interface OrderCreatedEvent extends BaseDomainEvent {
  readonly type: 'OrderCreated';
  readonly aggregateType: 'Order';
  readonly schemaVersion: 1;
  readonly customerId: string;
  readonly lines: ReadonlyArray<OrderLineSnapshot>;
  readonly totalAmount: MoneySnapshot;
}

interface OrderCancelledEvent extends BaseDomainEvent {
  readonly type: 'OrderCancelled';
  readonly aggregateType: 'Order';
  readonly schemaVersion: 1;
  readonly reason: string;
  readonly cancelledBy: string;
}

type OrderDomainEvent = OrderCreatedEvent | OrderCancelledEvent;
type DomainEvent = OrderDomainEvent; // Union of all service events

// ✅ Factory functions for events
function toOrderCreatedEvent(order: Order): OrderCreatedEvent {
  return {
    eventId: crypto.randomUUID(),
    aggregateId: order.id,
    aggregateType: 'Order',
    type: 'OrderCreated',
    occurredAt: new Date(),
    schemaVersion: 1,
    customerId: order.customerId,
    lines: order.lines.map(toLineSnapshot),
    totalAmount: toMoneySnapshot(order.totalAmount),
  };
}
```

---

## 8. Event-Driven Architecture Patterns

### 8.1 Outbox Pattern — Guaranteed Delivery

```typescript
// ✅ Outbox record
type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'DEAD';

interface OutboxEvent {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly eventType: string;
  readonly payload: string;
  readonly status: OutboxStatus;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  readonly retryCount: number;
  readonly lastError: string | null;
  readonly nextRetryAt: Date;
}

const MAX_RETRIES = 5;

function withRetryState(event: OutboxEvent, error: unknown): OutboxEvent {
  const retryCount = event.retryCount + 1;
  const backoffSeconds = Math.min(Math.pow(2, retryCount), 300);
  const nextRetryAt = new Date(Date.now() + backoffSeconds * 1_000);

  return {
    ...event,
    retryCount,
    lastError: errorMessage(error),
    status: retryCount >= MAX_RETRIES ? 'DEAD' : 'PENDING',
    nextRetryAt,
  };
}

// ✅ Outbox publisher — writes atomically with the business transaction
class OutboxEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly outboxRepository: OutboxRepository,
  ) {}

  /**
   * MUST be called within the same DB transaction as the business operation.
   * The broker publish is done asynchronously by OutboxPoller.
   */
  async publish(event: DomainEvent): Promise<void> {
    const outboxEvent: Omit<OutboxEvent, 'id'> = {
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventType: event.type,
      payload: JSON.stringify(event),
      status: 'PENDING',
      createdAt: new Date(),
      processedAt: null,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(),
    };
    await this.outboxRepository.save(outboxEvent);
  }
}

// ✅ Outbox poller — clean lifecycle with graceful shutdown
class OutboxPoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly brokerPublisher: MessageBrokerPublisher,
    private readonly alerting: AlertingService,
    private readonly metrics: MetricsClient,
    private readonly pollIntervalMs: number = 500,
    private readonly batchSize: number = 100,
  ) {}

  start(): void {
    this.running = true;
    this.scheduleNextPoll();
    logger.info('OutboxPoller started', { pollIntervalMs: this.pollIntervalMs });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    logger.info('OutboxPoller stopped');
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.poll().catch(err =>
        logger.error('OutboxPoller poll cycle failed', { error: errorMessage(err) }),
      );
      this.scheduleNextPoll();
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    const pending = await this.outboxRepository.findPendingBatch(
      new Date(),
      this.batchSize,
    );

    await Promise.allSettled(pending.map(event => this.publishEvent(event)));
  }

  private async publishEvent(event: OutboxEvent): Promise<void> {
    try {
      await this.outboxRepository.markProcessing(event.id); // optimistic lock
      await this.brokerPublisher.publish(event);
      await this.outboxRepository.markPublished(event.id, new Date());
      this.metrics.increment('outbox.published', { eventType: event.eventType });

    } catch (error) {
      if (error instanceof OptimisticLockError) {
        logger.debug('Skipping event — already processing', { eventId: event.id });
        return;
      }

      const updated = withRetryState(event, error);
      await this.outboxRepository.updateForRetry(updated);

      if (updated.status === 'DEAD') {
        this.metrics.increment('outbox.dead_letter', { eventType: event.eventType });
        logger.error('Outbox event DEAD after max retries', {
          eventId: event.id,
          eventType: event.eventType,
          retryCount: updated.retryCount,
        });
        await this.alerting.notify({
          severity: 'CRITICAL',
          title: 'Outbox dead letter',
          message: `eventId=${event.id} type=${event.eventType}`,
        });
      }
    }
  }

  async replayDeadEvents(eventType: string, maxCount: number): Promise<number> {
    const dead = await this.outboxRepository.findDeadByType(eventType, maxCount);
    await Promise.all(dead.map(e => this.outboxRepository.resetForRetry(e.id)));
    logger.info('Reset dead events for replay', { eventType, count: dead.size });
    return dead.size;
  }
}
```

### 8.2 Event Consumer — Exactly-Once Processing

```typescript
// ✅ Typed, idempotent event consumer
class OrderCreatedEventConsumer {
  constructor(
    private readonly idempotencyStore: IdempotencyStore,
    private readonly reserveInventoryUseCase: ReserveInventoryUseCase,
    private readonly metrics: MetricsClient,
  ) {}

  /**
   * Return normally  → ACK the message.
   * Throw RetryableError    → NACK — broker requeues.
   * Throw NonRetryableError → ACK — broker routes to DLQ (via subscription config).
   */
  async onOrderCreated(message: ConsumedMessage<OrderCreatedEvent>): Promise<void> {
    const { id: messageId, payload: event } = message;
    const idempotencyKey = `order-created-consumer:${messageId}`;

    using _ctx = withMDC({
      traceId: event.eventId,
      eventType: 'OrderCreated',
      aggregateId: event.aggregateId,
    });

    try {
      if (await this.idempotencyStore.isAlreadyProcessed(idempotencyKey)) {
        logger.info('Duplicate message — skipping', { messageId });
        this.metrics.increment('consumer.duplicate_skipped', { eventType: 'OrderCreated' });
        return;
      }

      const result = await this.routeBySchemaVersion(event);

      await this.idempotencyStore.markProcessed(idempotencyKey, 7 * 24 * 60 * 60 * 1000);

      this.metrics.increment('consumer.processed', {
        eventType: 'OrderCreated',
        result: result.type,
      });

    } catch (error) {
      if (error instanceof DomainError) {
        logger.error('Non-retryable error — routing to DLQ', {
          messageId,
          error: errorMessage(error),
        });
        this.metrics.increment('consumer.non_retryable_error', { eventType: 'OrderCreated' });
        throw new NonRetryableError('Business rule violation', { cause: error });
      }

      logger.warn('Transient error — will retry', { messageId, error: errorMessage(error) });
      this.metrics.increment('consumer.transient_error', { eventType: 'OrderCreated' });
      throw new RetryableError('Transient failure', { cause: error });
    }
  }

  private async routeBySchemaVersion(event: OrderCreatedEvent): Promise<EventProcessingResult> {
    switch (event.schemaVersion) {
      case 1: return this.processV1(event);
      default:
        logger.warn('Unknown schema version — skipping', {
          schemaVersion: event.schemaVersion,
        });
        return { type: 'Skipped', eventId: event.eventId, reason: `Unknown version ${event.schemaVersion}` };
    }
  }

  private async processV1(event: OrderCreatedEvent): Promise<EventProcessingResult> {
    const command = toReserveInventoryCommand(event);
    await this.reserveInventoryUseCase.execute(command);
    return { type: 'Processed', eventId: event.eventId, durationMs: 0 };
  }
}
```

### 8.3 Event Schema Evolution Contract

```
╔══════════════════════════════════════════════════════════════════════╗
║              EVENT SCHEMA EVOLUTION CONTRACT                         ║
╠══════════════════════════════════════════════════════════════════════╣
║ ALLOWED (non-breaking):                                              ║
║   ✅ Add new optional fields (with ?:)                              ║
║   ✅ Add new event types to the discriminated union                  ║
║   ✅ Deprecate fields (keep them, add JSDoc @deprecated)             ║
║   ✅ Widen types (string literal → string)                          ║
║                                                                      ║
║ FORBIDDEN (breaking):                                                ║
║   ❌ Remove or rename interface fields                               ║
║   ❌ Narrow types (string → specific literal union)                 ║
║   ❌ Change the 'type' discriminant value                            ║
║   ❌ Change schemaVersion without creating a new type               ║
║   ❌ Change partition key / ordering key strategy                    ║
║                                                                      ║
║ PROCESS FOR BREAKING CHANGES:                                        ║
║   1. Create new interface (OrderCreatedV2Event)                     ║
║   2. Publish BOTH versions during migration window                   ║
║   3. Migrate all consumers to new version                           ║
║   4. Remove old type after all consumers migrated                   ║
║                                                                      ║
║ schemaVersion is MANDATORY on every event interface                  ║
║ Consumers MUST handle current AND all previous schema versions       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 9. Error Handling Strategy

### 9.1 Result Type — Errors as Values

```typescript
// ✅ Result<T, E> — make error paths explicit in the type signature
// Use for EXPECTED failures that callers must handle

type Result<T, E = ApplicationError> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

const Result = {
  ok:   <T>(value: T): Result<T, never> => ({ ok: true, value }),
  fail: <E>(error: E): Result<never, E> => ({ ok: false, error }),

  // Map over success
  map: <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
    result.ok ? Result.ok(fn(result.value)) : result,

  // Chain operations
  flatMap: <T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> =>
    result.ok ? fn(result.value) : result,

  // Unwrap with default
  getOrElse: <T, E>(result: Result<T, E>, defaultValue: T): T =>
    result.ok ? result.value : defaultValue,

  // Async support
  fromPromise: async <T>(promise: Promise<T>): Promise<Result<T, Error>> => {
    try {
      return Result.ok(await promise);
    } catch (error) {
      return Result.fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ✅ Usage — caller is forced to handle both paths
async function findOrder(orderId: OrderId): Promise<Result<Order, OrderNotFoundError>> {
  const order = await orderRepository.findById(orderId);
  return order
    ? Result.ok(order)
    : Result.fail(new OrderNotFoundError(orderId));
}

const result = await findOrder(orderId);
if (!result.ok) {
  return Response.notFound(result.error.message);
}
const order = result.value; // TypeScript knows this is Order
```

### 9.2 Error Hierarchy

```typescript
// ✅ Typed, context-rich error hierarchy
interface ErrorContext {
  readonly [key: string]: string | number | boolean | null;
}

abstract class ApplicationError extends Error {
  abstract readonly errorCode: string;
  abstract readonly retryable: boolean;
  readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    // Capture stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ── Domain errors — business rule violations ──────────────────────────────────
abstract class DomainError extends ApplicationError {
  readonly retryable = false as const; // Domain errors are never retryable
}

class OrderNotFoundError extends DomainError {
  readonly errorCode = 'ORDER_NOT_FOUND' as const;
  constructor(orderId: OrderId) {
    super(`Order ${orderId} not found`, { orderId });
  }
}

class InvalidOrderStateError extends DomainError {
  readonly errorCode = 'INVALID_ORDER_STATE' as const;
  constructor(orderId: OrderId, currentStatus: OrderStatus, attemptedOperation: string) {
    super(
      `Cannot ${attemptedOperation} order ${orderId} in status ${currentStatus}`,
      { orderId, currentStatus, attemptedOperation },
    );
  }
}

class InsufficientInventoryError extends DomainError {
  readonly errorCode = 'INSUFFICIENT_INVENTORY' as const;
  constructor(productId: ProductId, requested: number, available: number) {
    super(
      `Product ${productId}: requested ${requested}, available ${available}`,
      { productId, requested, available },
    );
  }
}

// ── Infrastructure errors ─────────────────────────────────────────────────────
abstract class InfrastructureError extends ApplicationError {}

class PaymentServiceUnavailableError extends InfrastructureError {
  readonly errorCode = 'PAYMENT_SERVICE_UNAVAILABLE' as const;
  readonly retryable = true as const;
  constructor(orderId: OrderId) {
    super(`Payment service unavailable for order ${orderId}`, { orderId });
  }
}

class CircuitOpenError extends InfrastructureError {
  readonly errorCode = 'CIRCUIT_BREAKER_OPEN' as const;
  readonly retryable = true as const;
  constructor(circuitName: string) {
    super(`Circuit breaker open: ${circuitName}`, { circuitName });
  }
}

// ── Messaging errors ──────────────────────────────────────────────────────────
class RetryableError extends ApplicationError {
  readonly errorCode = 'RETRYABLE_ERROR' as const;
  readonly retryable = true as const;
}

class NonRetryableError extends ApplicationError {
  readonly errorCode = 'NON_RETRYABLE_ERROR' as const;
  readonly retryable = false as const;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string {
  if (error instanceof ApplicationError) return error.errorCode;
  if (error instanceof Error) return error.name;
  return 'UNKNOWN_ERROR';
}
```

### 9.3 Never Swallow Errors

```typescript
// ❌ FORBIDDEN — silently discarding failures
try {
  await processOrder(command);
} catch {
  // 🔥 Failure hidden — no log, no metric, no rethrow
}

// ❌ FORBIDDEN — catch-all with no context added
try {
  await processOrder(command);
} catch (error) {
  throw new Error('Something went wrong'); // Original error lost
}

// ✅ REQUIRED — catch what you handle, propagate the rest
try {
  await processOrder(command);
} catch (error) {
  if (error instanceof OrderNotFoundError) {
    return OrderResult.notFound(error.context);
  }
  if (error instanceof InsufficientInventoryError) {
    return OrderResult.insufficientInventory(error.context);
  }
  // Unexpected — add context and propagate
  throw new OrderProcessingError(
    `Failed to process order ${command.orderId} at payment step`,
    { cause: error },
  );
}

// ✅ Unhandled rejections — always register a global handler in bootstrap
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise rejection', {
    event: 'UNHANDLED_REJECTION',
    reason: errorMessage(reason),
    promise: String(promise),
  });
  // In production: alert on-call, then graceful shutdown
  gracefulShutdown.shutdown('unhandledRejection');
});
```

---

## 10. Observability & Operability

### 10.1 Structured Logging

```typescript
// ✅ Structured logger interface — every field is queryable
interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string,  fields?: LogFields): void;
  info(message: string,  fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
}

// ✅ Context propagation via AsyncLocalStorage (Node.js built-in)
// — the TypeScript equivalent of MDC
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly service: string;
  readonly version: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

// ✅ withMDC — wrap any async operation with context
async function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContext.run(ctx, fn);
}

// ✅ Context-aware logger
const logger: Logger = {
  info: (message, fields = {}) => {
    const ctx = requestContext.getStore();
    console.log(JSON.stringify({
      level: 'INFO',
      message,
      timestamp: new Date().toISOString(),
      traceId: ctx?.traceId,
      spanId: ctx?.spanId,
      service: ctx?.service,
      ...fields,
    }));
  },
  // ... error, warn, debug similarly
};

// ✅ HTTP middleware — establish context per request
function traceContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = req.headers['traceparent'] as string
    ?? req.headers['x-request-id'] as string
    ?? crypto.randomUUID().replace(/-/g, '');

  withRequestContext(
    { traceId, spanId: crypto.randomUUID().slice(0, 16), service: APP_NAME, version: APP_VERSION },
    () => new Promise<void>((resolve) => {
      next();
      res.on('finish', resolve);
    }),
  );
}

// ✅ Log level contract
// ERROR  → immediate action required (page on-call)
// WARN   → unexpected but handled; investigate next business day
// INFO   → significant business events only (order created, payment processed)
// DEBUG  → developer diagnostics; disabled in production

// ✅ PII — never log
// ❌ Full names, emails, phone numbers, addresses
// ❌ Card numbers, CVVs, passwords, API keys
// ✅ Log masked IDs only
function logOrderCreated(order: Order, durationMs: number): void {
  logger.info('Order created', {
    event: 'ORDER_CREATED',
    orderId: order.id,
    customerId: DataMasker.maskId(order.customerId), // PII masked
    lineCount: order.lines.length,
    totalAmountCents: Number(order.totalAmount.amount),
    currency: order.totalAmount.currency,
    durationMs,
  });
}
```

### 10.2 Metrics

```typescript
// ✅ Metrics interface — Prometheus-compatible
interface MetricsClient {
  increment(name: string, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;
}

// ✅ Business-level metrics — not just HTTP stats
class OrderServiceMetrics {
  constructor(private readonly client: MetricsClient) {}

  recordOrderCreated(order: Order, durationMs: number): void {
    this.client.increment('business.orders.created.total');
    this.client.timing('business.orders.creation.duration_ms', durationMs);
    this.client.histogram(
      'business.orders.value_cents',
      Number(order.totalAmount.amount),
    );
  }

  recordOrderFailed(reason: string): void {
    this.client.increment('business.orders.failed.total', { reason });
  }

  recordPendingOrders(count: number): void {
    this.client.gauge('business.orders.pending.count', count);
  }
}

// ✅ Timing decorator — wrap any async operation
async function timed<T>(
  metrics: MetricsClient,
  metricName: string,
  tags: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    metrics.timing(metricName, Date.now() - start, { ...tags, result: 'success' });
    return result;
  } catch (error) {
    metrics.timing(metricName, Date.now() - start, { ...tags, result: 'error' });
    throw error;
  }
}
```

### 10.3 Health Checks

```typescript
// ✅ Readiness vs Liveness — never conflate them

type HealthStatus = 'UP' | 'DOWN' | 'DEGRADED';

interface HealthCheckResult {
  readonly status: HealthStatus;
  readonly details: Record<string, string>;
}

// Readiness: "Am I ready to receive traffic?"
async function readinessCheck(deps: {
  db: DatabasePool;
  broker: MessageBroker;
  circuitBreakers: Map<string, CircuitBreaker>;
}): Promise<HealthCheckResult> {
  const details: Record<string, string> = {};
  let allHealthy = true;

  // Database
  try {
    await deps.db.query('SELECT 1');
    details['database'] = 'UP';
  } catch (err) {
    details['database'] = `DOWN: ${errorMessage(err)}`;
    allHealthy = false;
  }

  // Message broker
  if (!deps.broker.isConnected()) {
    details['messageBroker'] = 'DOWN';
    allHealthy = false;
  } else {
    details['messageBroker'] = 'UP';
  }

  // Circuit breakers — open CB means dependency is unavailable
  for (const [name, cb] of deps.circuitBreakers) {
    const state = cb.getState();
    details[`circuitBreaker.${name}`] = state;
    if (state === 'OPEN') allHealthy = false;
  }

  return { status: allHealthy ? 'UP' : 'DOWN', details };
}

// Liveness: "Am I deadlocked? Should the platform restart me?"
// NO external dependency checks here — those cause restart loops
async function livenessCheck(): Promise<HealthCheckResult> {
  // For Node.js: check event loop lag as a proxy for liveness
  const lag = await measureEventLoopLag();
  const isAlive = lag < 5_000; // > 5s lag suggests something is very wrong

  return {
    status: isAlive ? 'UP' : 'DOWN',
    details: { eventLoopLagMs: String(lag) },
  };
}

async function measureEventLoopLag(): Promise<number> {
  return new Promise(resolve => {
    const start = Date.now();
    setImmediate(() => resolve(Date.now() - start));
  });
}
```

---

## 11. Testing Standards

### 11.1 Test Pyramid

```
Unit Tests        (60–70%)   Instant · No I/O · Domain logic only · Vitest or Jest
Integration Tests  (20–30%)  Real infrastructure via Testcontainers · <5s each
Contract Tests     (~5%)     Pact consumer-driven contracts for events and APIs
E2E Tests          (~5%)     Full service via HTTP against staging

RULE: Never mock what you can Testcontainer
RULE: Unit tests test domain logic — not framework plumbing
RULE: Test file naming: *.unit.test.ts, *.integration.test.ts, *.e2e.test.ts
RULE: Use Vitest for its native TypeScript support and faster execution
```

### 11.2 Domain Unit Tests — Pure Functions

```typescript
// ✅ Domain tests — zero I/O, pure function testing
import { describe, it, expect } from 'vitest';

describe('Order domain', () => {
  describe('createOrder', () => {
    it('calculates total amount from line items', () => {
      const command: CreateOrderCommand = {
        customerId: CustomerId.of('cust-1'),
        idempotencyKey: IdempotencyKey.of('test-key-abc'),
        currency: 'USD' as CurrencyCode,
        lines: [
          { productId: ProductId.of('p1'), productName: 'Widget', quantity: 2, unitPrice: Money.of(10_00n, 'USD' as CurrencyCode) },
          { productId: ProductId.of('p2'), productName: 'Gadget', quantity: 3, unitPrice: Money.of(5_00n, 'USD' as CurrencyCode) },
        ],
      };

      const order = createOrder(command);

      expect(order.totalAmount).toEqual(Money.of(35_00n, 'USD' as CurrencyCode)); // 2×10 + 3×5
      expect(order.status).toBe('PENDING');
      expect(order.id).toBeTruthy();
    });

    it('throws ValidationError when lines array is empty', () => {
      const command = createOrderCommandFixture({ lines: [] });
      expect(() => createOrder(command)).toThrow(ValidationError);
    });

    it('throws ValidationError when lines exceed 100', () => {
      const command = createOrderCommandFixture({
        lines: Array.from({ length: 101 }, makeOrderLineCommand),
      });
      expect(() => createOrder(command)).toThrow(ValidationError);
    });
  });

  describe('confirmOrder', () => {
    it('returns a new Order with CONFIRMED status', () => {
      const order = orderFixture({ status: 'PENDING' });
      const confirmed = confirmOrder(order);

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.version).toBe(order.version + 1);
      expect(confirmed.id).toBe(order.id);      // Same identity
      expect(confirmed).not.toBe(order);         // New object — no mutation
    });

    it('throws InvalidOrderStateError when order is not PENDING', () => {
      const order = orderFixture({ status: 'FULFILLED' });

      expect(() => confirmOrder(order))
        .toThrow(InvalidOrderStateError);
    });
  });

  describe('Money', () => {
    it('adds amounts of the same currency', () => {
      const a = Money.of(10_00n, 'USD' as CurrencyCode);
      const b = Money.of(5_50n, 'USD' as CurrencyCode);
      expect(Money.add(a, b)).toEqual(Money.of(15_50n, 'USD' as CurrencyCode));
    });

    it('throws on currency mismatch', () => {
      const usd = Money.of(10_00n, 'USD' as CurrencyCode);
      const eur = Money.of(5_00n, 'EUR' as CurrencyCode);
      expect(() => Money.add(usd, eur)).toThrow('Currency mismatch');
    });
  });
});
```

### 11.3 Application Layer Tests — Mocking Ports

```typescript
// ✅ Mock ports, not implementations — test use case orchestration
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('CreateOrderUseCase', () => {
  let orderRepository: OrderRepository;
  let eventPublisher: DomainEventPublisher;
  let idempotencyStore: IdempotencyStore;
  let useCase: CreateOrderUseCase;

  beforeEach(() => {
    orderRepository   = { save: vi.fn(), findById: vi.fn(), findByIdOrThrow: vi.fn(),
                          findByIdempotencyKey: vi.fn(), existsById: vi.fn(),
                          findByCustomerAndStatus: vi.fn(), stream: vi.fn() };
    eventPublisher    = { publish: vi.fn().mockResolvedValue(undefined) };
    idempotencyStore  = {
      isAlreadyProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      getStoredResult: vi.fn().mockResolvedValue(null),
      markProcessedWithResult: vi.fn().mockResolvedValue(undefined),
    };
    useCase = new CreateOrderUseCase(orderRepository, eventPublisher, idempotencyStore);
  });

  it('creates order and publishes event on first execution', async () => {
    const command = createOrderCommandFixture();
    vi.mocked(orderRepository.save).mockImplementation(async order => order);

    const result = await useCase.execute(command);

    expect(result.type).toBe('Created');
    expect(orderRepository.save).toHaveBeenCalledOnce();
    expect(eventPublisher.publish).toHaveBeenCalledOnce();
    expect(idempotencyStore.markProcessedWithResult).toHaveBeenCalledOnce();
  });

  it('returns stored result for duplicate idempotency key', async () => {
    const command = createOrderCommandFixture();
    const existingResult: OrderResult = { type: 'Created', order: orderFixture() };
    vi.mocked(idempotencyStore.getStoredResult).mockResolvedValue(existingResult);

    const result = await useCase.execute(command);

    expect(result.type).toBe('Created');
    expect(orderRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
```

### 11.4 Integration Tests — Testcontainers

```typescript
// ✅ Integration tests with real infrastructure
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('OrderRepository integration', () => {
  let container: StartedPostgreSqlContainer;
  let repository: OrderRepositoryAdapter;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('testdb')
      .withUsername('test')
      .withPassword('test')
      .start();

    const pool = createDatabasePool(container.getConnectionUri());
    await runMigrations(pool);
    repository = new OrderRepositoryAdapter(pool);
  }, 60_000); // Allow 60s for container startup

  afterAll(async () => {
    await container.stop();
  });

  it('saves and retrieves an order with correct data', async () => {
    const order = orderFixture();

    await repository.save(order);
    const retrieved = await repository.findById(order.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(order.id);
    expect(retrieved!.status).toBe('PENDING');
    expect(retrieved!.totalAmount).toEqual(order.totalAmount);
  });

  it('returns null for non-existent order', async () => {
    const result = await repository.findById(OrderId.of('nonexistent-order-id'));
    expect(result).toBeNull();
  });

  it('throws OptimisticLockError on concurrent save with stale version', async () => {
    const order = orderFixture();
    await repository.save(order);

    const version1 = await repository.findByIdOrThrow(order.id);
    const version2 = await repository.findByIdOrThrow(order.id);

    const confirmed = confirmOrder(version1);
    await repository.save(confirmed);  // Succeeds — version matches

    await expect(
      repository.save(confirmOrder(version2)), // Stale version — should fail
    ).rejects.toThrow(OptimisticLockError);
  });
});

// ✅ Circuit breaker integration test
import { WireMockContainer } from 'testcontainers-wiremock';

describe('InventoryAdapter circuit breaker', () => {
  let wiremock: StartedGenericContainer;
  let adapter: InventoryAdapter;
  const circuitBreakers = new Map<string, CircuitBreaker>();

  beforeAll(async () => {
    wiremock = await new WireMockContainer().start();
    adapter = new InventoryAdapter(
      createInventoryClient(`http://${wiremock.getHost()}:${wiremock.getMappedPort(8080)}`),
      metricsClientFixture(),
    );
  });

  it('opens circuit breaker after failure threshold and returns fallback', async () => {
    // Make the downstream always fail
    await wiremock.stubFor(get('/inventory/*').willReturn(serverError()));

    // Trigger enough failures
    for (let i = 0; i < 15; i++) {
      await adapter.checkInventory(ProductId.of(`p${i}`));
    }

    // Circuit should be open
    const cb = circuitBreakers.get('inventory-service');
    expect(cb?.getState()).toBe('OPEN');

    // Fallback returned — no call made while circuit is open
    const status = await adapter.checkInventory(ProductId.of('new-product'));
    expect(status).toBe(InventoryStatus.Unknown);
  });
});
```

### 11.5 Type-Level Tests

```typescript
// ✅ Compile-time type tests — catch type regressions
import { expectType, expectError } from 'tsd'; // or use ts-expect

// Verify discriminated union is exhaustive
const result: OrderResult = { type: 'Created', order: orderFixture() };
switch (result.type) {
  case 'Created': break;
  case 'AlreadyExists': break;
  case 'Rejected': break;
  case 'InsufficientInventory': break;
  default: assertNever(result); // Must compile — all cases handled
}

// Verify branded types prevent substitution
declare const orderId: OrderId;
declare const customerId: CustomerId;
expectError(createOrder(orderId, customerId)); // OrderId where CustomerId expected → type error
```

---

## 12. Security Standards

### 12.1 Input Validation at the Boundary

```typescript
// ✅ Zod schemas — validate ALL external input at the boundary
import { z } from 'zod';

const CreateOrderRequestSchema = z.object({
  customerId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9\-_]+$/),
  lines: z.array(z.object({
    productId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(1000),
    unitPriceCents: z.bigint().nonnegative(),
  })).min(1).max(100),
  idempotencyKey: z.string().min(8).max(64).regex(/^[a-zA-Z0-9\-_]+$/),
  currency: z.string().length(3).toUpperCase(),
});

type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

// ✅ Parse at the controller boundary — fail before domain code is reached
async function createOrderHandler(req: Request, res: Response): Promise<void> {
  const parseResult = CreateOrderRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json(ErrorResponse.validation(parseResult.error.issues));
    return;
  }

  const command = toCreateOrderCommand(parseResult.data, req.headers['x-idempotency-key']);
  const result = await createOrderUseCase.execute(command);
  res.status(201).json(toOrderResponse(result));
}

// ✅ Header validation too — idempotency key is always required
const idempotencyKey = z.string().min(8).max(64)
  .parse(req.headers['x-idempotency-key']); // Throws ZodError if missing/invalid
```

### 12.2 Preventing Injection

```typescript
// ✅ NEVER build queries via string concatenation
// ❌ FORBIDDEN — SQL injection
const query = `SELECT * FROM orders WHERE customer_id = '${customerId}'`;

// ✅ REQUIRED — parameterized queries always
const result = await db.query(
  'SELECT * FROM orders WHERE customer_id = $1 AND status = $2',
  [customerId, status],
);

// ✅ NEVER build queries from user-supplied JSON paths
// ❌ FORBIDDEN
const filter = JSON.parse(req.body.filter); // User controls query structure
await collection.find(filter);

// ✅ REQUIRED — validate and construct the query from typed inputs
const filter = {
  customerId: validatedCustomerId,
  status: validatedStatus,
};
await collection.find(filter);
```

### 12.3 PII & Secrets

```typescript
// ✅ Events carry only IDs — never PII
// ❌ WRONG
interface OrderCreatedEvent { customerEmail: string; phoneNumber: string; }

// ✅ CORRECT
interface OrderCreatedEvent { customerId: string; } // Recipient fetches details if needed

// ✅ Data masking
const DataMasker = {
  maskEmail: (email: string): string => {
    const at = email.indexOf('@');
    return at <= 1 ? '****' : `${email[0]}***${email.slice(at)}`;
  },
  maskId: (id: string): string =>
    id.length < 6 ? '****' : `${id.slice(0, 4)}****${id.slice(-2)}`,
  maskCard: (card: string): string => `**** **** **** ${card.slice(-4)}`,
} as const;

// ✅ Secrets validation — fail fast on startup
function validateSecrets(): void {
  const required = ['DB_URL', 'DB_PASSWORD', 'BROKER_URL', 'BROKER_PASSWORD'] as const;
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

---

## 13. API Design Standards

### 13.1 Express/Fastify Controller Pattern

```typescript
// ✅ Controller is thin — routing and HTTP translation only, zero business logic
class OrderController {
  constructor(
    private readonly createOrder: CreateOrderUseCase,
    private readonly getOrder: GetOrderUseCase,
    private readonly metrics: OrderServiceMetrics,
  ) {}

  // ✅ Return types are explicit — no implicit any responses
  async create(req: Request, res: Response): Promise<void> {
    const parseResult = CreateOrderRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ErrorResponse.validation(parseResult.error.issues));
      return;
    }

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (typeof idempotencyKey !== 'string') {
      res.status(400).json(ErrorResponse.domain('MISSING_HEADER', 'X-Idempotency-Key is required'));
      return;
    }

    const start = Date.now();
    try {
      const command = toCreateOrderCommand(parseResult.data, idempotencyKey);
      const result = await this.createOrder.execute(command);

      switch (result.type) {
        case 'Created':
          this.metrics.recordOrderCreated(result.order, Date.now() - start);
          res.status(201).json(toOrderResponse(result.order));
          break;
        case 'AlreadyExists':
          res.status(409).json(ErrorResponse.domain(
            'ALREADY_EXISTS',
            `Order already created at ${result.originalCreatedAt.toISOString()}`,
          ));
          break;
        case 'Rejected':
          res.status(422).json(ErrorResponse.domain('REJECTED', result.reason));
          break;
        case 'InsufficientInventory':
          res.status(422).json(ErrorResponse.domain(
            'INSUFFICIENT_INVENTORY',
            `Only ${result.available} available`,
          ));
          break;
        default:
          assertNever(result);
      }
    } catch (error) {
      if (error instanceof PaymentServiceUnavailableError) {
        res.status(503).json(ErrorResponse.infrastructure(
          'SERVICE_UNAVAILABLE',
          `Temporarily unavailable. Reference: ${getTraceId()}`,
        ));
        return;
      }
      throw error; // Let global error handler deal with the rest
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    const orderId = OrderId.of(req.params['orderId']!);
    const order = await this.getOrder.execute(orderId);

    if (!order) {
      res.status(404).json(ErrorResponse.domain('NOT_FOUND', `Order ${orderId} not found`));
      return;
    }
    res.status(200).json(toOrderResponse(order));
  }
}
```

### 13.2 Global Error Handler

```typescript
// ✅ Centralized error mapping — one place, consistent format
function globalErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const traceId = getTraceId();

  if (error instanceof ZodError) {
    res.status(400).json(ErrorResponse.validation(error.issues));
    return;
  }

  if (error instanceof DomainError) {
    logger.info('Domain error', { errorCode: error.errorCode, message: error.message, ...error.context });
    res.status(422).json(ErrorResponse.domain(error.errorCode, error.message));
    return;
  }

  if (error instanceof OrderNotFoundError) {
    res.status(404).json(ErrorResponse.domain(error.errorCode, error.message));
    return;
  }

  if (error instanceof InfrastructureError) {
    logger.error('Infrastructure error', {
      errorCode: error.errorCode,
      traceId,
      url: req.url,
      method: req.method,
    }, error);
    res.status(503).json(ErrorResponse.infrastructure(
      'SERVICE_UNAVAILABLE',
      `Service temporarily unavailable. Reference: ${traceId}`,
    ));
    return;
  }

  // Unexpected — log fully, expose nothing
  logger.error('Unhandled error', { traceId, url: req.url, method: req.method }, error);
  res.status(500).json(ErrorResponse.infrastructure(
    'INTERNAL_ERROR',
    `Unexpected error. Reference: ${traceId}`,
  ));
}

// ✅ Consistent error response type
interface ErrorResponseBody {
  readonly errorCode: string;
  readonly message: string;
  readonly fieldViolations?: ReadonlyArray<FieldViolation>;
  readonly timestamp: string;
  readonly traceId: string | null;
}

interface FieldViolation {
  readonly field: string;
  readonly message: string;
  readonly receivedValue?: unknown;
}

const ErrorResponse = {
  validation: (issues: z.ZodIssue[]): ErrorResponseBody => ({
    errorCode: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    fieldViolations: issues.map(i => ({
      field: i.path.join('.'),
      message: i.message,
    })),
    timestamp: new Date().toISOString(),
    traceId: getTraceId(),
  }),
  domain: (code: string, message: string): ErrorResponseBody => ({
    errorCode: code, message, timestamp: new Date().toISOString(), traceId: getTraceId(),
  }),
  infrastructure: (code: string, message: string): ErrorResponseBody => ({
    errorCode: code, message, timestamp: new Date().toISOString(), traceId: getTraceId(),
  }),
} as const;
```

---

## 14. Configuration Management

### 14.1 Type-Safe Config — Zod-Validated

```typescript
// ✅ Type-safe configuration — validated on startup with Zod
import { z } from 'zod';

const ConfigSchema = z.object({
  // Service identity
  SERVICE_NAME:    z.string().min(1),
  ENVIRONMENT:     z.enum(['local', 'development', 'staging', 'production']),
  SERVICE_VERSION: z.string().default('0.0.0'),

  // Server
  PORT:            z.coerce.number().int().min(1).max(65535).default(8080),
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce.number().default(30_000),

  // Database — required, from secrets manager
  DB_URL:          z.string().url(),
  DB_POOL_MIN:     z.coerce.number().default(5),
  DB_POOL_MAX:     z.coerce.number().default(50),
  DB_TIMEOUT_MS:   z.coerce.number().default(5_000),

  // Message broker — required
  BROKER_URL:      z.string().url(),

  // Resiliency
  CB_INVENTORY_THRESHOLD_PCT:  z.coerce.number().default(50),
  CB_INVENTORY_OPEN_DURATION_MS: z.coerce.number().default(30_000),
  RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),
  RETRY_INITIAL_DELAY_MS: z.coerce.number().default(300),

  // Observability
  LOG_LEVEL:          z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  TRACING_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Outbox
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(500),
  OUTBOX_BATCH_SIZE:       z.coerce.number().default(100),
});

type Config = z.infer<typeof ConfigSchema>;

// ✅ Fail fast — parse on startup, refuse to boot with invalid config
function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('FATAL: Invalid configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config: Config = loadConfig(); // Singleton, loaded at startup
```

---

## 15. Build & Dependency Standards

### 15.1 package.json Baseline

```json
{
  "name": "@acme/order-service",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build":        "tsc --project tsconfig.json",
    "typecheck":    "tsc --noEmit",
    "lint":         "eslint src --ext .ts --max-warnings 0",
    "test:unit":    "vitest run --testPathPattern=\\.unit\\.test\\.ts$",
    "test:int":     "vitest run --testPathPattern=\\.integration\\.test\\.ts$",
    "test:all":     "vitest run",
    "test:coverage":"vitest run --coverage",
    "start":        "node --enable-source-maps dist/bootstrap/index.js",
    "start:dev":    "tsx watch src/bootstrap/index.ts"
  },
  "dependencies": {
    "zod":                  "^3.23.x",
    "pino":                 "^9.x",
    "pino-pretty":          "^11.x",
    "@opentelemetry/sdk-node": "^0.52.x",
    "prom-client":          "^15.x",
    "express":              "^4.x",
    "@fastify/autoload":    "^5.x"
  },
  "devDependencies": {
    "typescript":               "^5.5.x",
    "vitest":                   "^2.x",
    "@vitest/coverage-v8":      "^2.x",
    "testcontainers":           "^10.x",
    "@testcontainers/postgresql": "^10.x",
    "tsd":                      "^0.31.x",
    "@pact-foundation/pact":    "^12.x",
    "eslint":                   "^9.x",
    "@typescript-eslint/eslint-plugin": "^8.x",
    "@typescript-eslint/parser": "^8.x",
    "tsx":                      "^4.x"
  }
}
```

### 15.2 ESLint Configuration

```javascript
// eslint.config.js
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // ── No any ──────────────────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any':               'error',
      '@typescript-eslint/no-unsafe-assignment':          'error',
      '@typescript-eslint/no-unsafe-member-access':       'error',
      '@typescript-eslint/no-unsafe-call':                'error',
      '@typescript-eslint/no-unsafe-return':              'error',

      // ── Async correctness ────────────────────────────────────────────────────
      '@typescript-eslint/no-floating-promises':          'error',    // No unhandled Promises
      '@typescript-eslint/no-misused-promises':           'error',
      '@typescript-eslint/await-thenable':                'error',
      'require-await':                                    'error',    // No async fn without await

      // ── Type safety ──────────────────────────────────────────────────────────
      '@typescript-eslint/strict-boolean-expressions':    'error',
      '@typescript-eslint/no-non-null-assertion':         'error',    // No ! operator
      '@typescript-eslint/prefer-nullish-coalescing':     'error',    // ?? over ||
      '@typescript-eslint/prefer-optional-chain':         'error',    // a?.b over a && a.b

      // ── Code quality ─────────────────────────────────────────────────────────
      '@typescript-eslint/explicit-function-return-type': 'error',    // No implicit returns
      '@typescript-eslint/no-unused-vars':                'error',
      'no-console':                                       'error',    // Use logger, never console
      'eqeqeq':                                           ['error', 'always'],
    },
  },
];
```

---

## 16. Anti-Patterns — Forbidden List

Every item below must be caught in code review. PRs containing these are rejected.

### TypeScript

```
❌ any type anywhere — use unknown and narrow explicitly
❌ Non-null assertion (!) — handle the null case explicitly
❌ Type assertion as X without validation — use Zod/parse to validate first
❌ as unknown as X double-cast — always indicates a design smell
❌ Implicit any function parameters — every param must have a type
❌ Mutable exported objects — always export readonly or freeze
❌ Enums — use string literal unions instead (better inference, no reverse mapping)
❌ namespace — use ES modules
❌ Callback-based APIs — wrap in Promises
❌ Function overloads when a union type suffices
```

### Async / Promises

```
❌ Floating Promises — every Promise must be awaited or .catch()-ed
❌ new Promise() constructor when async/await works — causes lost errors
❌ Promise chains (.then/.then/.catch) — use async/await
❌ await in a loop when parallelism is possible — use Promise.all
❌ setTimeout/setInterval without clearing on shutdown
❌ Unbounded concurrency — always use a Semaphore for limiting
❌ Calling async functions without await in an event listener
❌ process.exit() without graceful shutdown
```

### Resiliency

```
❌ External calls without circuit breaker
❌ External calls without timeout
❌ Retrying non-idempotent operations without idempotency keys
❌ Silent fallback — always log WARN + metric when degrading
❌ Publishing events outside the transaction — use Outbox pattern
❌ Consumer ACK before processing completes
❌ DLQ messages silently discarded — always persist and alert
❌ Catch-all error handler that swallows without logging
```

### Events & Messaging

```
❌ Events containing PII — carry IDs only
❌ Removing or renaming fields in an existing event interface
❌ Consumer processing without idempotency protection
❌ Using JSON.parse on event payloads without Zod validation
❌ Ordering-key changes between schema versions
❌ DLQ events silently dropped
```

### Security

```
❌ Hardcoded credentials, API keys, or secrets anywhere
❌ Logging PII — names, emails, card numbers, passwords
❌ String concatenation in SQL or NoSQL queries — parameterized queries always
❌ Trusting req.body without Zod schema validation
❌ Returning error.stack or internal details to API callers
❌ process.env access scattered across codebase — centralise in config module
```

### Architecture

```
❌ Domain types importing from infrastructure or framework modules
❌ Business logic in controllers, adapters, or DTO mappers
❌ Cross-service DB access or shared schemas
❌ Synchronous call chain deeper than 2 hops
❌ Aggregate state mutated without going through the domain function
❌ Infrastructure types (DB entities) leaking into domain types
❌ console.log in any environment — use structured logger
```

---

## 17. PR Checklist

Before requesting review, every item must be ✅:

**TypeScript Quality**
- [ ] Zero `any` types — all values typed explicitly
- [ ] No `!` non-null assertions — null cases handled explicitly
- [ ] All discriminated unions have exhaustive `switch` with `assertNever` default
- [ ] Domain types are fully `readonly` — no mutable fields
- [ ] All external data validated with Zod schema at the boundary

**Async Correctness**
- [ ] No floating Promises — every Promise is awaited or has `.catch()`
- [ ] Parallel operations use `Promise.all` not sequential `await`
- [ ] `setTimeout`/`setInterval` have corresponding `clear*` on shutdown
- [ ] Concurrency limits enforced with `Semaphore` on outbound calls
- [ ] `unhandledRejection` handler registered in bootstrap

**Resiliency**
- [ ] Every new external call has a circuit breaker, retry, and timeout
- [ ] Every command handler and event consumer is idempotent
- [ ] Fallback functions log a WARN and record a metric
- [ ] Timeout hierarchy documented in code comments (inner < outer)

**Events**
- [ ] New events have `schemaVersion` field (starting at `1`)
- [ ] No breaking changes to existing event interfaces (no field removals/renames)
- [ ] Event publishing uses Outbox pattern (or explicit documented justification)
- [ ] DLQ handling implemented for every new consumer

**Code Quality**
- [ ] Zero business logic in controllers, adapters, or DTO mappers
- [ ] Domain module imports nothing from infrastructure or framework packages
- [ ] All errors carry `errorCode` and `context` fields
- [ ] No PII in log statements — masked IDs only
- [ ] No credentials or secrets in code or committed config files

**Testing**
- [ ] Domain logic covered by pure unit tests (zero I/O)
- [ ] Outbound ports tested with Testcontainers (not just mocked)
- [ ] Circuit breaker fallback behaviour has an explicit integration test
- [ ] ESLint architecture rules pass — no cross-layer imports
- [ ] Type-level tests pass (`tsd`) — branded types prevent argument swaps

**Observability**
- [ ] New business operations emit `increment` (counter) and `timing` (histogram)
- [ ] New service dependencies added to readiness health check
- [ ] Significant business state transitions have `INFO`-level structured log entries

---

*Template Version: 1.0*
*Stack: TypeScript 5.x · Node.js 20+ · Zod · Vitest · Testcontainers · Pact*
*Maintained by: Platform Engineering | Review cycle: Quarterly*
*Last reviewed: 2025-Q1*