# 🏆 Golden Template: Java 21+ · Event-Driven Microservices · Virtual Threads · Resiliency-First

> **Purpose:** Authoritative engineering standard for AI agents and LLMs generating code in this stack.
> Every pattern, snippet, and rule targets Distinguished Engineer–level quality.
> **Immutable law:** When guidelines conflict with convenience, guidelines win.
> **Scope:** Technology-agnostic at the infrastructure layer — patterns apply whether
> you use Kafka, RabbitMQ, AWS SQS, or GCP Pub/Sub; PostgreSQL, MongoDB, or DynamoDB.

---

## Table of Contents

1. [Immutable Principles](#1-immutable-principles)
2. [Architecture Boundaries](#2-architecture-boundaries)
3. [Project Structure — Hexagonal Architecture](#3-project-structure--hexagonal-architecture)
4. [Java 21+ Language Standards](#4-java-21-language-standards)
5. [Virtual Threads — Deep Rules](#5-virtual-threads--deep-rules)
6. [Resiliency Patterns — First-Class Citizen](#6-resiliency-patterns--first-class-citizen)
7. [Domain Modeling Standards](#7-domain-modeling-standards)
8. [Event-Driven Architecture Patterns](#8-event-driven-architecture-patterns)
9. [Concurrency Patterns](#9-concurrency-patterns)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Observability & Operability](#11-observability--operability)
12. [Testing Standards](#12-testing-standards)
13. [Security Standards](#13-security-standards)
14. [API Design Standards](#14-api-design-standards)
15. [Configuration Management](#15-configuration-management)
16. [Build & Dependency Standards](#16-build--dependency-standards)
17. [Anti-Patterns — Forbidden List](#17-anti-patterns--forbidden-list)
18. [PR Checklist](#18-pr-checklist)

---

## 1. Immutable Principles

These are architectural axioms. No exception, no override, no "just this once."

| ID  | Principle                           | Rule                                                                               |
|-----|-------------------------------------|------------------------------------------------------------------------------------|
| P01 | **Fail fast, recover gracefully**   | Every external call has an explicit timeout, circuit breaker, and fallback         |
| P02 | **Idempotency by default**          | Every command handler and event consumer is safe to replay                         |
| P03 | **Explicit over implicit**          | Every timeout, retry, thread pool, and queue bound is declared — no defaults       |
| P04 | **Immutability first**              | Domain objects are immutable unless mutation is a deliberate domain operation      |
| P05 | **Structured logging only**         | No `System.out`, no string concatenation in logs, no unstructured messages         |
| P06 | **Secrets never in code**           | No hardcoded credentials, tokens, or keys anywhere in the codebase                 |
| P07 | **Service owns its data**           | No cross-service database access; data shared only via events or APIs              |
| P08 | **Virtual threads are not free**    | `synchronized` blocks, `ThreadLocal`, and native calls are audited for pin risk    |
| P09 | **Events are versioned contracts**  | Schema-versioned, backward-compatible, documented, never silently changed          |
| P10 | **Test the behaviour, not the mock**| Integration tests exercise real infrastructure (Testcontainers) wherever feasible  |
| P11 | **Observability is not optional**   | Every service ships metrics, traces, and structured logs from day one              |
| P12 | **Graceful degradation > hard fail**| A degraded response is almost always better than an exception to the caller        |

---

## 2. Architecture Boundaries

### 2.1 Microservice Scope Rules

```
ONE microservice owns:
  ✅ One bounded context
  ✅ One primary aggregate root (e.g., Order, Customer, Payment)
  ✅ Its own database schema / collection / table — never shared
  ✅ Its own deployment lifecycle and version

ONE microservice must NOT:
  ❌ Make synchronous calls to >2 downstream services per request
  ❌ Own business logic for another bounded context
  ❌ Consume another service's database directly
  ❌ Have a single point of failure in its critical path
```

### 2.2 Communication Decision Matrix

```
Use SYNCHRONOUS (HTTP/gRPC) when:
  ✅ Response is needed immediately to fulfill the caller's request
  ✅ Operation is a query (read-only)
  ✅ SLA dependency is acceptable (failure of target = failure of caller)

Use ASYNCHRONOUS (Events/Messages) when:
  ✅ Caller does not need the result immediately
  ✅ Multiple consumers need the same information
  ✅ Decoupling of availability is required
  ✅ The operation is a state change (create, update, delete)
  ✅ Cross-service workflows (sagas, choreography)

NEVER:
  ❌ Synchronous chain deeper than 2 hops (A → B → C → D is a smell)
  ❌ Fire-and-forget without a delivery guarantee mechanism
  ❌ Two-phase commit across services — use Saga or Outbox instead
```

### 2.3 Saga Pattern: Choreography vs Orchestration

```
CHOREOGRAPHY (preferred for ≤4 steps):
  Each service reacts to events and emits new events.
  No central coordinator. Simpler but harder to observe.

  Order Service  ──[OrderCreated]──▶  Inventory Service
                                              │
                                    [InventoryReserved]
                                              │
                                      ▶  Payment Service
                                              │
                                    [PaymentProcessed]
                                              │
                                      ▶  Order Service ──[OrderConfirmed]

ORCHESTRATION (preferred for >4 steps or complex compensation):
  A dedicated saga orchestrator owns the workflow state machine.
  Explicit visibility. Easier to debug and add steps.

  Saga Orchestrator ──▶ reserve inventory (command)
                    ◀── InventoryReserved (reply)
                    ──▶ charge payment (command)
                    ◀── PaymentFailed (reply)
                    ──▶ release inventory (compensating command)
```

---

## 3. Project Structure — Hexagonal Architecture

### 3.1 Module Layout

```
{service-name}/
├── api/                              # Public contracts — shared with consumers
│   └── src/main/java/
│       └── com/{company}/{service}/api/
│           ├── command/              # Inbound command DTOs
│           ├── query/                # Inbound query DTOs
│           ├── response/             # Outbound response DTOs (records)
│           └── event/                # Domain event schemas (versioned)
│
├── domain/                           # Pure business logic — ZERO framework deps
│   └── src/main/java/
│       └── com/{company}/{service}/domain/
│           ├── model/                # Aggregates, entities, value objects
│           ├── service/              # Domain services (stateless logic)
│           ├── event/                # Domain events (internal)
│           └── port/
│               ├── inbound/          # Use-case interfaces (what the domain exposes)
│               └── outbound/         # Repository / publisher interfaces (what domain needs)
│
├── application/                      # Orchestrates domain + ports (use-case implementations)
│   └── src/main/java/
│       └── com/{company}/{service}/application/
│           ├── usecase/              # One class per use case
│           └── saga/                 # Saga orchestrators (if used)
│
├── infrastructure/                   # Technical adapters (DB, messaging, HTTP clients)
│   └── src/main/java/
│       └── com/{company}/{service}/infrastructure/
│           ├── persistence/          # DB repositories, documents/entities, mappers
│           ├── messaging/            # Event publishers, subscribers, serializers
│           ├── http/                 # Outbound HTTP/gRPC clients
│           ├── cache/                # Cache adapters
│           └── config/               # Spring @Configuration classes
│
└── bootstrap/                        # Application entry point, wiring only
    └── src/main/java/
        └── com/{company}/{service}/
            └── Application.java
```

### 3.2 Dependency Rules — Enforced via ArchUnit

```
domain        → no dependencies on other layers (pure Java)
application   → depends on domain only
infrastructure → depends on application + domain
bootstrap     → depends on all (wires everything together)

These rules are tested in ArchitectureTest.java — see Section 12.4
```

### 3.3 Package Naming

```
com.{company}.{service}.{layer}.{subdomain}

✅ com.acme.orders.domain.model.Order
✅ com.acme.orders.domain.port.outbound.OrderRepository
✅ com.acme.orders.application.usecase.CreateOrderUseCase
✅ com.acme.orders.infrastructure.persistence.OrderJpaEntity
✅ com.acme.orders.infrastructure.messaging.OrderEventPublisher
✅ com.acme.orders.api.event.OrderCreatedEvent
```

---

## 4. Java 21+ Language Standards

### 4.1 Records for Value Objects and DTOs

```java
// ✅ Value objects as records — immutable, self-validating
public record OrderId(String value) {
    public OrderId {
        Objects.requireNonNull(value, "OrderId must not be null");
        if (value.isBlank()) throw new IllegalArgumentException("OrderId must not be blank");
        if (!value.matches("^[a-zA-Z0-9\\-]{8,64}$"))
            throw new IllegalArgumentException("OrderId format invalid: " + value);
    }

    public static OrderId generate() {
        return new OrderId(UUID.randomUUID().toString());
    }

    public static OrderId of(String value) {
        return new OrderId(value);
    }

    @Override
    public String toString() {
        return value; // Intentional: value object prints as value
    }
}

// ✅ Money — critical value object with arithmetic safety
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount required");
        Objects.requireNonNull(currency, "currency required");
        if (amount.compareTo(BigDecimal.ZERO) < 0)
            throw new IllegalArgumentException("Money cannot be negative: " + amount);
        // Normalize scale at construction — prevents equality bugs
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN);
    }

    public static Money of(String amount, String currencyCode) {
        return new Money(new BigDecimal(amount), Currency.getInstance(currencyCode));
    }

    public static Money zero(Currency currency) {
        return new Money(BigDecimal.ZERO, currency);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(this.amount.add(other.amount), this.currency);
    }

    public Money subtract(Money other) {
        requireSameCurrency(other);
        Money result = new Money(this.amount.subtract(other.amount), this.currency);
        // Business rule: cannot go negative in most contexts
        // Do NOT enforce here — that's domain logic, not value object logic
        return result;
    }

    public boolean isGreaterThan(Money other) {
        requireSameCurrency(other);
        return this.amount.compareTo(other.amount) > 0;
    }

    private void requireSameCurrency(Money other) {
        if (!this.currency.equals(other.currency))
            throw new IllegalArgumentException(
                "Currency mismatch: %s vs %s".formatted(this.currency, other.currency));
    }
}
```

### 4.2 Sealed Classes for Domain Modeling

```java
// ✅ Model outcomes as sealed types — compiler enforces exhaustive handling
// Never use boolean flags or nullable returns to signal different outcomes

public sealed interface OrderResult
    permits OrderResult.Created,
            OrderResult.Rejected,
            OrderResult.AlreadyExists,
            OrderResult.InsufficientInventory {

    record Created(Order order) implements OrderResult {}

    record Rejected(String reason, OrderId orderId) implements OrderResult {}

    record AlreadyExists(OrderId orderId, Instant originalCreatedAt) implements OrderResult {}

    record InsufficientInventory(
        ProductId productId,
        int requested,
        int available
    ) implements OrderResult {}
}

// ✅ Caller MUST handle all cases — no runtime surprises
OrderResult result = createOrderUseCase.execute(command);
String response = switch (result) {
    case OrderResult.Created(var order) ->
        "Order %s created".formatted(order.getId());
    case OrderResult.AlreadyExists(var id, var createdAt) ->
        "Order already exists since %s".formatted(createdAt);
    case OrderResult.Rejected(var reason, var id) ->
        "Rejected: " + reason;
    case OrderResult.InsufficientInventory(var pid, var req, var avail) ->
        "Only %d of %d available for product %s".formatted(avail, req, pid);
};

// ✅ Same pattern for event processing outcomes
public sealed interface EventProcessingResult
    permits EventProcessingResult.Processed,
            EventProcessingResult.Skipped,
            EventProcessingResult.Failed {

    record Processed(String eventId, Duration processingTime) implements EventProcessingResult {}
    record Skipped(String eventId, String reason) implements EventProcessingResult {}
    record Failed(String eventId, String errorCode, boolean retryable) implements EventProcessingResult {}
}
```

### 4.3 Pattern Matching

```java
// ✅ Pattern matching for type-safe dispatch — eliminate instanceof chains
public BigDecimal calculateDiscount(Customer customer, Order order) {
    return switch (customer) {
        case PremiumCustomer p when p.loyaltyYears() > 5 && order.isAbove(Money.of("500", "USD"))
            -> LOYALTY_PREMIUM_DISCOUNT;
        case PremiumCustomer p when p.loyaltyYears() > 5
            -> LOYALTY_DISCOUNT;
        case PremiumCustomer p
            -> PREMIUM_DISCOUNT;
        case CorporateCustomer c when c.hasActiveContract()
            -> c.contractedDiscountRate();
        case StandardCustomer s when s.lifetimeOrderCount() > 50
            -> VOLUME_DISCOUNT;
        case StandardCustomer s
            -> BigDecimal.ZERO;
    };
}

// ✅ Deconstruction patterns for nested records
public String describeEvent(DomainEvent event) {
    return switch (event) {
        case OrderCreated(var id, var customerId, var lines, var total, var ts)
            when total.isGreaterThan(Money.of("1000", "USD"))
            -> "High-value order %s for customer %s".formatted(id, customerId);
        case OrderCreated(var id, var customerId, var lines, var total, var ts)
            -> "Order %s created".formatted(id);
        case OrderCancelled(var id, var reason, var ts)
            -> "Order %s cancelled: %s".formatted(id, reason);
        default -> "Unknown event: " + event.getClass().getSimpleName();
    };
}
```

### 4.4 Structured Concurrency

```java
// ✅ StructuredTaskScope — concurrent fan-out with unified lifecycle
// All subtasks are cancelled if ANY fails (ShutdownOnFailure)
// All subtasks are cancelled when FIRST succeeds (ShutdownOnSuccess — for hedging)

@Service
public class OrderEnrichmentService {

    public EnrichedOrder enrich(OrderId orderId) throws InterruptedException {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {

            // Fork all concurrent fetches
            Subtask<Order> orderTask =
                scope.fork(() -> orderRepository.findByIdOrThrow(orderId));

            Subtask<CustomerProfile> customerTask =
                scope.fork(() -> customerPort.getProfile(orderId));

            Subtask<List<ProductDetail>> productsTask =
                scope.fork(() -> productPort.getDetailsForOrder(orderId));

            Subtask<ShippingEstimate> shippingTask =
                scope.fork(() -> shippingPort.estimateForOrder(orderId));

            // Block until all complete or any fails
            scope.join()           // waits for completion
                 .throwIfFailed(); // rethrows first exception, cancels rest

            // All subtasks guaranteed to be in SUCCESS state here
            return EnrichedOrder.of(
                orderTask.get(),
                customerTask.get(),
                productsTask.get(),
                shippingTask.get()
            );

        } catch (ExecutionException e) {
            throw new OrderEnrichmentException(
                "Failed to enrich order " + orderId, e.getCause());
        }
    }

    // ✅ Hedging with ShutdownOnSuccess — call multiple replicas, use fastest
    public PricingResult getPricingWithHedging(ProductId productId) throws InterruptedException {
        try (var scope = new StructuredTaskScope.ShutdownOnSuccess<PricingResult>()) {
            scope.fork(() -> primaryPricingService.getPrice(productId));
            scope.fork(() -> secondaryPricingService.getPrice(productId)); // hedge
            scope.join();
            return scope.result();
        } catch (ExecutionException e) {
            throw new PricingUnavailableException(productId, e.getCause());
        }
    }
}
```

### 4.5 ScopedValue (Java 21+) over ThreadLocal

```java
// ❌ AVOID: ThreadLocal leaks with virtual threads and can be misused
static final ThreadLocal<RequestContext> CONTEXT = new ThreadLocal<>();

// ✅ PREFER: ScopedValue — immutable, auto-cleaned, virtual-thread-safe
public final class RequestContextHolder {
    public static final ScopedValue<RequestContext> CURRENT =
        ScopedValue.newInstance();

    private RequestContextHolder() {} // utility class
}

// Setting a scoped value — it exists only within the lambda scope
public void handleRequest(HttpRequest request) {
    RequestContext ctx = RequestContext.from(request);

    ScopedValue.where(RequestContextHolder.CURRENT, ctx).run(() -> {
        // All code called within this scope sees the context
        processRequest(request);
        // Automatically cleaned up when scope exits — no leak possible
    });
}

// Reading the scoped value — anywhere in the call stack
public void someDeepMethod() {
    RequestContext ctx = RequestContextHolder.CURRENT.get(); // safe, always set here
    log.info("Processing request", kv("traceId", ctx.traceId()));
}
```

### 4.6 Text Blocks and String Templates

```java
// ✅ Text blocks for multi-line strings (SQL, JSON templates, messages)
String auditMessage = """
    {
      "action": "%s",
      "resourceId": "%s",
      "actor": "%s",
      "timestamp": "%s"
    }
    """.formatted(action, resourceId, actor, timestamp);

// ✅ String templates (Java 21 preview, Java 23 stable)
// Use formatted() as safe alternative until templates are stable:
String errorMessage = "Order %s failed validation: %s (field: %s)"
    .formatted(orderId, violation.getMessage(), violation.getField());
```

---

## 5. Virtual Threads — Deep Rules

### 5.1 Configuration

```java
// ✅ Spring Boot 3.2+ — enable virtual threads globally
// application.yml:
// spring.threads.virtual.enabled: true

// ✅ Manual configuration for non-Spring contexts
@Configuration
public class VirtualThreadConfig {

    // For Tomcat
    @Bean
    public TomcatProtocolHandlerCustomizer<?> virtualThreadTomcat() {
        return handler ->
            handler.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    }

    // For async task execution
    @Bean(name = "applicationTaskExecutor")
    public AsyncTaskExecutor asyncExecutor() {
        return new TaskExecutorAdapter(
            Executors.newVirtualThreadPerTaskExecutor());
    }

    // For scheduled tasks — use platform threads (virtual threads don't benefit here)
    @Bean
    public TaskScheduler scheduledTaskExecutor() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("scheduler-");
        return scheduler;
    }
}
```

### 5.2 Pin Risk — Mandatory Audit Rules

```java
// ─── RULE: Any synchronized block on a virtual thread PINS the carrier thread ───
// This turns a virtual thread into a platform thread, defeating the purpose.
// Every synchronized block must be replaced before merging.

// ❌ FORBIDDEN — pins carrier thread
public synchronized OrderSummary computeSummary(Order order) {
    return calculator.compute(order);
}

// ✅ REQUIRED — ReentrantLock is virtual-thread safe (it unmounts during park)
private final ReentrantLock computeLock = new ReentrantLock();

public OrderSummary computeSummary(Order order) {
    computeLock.lock();
    try {
        return calculator.compute(order);
    } finally {
        computeLock.unlock();
    }
}

// ❌ FORBIDDEN — synchronized method on shared instance
public class PricingCache {
    private final Map<ProductId, Money> cache = new HashMap<>();
    public synchronized Money get(ProductId id) { return cache.get(id); }
    public synchronized void put(ProductId id, Money price) { cache.put(id, price); }
}

// ✅ REQUIRED — use concurrent data structures
public class PricingCache {
    private final ConcurrentHashMap<ProductId, Money> cache = new ConcurrentHashMap<>();
    public Money get(ProductId id) { return cache.get(id); }
    public void put(ProductId id, Money price) { cache.put(id, price); }
    public Money computeIfAbsent(ProductId id, Function<ProductId, Money> loader) {
        return cache.computeIfAbsent(id, loader);
    }
}

// ⚠️ AUDIT: JNI/native calls also pin carrier threads
// ⚠️ AUDIT: Some JDBC drivers use synchronized internally — test under load
// ⚠️ AUDIT: synchronized(this) patterns in legacy libraries pulled via dependency

// ✅ DETECTION: JVM flags to log pinning events during testing
// -Djdk.tracePinnedThreads=full
// -Djdk.tracePinnedThreads=short
```

### 5.3 Thread Pool Anti-Patterns with Virtual Threads

```java
// ❌ WRONG: Thread pool limiting defeats virtual thread purpose
ExecutorService pool = Executors.newFixedThreadPool(200); // Don't do this for VT

// ✅ CORRECT: Unbounded virtual thread executor
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

// ❌ WRONG: Semaphore emulation via thread pool
ExecutorService limitedPool = Executors.newFixedThreadPool(10); // "10 concurrent DB calls"

// ✅ CORRECT: Use Semaphore explicitly for concurrency limiting
// Virtual threads handle the I/O wait; Semaphore limits concurrency
private final Semaphore dbConcurrencyLimit = new Semaphore(10);

public <T> T withDbConcurrencyLimit(Callable<T> task) throws Exception {
    dbConcurrencyLimit.acquire(); // virtual thread unmounts here if permits exhausted
    try {
        return task.call();
    } finally {
        dbConcurrencyLimit.release();
    }
}

// ✅ CORRECT: Named virtual threads for debugging
Thread.ofVirtual()
    .name("order-processor-", 0) // auto-numbered: order-processor-0, order-processor-1, ...
    .start(() -> processOrder(orderId));
```

### 5.4 Connection Pool Sizing for Virtual Threads

```java
// ✅ With virtual threads, I/O wait is cheap — but DB connections are still scarce
// Connection pool size = function of DB capacity, NOT of virtual thread count

// HikariCP — size for DB throughput, not for thread count
spring:
  datasource:
    hikari:
      maximum-pool-size: 50      # Sized for DB, not for VT count
      minimum-idle: 10
      connection-timeout: 2000   # 2s — fail fast
      idle-timeout: 600000
      max-lifetime: 1800000
      keepalive-time: 30000
      # Virtual threads will park while waiting for a connection
      # This is correct behaviour — they unmount efficiently

// ✅ MongoDB connection pool — same principle
spring:
  data:
    mongodb:
      uri: ${MONGODB_URI}
      # connection pool tuned for MongoDB's capacity
```

---

## 6. Resiliency Patterns — First-Class Citizen

### 6.1 The Resiliency Stack (Apply in Order)

```
Every outbound call MUST be wrapped in this stack — no exceptions:

 ┌─────────────────────────────────────────────────┐
 │  1. RateLimiter  (protect external SLAs)        │
 │  2. CircuitBreaker (stop calling failing deps)  │
 │  3. Retry  (handle transient failures)          │
 │  4. Bulkhead  (isolate failure domains)         │
 │  5. TimeLimiter  (bound worst-case latency)     │
 └─────────────────────────────────────────────────┘
         ↓
   External Service / DB / Queue

RULE: Inner timeout (TimeLimiter) < Outer timeout (caller's SLA)
RULE: Retry count × max wait < Circuit breaker window
RULE: Every resiliency config is named and externalized — never hardcoded
```

### 6.2 Resilience4j Configuration — Full Template

```yaml
# application.yml
resilience4j:

  # ── Circuit Breaker ──────────────────────────────────────────────────────────
  circuitbreaker:
    configs:
      default:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 20
        minimum-number-of-calls: 10
        failure-rate-threshold: 50           # Open at 50% failure rate
        slow-call-rate-threshold: 80         # Also open on slow calls
        slow-call-duration-threshold: 2s
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 5
        automatic-transition-from-open-to-half-open-enabled: true
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - java.net.ConnectException
          - org.springframework.web.client.ResourceAccessException
        ignore-exceptions:
          - com.acme.domain.NotFoundException       # Business errors — don't count
          - com.acme.domain.ValidationException     # Client errors — don't count
    instances:
      payment-service:
        base-config: default
        wait-duration-in-open-state: 60s     # Payments need longer recovery window
      inventory-service:
        base-config: default
      notification-service:
        base-config: default
        failure-rate-threshold: 80           # Less critical — tolerate more failures

  # ── Retry ────────────────────────────────────────────────────────────────────
  retry:
    configs:
      default:
        max-attempts: 3
        wait-duration: 300ms
        exponential-backoff-multiplier: 2.0
        exponential-max-wait-duration: 10s
        retry-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - java.net.ConnectException
        ignore-exceptions:
          - com.acme.domain.DomainException   # Never retry business errors
          - java.lang.IllegalArgumentException
    instances:
      payment-service:
        base-config: default
        max-attempts: 2              # Payments: fewer retries, risk of double-charge
      inventory-service:
        base-config: default
      notification-service:
        base-config: default
        max-attempts: 5              # Notifications: more retries, less risk

  # ── Bulkhead ─────────────────────────────────────────────────────────────────
  bulkhead:
    configs:
      default:
        max-concurrent-calls: 20
        max-wait-duration: 50ms     # Fail fast rather than queue up
    instances:
      payment-service:
        max-concurrent-calls: 10    # Payments limited — protect payment provider
      inventory-service:
        max-concurrent-calls: 25
      notification-service:
        max-concurrent-calls: 50    # High tolerance — notifications are async

  # ── Time Limiter ─────────────────────────────────────────────────────────────
  timelimiter:
    configs:
      default:
        timeout-duration: 3s
        cancel-running-future: true
    instances:
      payment-service:
        timeout-duration: 5s        # Payments need more time
      inventory-service:
        timeout-duration: 2s
      notification-service:
        timeout-duration: 1s

  # ── Rate Limiter ─────────────────────────────────────────────────────────────
  ratelimiter:
    instances:
      payment-gateway-api:
        limit-for-period: 50
        limit-refresh-period: 1s
        timeout-duration: 500ms
      email-provider-api:
        limit-for-period: 100
        limit-refresh-period: 1s
        timeout-duration: 200ms
```

### 6.3 Resilience4j — Implementation Patterns

```java
// ✅ PATTERN A: Annotation-based (preferred for simple cases)
@Service
@RequiredArgsConstructor
public class InventoryAdapter implements InventoryPort {

    private final InventoryHttpClient client;
    private final MeterRegistry meterRegistry;

    @CircuitBreaker(name = "inventory-service", fallbackMethod = "checkInventoryFallback")
    @Retry(name = "inventory-service")
    @Bulkhead(name = "inventory-service", type = Bulkhead.Type.SEMAPHORE)
    @TimeLimiter(name = "inventory-service")
    public CompletableFuture<InventoryStatus> checkInventory(ProductId productId) {
        return CompletableFuture.supplyAsync(
            () -> client.check(productId.value()),
            Executors.newVirtualThreadPerTaskExecutor()
        );
    }

    // RULE: Fallback MUST have identical signature + Throwable as last parameter
    // RULE: Fallback MUST NOT throw — always return a safe default
    // RULE: Log the degradation + increment a metric
    private CompletableFuture<InventoryStatus> checkInventoryFallback(
            ProductId productId, Throwable ex) {

        meterRegistry.counter("inventory.fallback.activations",
            "reason", ex.getClass().getSimpleName()).increment();

        log.warn("Inventory service degraded for product {}, returning UNKNOWN status",
            productId.value(), ex);

        // Degrade gracefully: return UNKNOWN (caller decides how to handle)
        // NEVER return fake "available" — that could oversell
        return CompletableFuture.completedFuture(InventoryStatus.UNKNOWN);
    }
}

// ✅ PATTERN B: Programmatic (use for complex chaining or conditional logic)
@Service
public class PaymentAdapter implements PaymentPort {

    private final CircuitBreaker circuitBreaker;
    private final Retry retry;
    private final Bulkhead bulkhead;
    private final TimeLimiter timeLimiter;
    private final RateLimiter rateLimiter;
    private final ScheduledExecutorService scheduler;

    public PaymentAdapter(
            CircuitBreakerRegistry cbRegistry,
            RetryRegistry retryRegistry,
            BulkheadRegistry bulkheadRegistry,
            TimeLimiterRegistry tlRegistry,
            RateLimiterRegistry rlRegistry) {
        this.circuitBreaker = cbRegistry.circuitBreaker("payment-service");
        this.retry = retryRegistry.retry("payment-service");
        this.bulkhead = bulkheadRegistry.bulkhead("payment-service");
        this.timeLimiter = tlRegistry.timeLimiter("payment-service");
        this.rateLimiter = rlRegistry.rateLimiter("payment-gateway-api");
        this.scheduler = Executors.newSingleThreadScheduledExecutor();

        // Register event listeners for observability
        circuitBreaker.getEventPublisher()
            .onStateTransition(event ->
                log.warn("Circuit breaker [payment-service] state: {} → {}",
                    event.getStateTransition().getFromState(),
                    event.getStateTransition().getToState()));
    }

    @Override
    public PaymentResult charge(PaymentCommand command) {
        // Stack: RateLimit → CircuitBreaker → Retry → Bulkhead → TimeLimiter → call
        Callable<PaymentResult> decorated =
            RateLimiter.decorateCallable(rateLimiter,
                CircuitBreaker.decorateCallable(circuitBreaker,
                    Retry.decorateCallable(retry,
                        Bulkhead.decorateCallable(bulkhead,
                            TimeLimiter.decorateCallable(timeLimiter, scheduler,
                                () -> paymentClient.charge(command))))));

        return Try.of(decorated::call)
            .recover(CallNotPermittedException.class, ex -> {
                log.warn("Payment circuit breaker OPEN for order {}",
                    command.orderId());
                throw new PaymentServiceUnavailableException(command.orderId());
            })
            .recover(BulkheadFullException.class, ex -> {
                log.warn("Payment bulkhead FULL for order {}", command.orderId());
                throw new PaymentServiceOverloadedException(command.orderId());
            })
            .getOrElseThrow(ex -> new PaymentException(command.orderId(), ex));
    }
}
```

### 6.4 Idempotency — Universal Pattern

```java
// ✅ Idempotency store — pluggable (Redis, DB, in-memory for tests)
public interface IdempotencyStore {
    /**
     * Returns true if this key has already been processed.
     * Implementations must be thread-safe.
     */
    boolean isAlreadyProcessed(String key);

    /**
     * Marks key as processed with a TTL.
     * Must be atomic with the preceding business operation where possible.
     */
    void markProcessed(String key, Duration ttl);

    /**
     * Retrieve the stored result for an already-processed key, if available.
     */
    <T> Optional<T> getStoredResult(String key, Class<T> type);

    /**
     * Store result alongside the processed marker.
     */
    <T> void markProcessedWithResult(String key, T result, Duration ttl);
}

// ✅ Idempotency decorator — wrap any use case
@Component
public class IdempotentCommandExecutor {

    private final IdempotencyStore store;

    public <C extends IdempotentCommand, R> R execute(
            C command, Function<C, R> handler, Class<R> resultType) {

        String key = buildKey(command);

        Optional<R> existing = store.getStoredResult(key, resultType);
        if (existing.isPresent()) {
            log.info("Idempotent replay for key {}: returning stored result", key);
            return existing.get();
        }

        R result = handler.apply(command);
        store.markProcessedWithResult(key, result, command.idempotencyTtl());
        return result;
    }

    private String buildKey(IdempotentCommand command) {
        // Format: {service}:{operation}:{clientKey}
        return "%s:%s:%s".formatted(
            command.serviceId(),
            command.operationName(),
            command.idempotencyKey()
        );
    }
}

// ✅ Idempotent command interface
public interface IdempotentCommand {
    String idempotencyKey();
    String serviceId();
    String operationName();
    default Duration idempotencyTtl() { return Duration.ofHours(24); }
}

// ✅ Usage in application layer
@UseCase
public class CreateOrderUseCase {

    private final IdempotentCommandExecutor idempotencyExecutor;
    private final OrderRepository orderRepository;
    private final EventPublisher eventPublisher;

    public OrderResult execute(CreateOrderCommand command) {
        return idempotencyExecutor.execute(
            command,
            this::doCreateOrder,
            OrderResult.class
        );
    }

    private OrderResult doCreateOrder(CreateOrderCommand command) {
        // Safe to assume this runs exactly once
        Order order = Order.create(command);
        orderRepository.save(order);
        eventPublisher.publish(OrderDomainEvent.OrderCreated.from(order));
        return new OrderResult.Created(order);
    }
}
```

### 6.5 Timeout Hierarchy — Strict Enforcement

```java
// ✅ Document timeout hierarchy explicitly — inner < outer always
/**
 * Timeout hierarchy for Order Creation:
 *
 *   HTTP Gateway (10s)                    ← outer boundary
 *     └── CreateOrder handler (8s)        ← service timeout
 *           ├── Inventory check (2s)      ← Resilience4j TimeLimiter
 *           │     └── HTTP call (1.5s)    ← HTTP client socket timeout
 *           └── Payment charge (5s)       ← Resilience4j TimeLimiter
 *                 └── HTTP call (4s)      ← HTTP client socket timeout
 *
 * RULE: Each child timeout < parent timeout (leave headroom for retries)
 * RULE: TimeLimiter timeout > HTTP client timeout (gives HTTP chance to fail cleanly)
 */
@Configuration
public class HttpClientConfig {

    @Bean("inventoryHttpClient")
    public HttpClient inventoryHttpClient() {
        return HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(500))
            .version(HttpClient.Version.HTTP_2)
            .executor(Executors.newVirtualThreadPerTaskExecutor())
            .build();
        // Socket read timeout set per-request:
        // request.timeout(Duration.ofMillis(1500))
    }

    @Bean("paymentHttpClient")
    public HttpClient paymentHttpClient() {
        return HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(1000))
            .version(HttpClient.Version.HTTP_2)
            .executor(Executors.newVirtualThreadPerTaskExecutor())
            .build();
    }
}
```

### 6.6 Graceful Degradation Catalog

```java
// ✅ Catalog of degraded responses — one per service dependency
// These are returned from fallback methods

public final class DegradedResponses {

    // Inventory: unknown is safe — caller should treat as "check later"
    public static InventoryStatus degradedInventory() {
        return InventoryStatus.UNKNOWN;
    }

    // Pricing: cached or default pricing — never block an order
    public static PriceResult degradedPrice(ProductId productId) {
        return PriceResult.fromCache(productId)
            .orElse(PriceResult.catalogPrice(productId)); // fallback to catalog
    }

    // Notification: queue locally — retry async, don't fail the business op
    public static NotificationResult degradedNotification(String userId, String message) {
        localRetryQueue.enqueue(new PendingNotification(userId, message));
        return NotificationResult.QUEUED_FOR_RETRY;
    }

    // Recommendations: empty list is safe — UI handles gracefully
    public static List<ProductRecommendation> degradedRecommendations() {
        return List.of(); // empty is safe
    }

    // ❌ NEVER degrade payment status to "approved" — safety > availability
    // Payment fallback should ALWAYS throw PaymentServiceUnavailableException
}
```

---

## 7. Domain Modeling Standards

### 7.1 Aggregate Root Pattern

```java
// ✅ Aggregate root — controls all mutations, enforces invariants, records events
public class Order {

    // ── Identity ──────────────────────────────────────────────────────────────
    private final OrderId id;

    // ── State ─────────────────────────────────────────────────────────────────
    private final CustomerId customerId;
    private OrderStatus status;
    private final List<OrderLine> lines;
    private Money totalAmount;
    private final Instant createdAt;
    private Instant updatedAt;

    // ── Versioning (optimistic lock) ──────────────────────────────────────────
    private long version;

    // ── Domain Events (transient — not persisted) ─────────────────────────────
    private final List<DomainEvent> domainEvents = new ArrayList<>();

    // ── Factory method — ONLY way to create (no public constructor) ───────────
    public static Order create(CreateOrderCommand command) {
        validateCreateCommand(command);

        List<OrderLine> lines = command.lines().stream()
            .map(OrderLine::from)
            .toList();

        Money total = lines.stream()
            .map(OrderLine::lineTotal)
            .reduce(Money.zero(command.currency()), Money::add);

        Order order = new Order(
            OrderId.generate(),
            command.customerId(),
            OrderStatus.PENDING,
            lines,
            total,
            Instant.now()
        );

        // Record the event — don't publish it here (infrastructure concern)
        order.domainEvents.add(OrderCreatedEvent.from(order));
        return order;
    }

    // ── Domain Operations — enforce business invariants ───────────────────────
    public void confirm() {
        requireStatus(OrderStatus.PENDING, "confirm");
        this.status = OrderStatus.CONFIRMED;
        this.updatedAt = Instant.now();
        domainEvents.add(new OrderConfirmedEvent(this.id, Instant.now()));
    }

    public void cancel(CancellationReason reason) {
        if (status == OrderStatus.FULFILLED || status == OrderStatus.SHIPPED) {
            throw new InvalidOrderStateTransitionException(
                id, status, OrderStatus.CANCELLED,
                "Cannot cancel an order that has been fulfilled or shipped");
        }
        this.status = OrderStatus.CANCELLED;
        this.updatedAt = Instant.now();
        domainEvents.add(new OrderCancelledEvent(this.id, reason, Instant.now()));
    }

    public void addLine(OrderLine line) {
        requireStatus(OrderStatus.PENDING, "add line");
        if (lines.size() >= 100) {
            throw new OrderLineLimitExceededException(id, 100);
        }
        lines.add(line);
        this.totalAmount = totalAmount.add(line.lineTotal());
        this.updatedAt = Instant.now();
    }

    // ── Event collection — consumed by repository after save ─────────────────
    public List<DomainEvent> pollDomainEvents() {
        List<DomainEvent> events = List.copyOf(domainEvents);
        domainEvents.clear();
        return events;
    }

    // ── Private helpers ───────────────────────────────────────────────────────
    private void requireStatus(OrderStatus required, String operation) {
        if (this.status != required) {
            throw new InvalidOrderStateTransitionException(
                id, this.status, required,
                "Operation '%s' requires status %s".formatted(operation, required));
        }
    }

    private static void validateCreateCommand(CreateOrderCommand command) {
        Objects.requireNonNull(command.customerId(), "customerId required");
        if (command.lines() == null || command.lines().isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one line");
        }
        if (command.lines().size() > 100) {
            throw new IllegalArgumentException("Order cannot have more than 100 lines");
        }
    }

    // ── Reconstitution (used by repository adapter only) ──────────────────────
    // Package-private or via static factory — prevents misuse
    static Order reconstitute(OrderId id, CustomerId customerId, OrderStatus status,
                               List<OrderLine> lines, Money total, Instant createdAt,
                               long version) {
        return new Order(id, customerId, status, lines, total, createdAt, version);
    }
}
```

### 7.2 Domain Event Design

```java
// ✅ Domain events — immutable, versioned, self-describing, no behaviour
public sealed interface DomainEvent
    permits OrderCreatedEvent, OrderConfirmedEvent, OrderCancelledEvent,
            OrderFulfilledEvent, PaymentProcessedEvent {

    String eventId();
    String aggregateId();
    String aggregateType();
    Instant occurredAt();
    int schemaVersion();
}

// ✅ Concrete event — all fields required, no nulls
public record OrderCreatedEvent(
    String eventId,
    String aggregateId,
    String aggregateType,
    String customerId,
    List<OrderLineSnapshot> lines,
    MoneySnapshot totalAmount,
    Instant occurredAt,
    int schemaVersion
) implements DomainEvent {

    // Canonical constructor validates invariants
    public OrderCreatedEvent {
        Objects.requireNonNull(eventId, "eventId required");
        Objects.requireNonNull(aggregateId, "aggregateId required");
        Objects.requireNonNull(customerId, "customerId required");
        Objects.requireNonNull(lines, "lines required");
        if (lines.isEmpty()) throw new IllegalArgumentException("Event lines must not be empty");
        Objects.requireNonNull(totalAmount, "totalAmount required");
        Objects.requireNonNull(occurredAt, "occurredAt required");
        schemaVersion = 1; // Hard-pin — bump when schema changes
        lines = List.copyOf(lines); // Defensive copy
    }

    public static OrderCreatedEvent from(Order order) {
        return new OrderCreatedEvent(
            UUID.randomUUID().toString(),
            order.getId().value(),
            "Order",
            order.getCustomerId().value(),
            order.getLines().stream().map(OrderLineSnapshot::from).toList(),
            MoneySnapshot.from(order.getTotalAmount()),
            Instant.now(),
            1
        );
    }
}
```

### 7.3 Repository Interface — Pure Domain Contract

```java
// ✅ Repository interface lives in domain.port.outbound — no infrastructure imports
public interface OrderRepository {

    // Queries — return Optional, never null
    Optional<Order> findById(OrderId orderId);
    Optional<Order> findByIdempotencyKey(String idempotencyKey);

    // Queries — return empty list, never null
    List<Order> findByCustomerAndStatus(CustomerId customerId, OrderStatus status);
    List<Order> findPendingOlderThan(Instant threshold, int maxResults);

    // Existence check — cheaper than findById + isPresent
    boolean existsById(OrderId orderId);

    // Mutations
    Order save(Order order);

    // Soft delete — domain preference over physical delete
    void markDeleted(OrderId orderId, String deletedBy, Instant deletedAt);
}
```

---

## 8. Event-Driven Architecture Patterns

### 8.1 Outbox Pattern — Guaranteed Event Delivery

```java
// ✅ Outbox entity — persisted in same transaction as business data
// This is the ONLY safe way to guarantee events are published

@Entity
@Table(name = "outbox_events", indexes = {
    @Index(name = "idx_outbox_status_created", columnList = "status, created_at"),
    @Index(name = "idx_outbox_aggregate", columnList = "aggregate_id, aggregate_type")
})
public class OutboxEvent {

    @Id
    private String id;

    @Column(nullable = false)
    private String aggregateId;

    @Column(nullable = false)
    private String aggregateType;

    @Column(nullable = false)
    private String eventType;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OutboxStatus status = OutboxStatus.PENDING;

    @Column(nullable = false)
    private Instant createdAt;

    @Column
    private Instant processedAt;

    @Column
    private int retryCount = 0;

    @Column
    private String lastError;

    @Column
    private Instant nextRetryAt;

    public enum OutboxStatus { PENDING, PROCESSING, PUBLISHED, DEAD }
}

// ✅ Domain event publisher — writes to outbox, NOT to message broker directly
@Component
@RequiredArgsConstructor
public class OutboxEventPublisher implements DomainEventPublisher {

    private final OutboxRepository outboxRepository;
    private final ObjectMapper objectMapper;

    /**
     * CRITICAL: This must be called within the same transaction as the business operation.
     * The outbox record is atomically committed with the aggregate state.
     * The actual broker publish happens asynchronously by OutboxPoller.
     */
    @Override
    public void publish(DomainEvent event) {
        try {
            OutboxEvent outboxEvent = OutboxEvent.builder()
                .id(UUID.randomUUID().toString())
                .aggregateId(event.aggregateId())
                .aggregateType(event.aggregateType())
                .eventType(event.getClass().getSimpleName())
                .payload(objectMapper.writeValueAsString(event))
                .status(OutboxStatus.PENDING)
                .createdAt(Instant.now())
                .nextRetryAt(Instant.now())
                .build();

            outboxRepository.save(outboxEvent);

        } catch (JsonProcessingException e) {
            throw new EventSerializationException(
                "Cannot serialize event %s for aggregate %s"
                    .formatted(event.getClass().getSimpleName(), event.aggregateId()), e);
        }
    }
}

// ✅ Outbox poller — publishes pending events to the broker
@Component
@RequiredArgsConstructor
@Slf4j
public class OutboxPoller {

    private final OutboxRepository outboxRepository;
    private final MessageBrokerPublisher brokerPublisher;
    private final MeterRegistry meterRegistry;

    private static final int BATCH_SIZE = 100;
    private static final int MAX_RETRIES = 5;

    @Scheduled(fixedDelay = 500, initialDelay = 1000) // Every 500ms
    @Transactional
    public void pollAndPublish() {
        List<OutboxEvent> pending = outboxRepository
            .findPendingBatch(Instant.now(), BATCH_SIZE);

        for (OutboxEvent event : pending) {
            publishWithRetryTracking(event);
        }
    }

    private void publishWithRetryTracking(OutboxEvent event) {
        try {
            // Optimistic lock: mark PROCESSING to prevent duplicate publish across instances
            outboxRepository.markProcessing(event.getId());

            brokerPublisher.publish(event);

            outboxRepository.markPublished(event.getId(), Instant.now());
            meterRegistry.counter("outbox.published",
                "event_type", event.getEventType()).increment();

        } catch (OptimisticLockException e) {
            // Another instance is processing this event — skip
            log.debug("Skipping event {} — already being processed by another instance",
                event.getId());

        } catch (Exception e) {
            int retries = event.getRetryCount() + 1;
            OutboxStatus newStatus = retries >= MAX_RETRIES
                ? OutboxStatus.DEAD
                : OutboxStatus.PENDING;

            Instant nextRetry = Instant.now().plus(
                Duration.ofSeconds((long) Math.pow(2, retries))); // exponential backoff

            outboxRepository.markRetry(event.getId(), retries, newStatus, e.getMessage(), nextRetry);

            if (newStatus == OutboxStatus.DEAD) {
                meterRegistry.counter("outbox.dead_letter",
                    "event_type", event.getEventType()).increment();
                log.error("Event {} moved to DEAD status after {} retries",
                    event.getId(), retries, e);
                // Alert: page on-call — dead events may need manual replay
            } else {
                log.warn("Event {} publish failed, retry {}/{}, next attempt: {}",
                    event.getId(), retries, MAX_RETRIES, nextRetry, e);
            }
        }
    }

    // ✅ Dead letter replay — for operational recovery
    @Transactional
    public int replayDeadEvents(String eventType, int maxCount) {
        List<OutboxEvent> dead = outboxRepository.findDeadByType(eventType, maxCount);
        dead.forEach(e -> outboxRepository.resetForRetry(e.getId()));
        log.info("Reset {} dead events of type {} for replay", dead.size(), eventType);
        return dead.size();
    }
}
```

### 8.2 Event Consumer — Exactly-Once Processing

```java
// ✅ Event consumer — idempotent, structured error handling, DLQ-aware
@Component
@RequiredArgsConstructor
@Slf4j
public class OrderCreatedEventConsumer {

    private final IdempotencyStore idempotencyStore;
    private final ReserveInventoryUseCase reserveInventoryUseCase;
    private final MeterRegistry meterRegistry;

    /**
     * Contract:
     *  - Return normally  → message ACKed
     *  - Throw RetryableException → message NACKed (requeued by broker)
     *  - Throw NonRetryableException → message ACKed + sent to DLQ by broker config
     */
    public void onOrderCreated(ConsumedMessage<OrderCreatedEvent> message) {
        String messageId = message.id();
        OrderCreatedEvent event = message.payload();
        String idempotencyKey = "order-created-consumer:" + messageId;

        Timer.Sample sample = Timer.start(meterRegistry);

        try (var ignored = MDC.putCloseable("traceId", event.eventId())) {
            // ── Idempotency check ───────────────────────────────────────────
            if (idempotencyStore.isAlreadyProcessed(idempotencyKey)) {
                log.info("Duplicate message {}, skipping", messageId);
                meterRegistry.counter("consumer.duplicate_skipped",
                    "event_type", "OrderCreated").increment();
                return; // Safe to return — idempotent
            }

            // ── Schema version routing ──────────────────────────────────────
            EventProcessingResult result = switch (event.schemaVersion()) {
                case 1 -> processV1(event);
                case 2 -> processV2(event);
                default -> {
                    log.warn("Unknown schema version {} for OrderCreated — skipping",
                        event.schemaVersion());
                    yield new EventProcessingResult.Skipped(event.eventId(),
                        "unknown schema version " + event.schemaVersion());
                }
            };

            // ── Mark processed AFTER successful handling ────────────────────
            idempotencyStore.markProcessed(idempotencyKey, Duration.ofDays(7));

            sample.stop(meterRegistry.timer("consumer.processing.duration",
                "event_type", "OrderCreated", "result", result.getClass().getSimpleName()));

        } catch (DomainException e) {
            // Business rule violation — do NOT retry
            log.error("Non-retryable error processing OrderCreated {}: {}",
                event.eventId(), e.getMessage());
            meterRegistry.counter("consumer.non_retryable_error",
                "event_type", "OrderCreated").increment();
            throw new NonRetryableException("Business rule violation", e);

        } catch (TransientInfrastructureException e) {
            // DB down, network error — retry
            log.warn("Transient error processing OrderCreated {}, will retry",
                event.eventId(), e);
            meterRegistry.counter("consumer.transient_error",
                "event_type", "OrderCreated").increment();
            throw new RetryableException("Transient failure", e);
        }
    }

    private EventProcessingResult processV1(OrderCreatedEvent event) {
        ReserveInventoryCommand command = ReserveInventoryCommand.from(event);
        reserveInventoryUseCase.execute(command);
        return new EventProcessingResult.Processed(event.eventId(), Duration.ZERO);
    }

    private EventProcessingResult processV2(OrderCreatedEvent event) {
        // Handle v2-specific fields
        return processV1(event); // backward compat for now
    }
}
```

### 8.3 Event Schema Evolution

```
╔══════════════════════════════════════════════════════════════════════╗
║              EVENT SCHEMA EVOLUTION CONTRACT                         ║
╠══════════════════════════════════════════════════════════════════════╣
║ ALLOWED (non-breaking):                                              ║
║   ✅ Add new OPTIONAL fields with defaults                           ║
║   ✅ Add new event types                                             ║
║   ✅ Deprecate fields (keep them, mark @Deprecated)                  ║
║   ✅ Widen field types (int → long)                                  ║
║                                                                      ║
║ FORBIDDEN (breaking):                                                ║
║   ❌ Remove or rename existing fields                                ║
║   ❌ Change field types (narrowing or semantically different)        ║
║   ❌ Change the meaning/semantics of an existing field               ║
║   ❌ Reuse an event type name with a different schema               ║
║   ❌ Change the ordering key / partition strategy                    ║
║                                                                      ║
║ PROCESS FOR BREAKING CHANGES:                                        ║
║   1. Publish new event type (e.g., OrderCreatedV2)                  ║
║   2. Publish BOTH old and new events during migration window         ║
║   3. Migrate all consumers to new event type                        ║
║   4. Remove old event type (with deprecation notice and timeline)    ║
║                                                                      ║
║ schemaVersion field is MANDATORY on every event                      ║
║ Consumers MUST handle: current version AND all previous versions     ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 8.4 Dead Letter Queue (DLQ) Strategy

```java
// ✅ DLQ handler — operational recovery, not ignored
@Component
@RequiredArgsConstructor
@Slf4j
public class DeadLetterQueueProcessor {

    private final DlqEventRepository dlqRepository;
    private final AlertingService alerting;
    private final MeterRegistry meterRegistry;

    /**
     * Called when a message is routed to the DLQ by the broker.
     * Responsibilities:
     *   1. Persist the message for later replay or investigation
     *   2. Alert the on-call team
     *   3. Never silently discard
     */
    public void onDeadLetter(ConsumedMessage<?> message, String failureReason) {
        DlqEvent dlqEvent = DlqEvent.builder()
            .messageId(message.id())
            .topic(message.source())
            .payload(message.rawPayload())
            .headers(message.headers())
            .failureReason(failureReason)
            .receivedAt(message.publishedAt())
            .deadLetteredAt(Instant.now())
            .status(DlqStatus.PENDING_REVIEW)
            .build();

        dlqRepository.save(dlqEvent);

        meterRegistry.counter("dlq.received", "topic", message.source()).increment();

        log.error("Message {} from topic {} sent to DLQ: {}",
            message.id(), message.source(), failureReason);

        // Alert — DLQ events require human review
        alerting.notify(Alert.critical(
            "DLQ event received",
            "topic=%s messageId=%s reason=%s".formatted(
                message.source(), message.id(), failureReason)
        ));
    }

    // ✅ Replay endpoint — for operations team
    @Transactional
    public ReplayResult replay(String messageId) {
        DlqEvent event = dlqRepository.findById(messageId)
            .orElseThrow(() -> new NotFoundException("DLQ event not found: " + messageId));

        // Re-publish to original topic for normal processing
        brokerPublisher.republish(event.getTopic(), event.getPayload(), event.getHeaders());
        dlqRepository.markReplayed(messageId, Instant.now());

        log.info("DLQ event {} replayed to topic {}", messageId, event.getTopic());
        return ReplayResult.success(messageId);
    }
}
```

---

## 9. Concurrency Patterns

### 9.1 CompletableFuture — Correct Patterns

```java
// ✅ Always use virtual thread executor with CompletableFuture
private static final Executor VT_EXECUTOR =
    Executors.newVirtualThreadPerTaskExecutor();

// ✅ Fan-out with independent failures handled
public CompletableFuture<OrderSummary> buildOrderSummary(OrderId orderId) {
    CompletableFuture<Order> orderFuture =
        CompletableFuture.supplyAsync(() -> orderRepo.findByIdOrThrow(orderId), VT_EXECUTOR);

    CompletableFuture<Customer> customerFuture =
        CompletableFuture.supplyAsync(() -> customerService.get(orderId), VT_EXECUTOR)
            .exceptionally(ex -> {
                log.warn("Customer fetch failed for order {}, using degraded", orderId);
                return Customer.unknown(); // Degrade gracefully
            });

    return orderFuture
        .thenCombine(customerFuture, (order, customer) ->
            OrderSummary.of(order, customer))
        .orTimeout(3, TimeUnit.SECONDS)          // Always bound the future
        .exceptionally(ex -> {
            if (ex instanceof TimeoutException) {
                throw new OrderSummaryTimeoutException(orderId);
            }
            throw new OrderSummaryException(orderId, ex);
        });
}

// ✅ Correct use of allOf — collect results safely
public List<EnrichedProduct> enrichProducts(List<ProductId> productIds) {
    List<CompletableFuture<EnrichedProduct>> futures = productIds.stream()
        .map(id -> CompletableFuture.supplyAsync(
            () -> productEnricher.enrich(id), VT_EXECUTOR)
            .orTimeout(2, TimeUnit.SECONDS)
            .exceptionally(ex -> EnrichedProduct.degraded(id))) // Partial failure OK
        .toList();

    // allOf completes when ALL futures complete (including degraded ones)
    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

    return futures.stream()
        .map(CompletableFuture::join) // Safe — allOf guarantees completion
        .toList();
}

// ❌ FORBIDDEN: Never call .get() without timeout
future.get(); // Blocks forever if something hangs

// ✅ REQUIRED: Always bound with timeout
future.get(3, TimeUnit.SECONDS); // Or use .orTimeout()
```

### 9.2 Rate Limiting with Semaphore + Virtual Threads

```java
// ✅ Concurrency limiter — virtual threads park efficiently on Semaphore
@Component
public class ConcurrencyLimitedHttpClient {

    private final Semaphore concurrencyLimit;
    private final HttpClient httpClient;
    private final MeterRegistry meterRegistry;

    public ConcurrencyLimitedHttpClient(
            @Value("${http.client.max-concurrent:20}") int maxConcurrent) {
        this.concurrencyLimit = new Semaphore(maxConcurrent, true); // fair
        this.httpClient = HttpClient.newBuilder()
            .executor(Executors.newVirtualThreadPerTaskExecutor())
            .build();
    }

    public <T> T execute(HttpRequest request, HttpResponse.BodyHandler<T> responseHandler) {
        long waitStart = System.nanoTime();
        try {
            if (!concurrencyLimit.tryAcquire(500, TimeUnit.MILLISECONDS)) {
                meterRegistry.counter("http.client.concurrency_limit_exceeded").increment();
                throw new ConcurrencyLimitExceededException(
                    "Concurrency limit reached, try again later");
            }

            long waitMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - waitStart);
            meterRegistry.timer("http.client.semaphore.wait")
                .record(waitMs, TimeUnit.MILLISECONDS);

            return httpClient.send(request, responseHandler).body();

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RequestInterruptedException(e);
        } finally {
            concurrencyLimit.release();
        }
    }
}
```

---

## 10. Error Handling Strategy

### 10.1 Exception Hierarchy

```java
// ✅ Exception taxonomy — every exception has a place and a purpose

// Root of domain exceptions — all are RuntimeException (unchecked)
public abstract class DomainException extends RuntimeException {
    private final String errorCode;
    private final Map<String, Object> context;

    protected DomainException(String errorCode, String message, Map<String, Object> context) {
        super(message);
        this.errorCode = errorCode;
        this.context = Map.copyOf(context);
    }

    protected DomainException(String errorCode, String message) {
        this(errorCode, message, Map.of());
    }

    public String getErrorCode() { return errorCode; }
    public Map<String, Object> getContext() { return context; }
}

// ── Domain / Business errors (4xx in HTTP terms) ──────────────────────────────
public final class OrderNotFoundException extends DomainException {
    public OrderNotFoundException(OrderId id) {
        super("ORDER_NOT_FOUND", "Order %s not found".formatted(id.value()),
            Map.of("orderId", id.value()));
    }
}

public final class InvalidOrderStateTransitionException extends DomainException {
    public InvalidOrderStateTransitionException(
            OrderId id, OrderStatus from, OrderStatus to, String reason) {
        super("INVALID_STATE_TRANSITION",
            "Cannot transition order %s from %s to %s: %s"
                .formatted(id.value(), from, to, reason),
            Map.of("orderId", id.value(), "fromState", from, "toState", to));
    }
}

public final class InsufficientInventoryException extends DomainException {
    public InsufficientInventoryException(ProductId id, int requested, int available) {
        super("INSUFFICIENT_INVENTORY",
            "Product %s: requested %d, available %d"
                .formatted(id.value(), requested, available),
            Map.of("productId", id.value(), "requested", requested, "available", available));
    }
}

// ── Infrastructure errors (5xx in HTTP terms) ─────────────────────────────────
public abstract class InfrastructureException extends RuntimeException {
    private final boolean retryable;
    protected InfrastructureException(String message, boolean retryable, Throwable cause) {
        super(message, cause);
        this.retryable = retryable;
    }
    public boolean isRetryable() { return retryable; }
}

public final class PaymentServiceUnavailableException extends InfrastructureException {
    public PaymentServiceUnavailableException(OrderId orderId) {
        super("Payment service unavailable for order " + orderId.value(), true, null);
    }
}

public final class EventPublicationException extends InfrastructureException {
    public EventPublicationException(String eventType, Throwable cause) {
        super("Failed to publish event: " + eventType, true, cause);
    }
}
```

### 10.2 Exception Handling — Never Swallow, Never Over-Catch

```java
// ✅ Rules for exception handling

// RULE 1: Never catch Exception or Throwable broadly
// ❌ FORBIDDEN
try {
    processOrder(command);
} catch (Exception e) {
    log.error("Something went wrong");  // Context lost, rethrowing lost
}

// ✅ REQUIRED: Catch what you can handle
try {
    processOrder(command);
} catch (OrderNotFoundException e) {
    return OrderResult.NotFound.of(e.getContext());
} catch (InsufficientInventoryException e) {
    return OrderResult.InsufficientInventory.of(e.getContext());
} catch (PaymentServiceUnavailableException e) {
    // Infrastructure failure — propagate, let resiliency layer handle
    throw e;
}

// RULE 2: Always add context when re-throwing
// ❌ FORBIDDEN
} catch (Exception e) {
    throw new RuntimeException(e); // Context lost
}

// ✅ REQUIRED
} catch (Exception e) {
    throw new OrderProcessingException(
        "Failed to process order %s at payment step".formatted(orderId), e);
}

// RULE 3: Log at the boundary, not in every layer
// Log ONCE at the entry point (controller, consumer) — not in every service
// Exception propagates with context; layers add context, don't log repeatedly

// RULE 4: Interrupted exceptions — always restore interrupt flag
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt(); // Restore interrupt status
    throw new ProcessingInterruptedException("Processing interrupted", e);
}
```

---

## 11. Observability & Operability

### 11.1 Structured Logging — Every Log Line is a Data Point

```java
// ✅ Every log line must be queryable — treat logs as structured data
// Use logstash-logback-encoder or equivalent JSON appender

// ✅ MDC enrichment filter — runs on every request
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ObservabilityFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest httpReq = (HttpServletRequest) req;

        // Propagate or generate trace context
        String traceId = Optional.ofNullable(httpReq.getHeader("traceparent"))
            .or(() -> Optional.ofNullable(httpReq.getHeader("X-Request-ID")))
            .orElse(UUID.randomUUID().toString().replace("-", ""));

        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);

        MDC.put("traceId", traceId);
        MDC.put("spanId", spanId);
        MDC.put("service", applicationName);
        MDC.put("version", applicationVersion);

        try {
            chain.doFilter(req, res);
        } finally {
            MDC.clear();
        }
    }
}

// ✅ Business event logging — explicit, structured
private void logOrderCreated(Order order, Duration processingTime) {
    // Use StructuredArguments from logstash-logback-encoder
    log.info("Order created",
        kv("event", "ORDER_CREATED"),
        kv("orderId", order.getId().value()),
        kv("customerId", mask(order.getCustomerId().value())), // PII masked
        kv("lineCount", order.getLines().size()),
        kv("totalAmountCents", order.getTotalAmount().toCents()),
        kv("currency", order.getTotalAmount().currency().getCurrencyCode()),
        kv("processingTimeMs", processingTime.toMillis())
    );
}

// ✅ Log level contract
// ERROR — requires immediate human action (pager)
// WARN  — unexpected but handled; investigate next business day
// INFO  — significant business events (order created, payment processed, job completed)
// DEBUG — diagnostic details; disabled in production
// TRACE — never in production

// ✅ What NEVER appears in logs
// ❌ Full credit card numbers, CVVs
// ❌ Passwords, tokens, API keys
// ❌ Personal data (full name, email, phone, address) — only masked IDs
// ❌ Stack traces at INFO or WARN level — only at ERROR
```

### 11.2 Metrics — Business + Technical

```java
// ✅ Metrics registration — domain-aware naming
@Component
@RequiredArgsConstructor
public class OrderServiceMetrics {

    private static final String TAG_SERVICE = "service";
    private static final String TAG_EVENT_TYPE = "event_type";
    private static final String TAG_RESULT = "result";

    private final Counter ordersCreated;
    private final Counter orderCreationFailed;
    private final Timer orderCreationDuration;
    private final DistributionSummary orderValueDistribution;
    private final Gauge pendingOrdersGauge;

    public OrderServiceMetrics(MeterRegistry registry, OrderRepository orderRepository) {
        this.ordersCreated = Counter.builder("business.orders.created.total")
            .description("Total orders successfully created")
            .tag(TAG_SERVICE, "order-service")
            .register(registry);

        this.orderCreationFailed = Counter.builder("business.orders.creation_failed.total")
            .description("Total order creation failures")
            .tag(TAG_SERVICE, "order-service")
            .register(registry);

        this.orderCreationDuration = Timer.builder("business.orders.creation.duration")
            .description("End-to-end order creation latency")
            .publishPercentiles(0.50, 0.90, 0.95, 0.99)
            .publishPercentileHistogram()
            .register(registry);

        this.orderValueDistribution = DistributionSummary.builder("business.orders.value.cents")
            .description("Distribution of order values in cents")
            .publishPercentiles(0.50, 0.75, 0.95, 0.99)
            .register(registry);

        // Gauge: sampled lazily when Prometheus scrapes
        this.pendingOrdersGauge = Gauge.builder("business.orders.pending.count",
                orderRepository, repo -> repo.countByStatus(OrderStatus.PENDING))
            .description("Current number of pending orders")
            .register(registry);
    }

    public void recordOrderCreated(Order order, Duration duration) {
        ordersCreated.increment();
        orderCreationDuration.record(duration);
        orderValueDistribution.record(order.getTotalAmount().toCents());
    }

    public void recordOrderCreationFailed(String failureReason) {
        orderCreationFailed.increment(
            Tags.of("reason", failureReason));
    }
}
```

### 11.3 Health Check — Readiness vs Liveness

```java
// ✅ Readiness: "Am I ready to receive traffic?"
// Fails: dependencies unavailable, warmup incomplete, circuit breakers open
@Component("readiness")
public class ServiceReadinessIndicator implements HealthIndicator {

    private final DataSource dataSource;
    private final CircuitBreakerRegistry cbRegistry;
    private final MessageBrokerHealthChecker brokerHealth;

    @Override
    public Health health() {
        Map<String, Object> details = new LinkedHashMap<>();
        boolean allHealthy = true;

        // Check DB connectivity
        try {
            dataSource.getConnection().isValid(1);
            details.put("database", "UP");
        } catch (Exception e) {
            details.put("database", "DOWN: " + e.getMessage());
            allHealthy = false;
        }

        // Check message broker
        if (!brokerHealth.isConnected()) {
            details.put("messageBroker", "DOWN");
            allHealthy = false;
        } else {
            details.put("messageBroker", "UP");
        }

        // Circuit breakers — open CB means we can't serve traffic reliably
        long openBreakers = cbRegistry.getAllCircuitBreakers().stream()
            .filter(cb -> cb.getState() == CircuitBreaker.State.OPEN)
            .peek(cb -> details.put("circuitBreaker." + cb.getName(), "OPEN"))
            .count();

        if (openBreakers > 0) allHealthy = false;

        return allHealthy
            ? Health.up().withDetails(details).build()
            : Health.down().withDetails(details).build();
    }
}

// ✅ Liveness: "Am I alive, or should Kubernetes restart me?"
// Only fails: deadlock detected, OOM imminent, catastrophic state corruption
// DO NOT add external dependency checks here — that would cause restart loops
@Component("liveness")
public class ServiceLivenessIndicator implements HealthIndicator {

    private final ThreadMXBean threadMXBean = ManagementFactory.getThreadMXBean();

    @Override
    public Health health() {
        long[] deadlockedThreads = threadMXBean.findDeadlockedThreads();
        if (deadlockedThreads != null && deadlockedThreads.length > 0) {
            return Health.down()
                .withDetail("deadlockedThreads", deadlockedThreads.length)
                .build();
        }
        return Health.up().build();
    }
}
```

---

## 12. Testing Standards

### 12.1 Test Pyramid

```
Unit Tests       (60–70%)   Fast · No I/O · Domain logic only · <10ms each
Integration Tests (20–30%)  Real infrastructure via Testcontainers · <5s each
Contract Tests    (~5%)     Pact consumer-driven contracts for events and APIs
E2E Tests         (~5%)     Full service via HTTP against a deployed staging env

RULE: Never mock what you can Testcontainer
RULE: Unit tests test domain logic — not framework plumbing
RULE: A failing integration test cannot be "fixed" by changing a mock
```

### 12.2 Domain Unit Tests — No Spring, No Mocks of Domain

```java
// ✅ Pure domain tests — fastest, most valuable
class OrderTest {

    @Test
    @DisplayName("Creating an order calculates total from line items")
    void shouldCalculateTotalFromLines() {
        var command = CreateOrderCommand.builder()
            .customerId(CustomerId.of("cust-1"))
            .idempotencyKey("key-abc-123")
            .currency(Currency.getInstance("USD"))
            .lines(List.of(
                OrderLineCommand.of(ProductId.of("p1"), "Widget", 2,
                    Money.of("10.00", "USD")),
                OrderLineCommand.of(ProductId.of("p2"), "Gadget", 3,
                    Money.of("5.00", "USD"))))
            .build();

        Order order = Order.create(command);

        assertThat(order.getTotalAmount())
            .isEqualTo(Money.of("35.00", "USD")); // 2×10 + 3×5
        assertThat(order.getStatus()).isEqualTo(OrderStatus.PENDING);
        assertThat(order.getId()).isNotNull();
        assertThat(order.pollDomainEvents())
            .hasSize(1)
            .first().isInstanceOf(OrderCreatedEvent.class);
    }

    @Test
    @DisplayName("Cancelling a shipped order throws InvalidOrderStateTransitionException")
    void shouldRejectCancellationOfShippedOrder() {
        Order order = OrderFixtures.aShippedOrder();

        assertThatThrownBy(order::cancel)
            .isInstanceOf(InvalidOrderStateTransitionException.class)
            .satisfies(ex -> {
                var domainEx = (InvalidOrderStateTransitionException) ex;
                assertThat(domainEx.getErrorCode()).isEqualTo("INVALID_STATE_TRANSITION");
                assertThat(domainEx.getContext()).containsKey("fromState");
            });
    }

    @Test
    @DisplayName("Order with >100 lines should throw on addLine")
    void shouldEnforceMaxLineLimit() {
        Order order = OrderFixtures.anOrderWithNLines(100);
        OrderLine extraLine = OrderLineFixtures.aLine();

        assertThatThrownBy(() -> order.addLine(extraLine))
            .isInstanceOf(OrderLineLimitExceededException.class);
    }
}
```

### 12.3 Application Layer Tests — Mock Infrastructure Ports

```java
// ✅ Application / use case tests — mock PORTS not IMPLEMENTATIONS
@ExtendWith(MockitoExtension.class)
class CreateOrderUseCaseTest {

    @Mock private OrderRepository orderRepository;
    @Mock private InventoryPort inventoryPort;
    @Mock private DomainEventPublisher eventPublisher;
    @Mock private IdempotencyStore idempotencyStore;

    @InjectMocks private CreateOrderUseCase useCase;

    @Test
    @DisplayName("Successfully creates order when inventory available")
    void shouldCreateOrderWhenInventoryAvailable() {
        // Arrange
        var command = CreateOrderCommandFixtures.aValidCommand();
        given(idempotencyStore.isAlreadyProcessed(any())).willReturn(false);
        given(inventoryPort.checkAvailability(any()))
            .willReturn(InventoryStatus.AVAILABLE);
        given(orderRepository.save(any()))
            .willAnswer(inv -> inv.getArgument(0)); // Return what was saved

        // Act
        OrderResult result = useCase.execute(command);

        // Assert
        assertThat(result).isInstanceOf(OrderResult.Created.class);
        then(orderRepository).should().save(argThat(order ->
            order.getStatus() == OrderStatus.PENDING &&
            order.getCustomerId().value().equals(command.customerId().value())
        ));
        then(eventPublisher).should().publish(any(OrderCreatedEvent.class));
        then(idempotencyStore).should().markProcessed(any(), eq(Duration.ofHours(24)));
    }

    @Test
    @DisplayName("Returns AlreadyExists for duplicate idempotency key")
    void shouldReturnAlreadyExistsForDuplicateKey() {
        var command = CreateOrderCommandFixtures.aValidCommand();
        given(idempotencyStore.isAlreadyProcessed(any())).willReturn(true);
        given(idempotencyStore.getStoredResult(any(), eq(OrderResult.class)))
            .willReturn(Optional.of(new OrderResult.Created(OrderFixtures.aPendingOrder())));

        OrderResult result = useCase.execute(command);

        assertThat(result).isInstanceOf(OrderResult.Created.class);
        then(orderRepository).shouldHaveNoInteractions();
        then(eventPublisher).shouldHaveNoInteractions();
    }
}
```

### 12.4 Architecture Enforcement Tests — ArchUnit

```java
// ✅ Enforce hexagonal architecture via ArchUnit — fails the build if violated
@AnalyzeClasses(packages = "com.acme.orders")
class ArchitectureTest {

    @ArchTest
    static final ArchRule domainHasNoFrameworkDeps =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage(
                "org.springframework..",
                "jakarta.persistence..",
                "org.springframework.data.."
            )
            .as("Domain layer must have zero framework dependencies");

    @ArchTest
    static final ArchRule infrastructureDoesNotLeakIntoDomain =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAPackage("..infrastructure..")
            .as("Domain must not depend on infrastructure");

    @ArchTest
    static final ArchRule controllersOnlyDependOnApplicationLayer =
        classes()
            .that().resideInAPackage("..infrastructure.http.inbound..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage(
                "..application..",
                "..api..",
                "..domain.model..",
                "org.springframework.web..",
                "java..",
                "jakarta.."
            )
            .as("Controllers must only use application layer use cases");

    @ArchTest
    static final ArchRule noDirectInstantiationOfServices =
        noClasses()
            .that().resideInAPackage("..infrastructure..")
            .should().instantiateClassesThat()
            .resideInAPackage("..application.usecase..")
            .as("Use cases should only be obtained via dependency injection");
}
```

### 12.5 Integration Tests — Testcontainers

```java
// ✅ Integration test base — shared container lifecycle
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("integration-test")
abstract class IntegrationTestBase {

    @Container
    static final PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test")
            .withReuse(true); // Reuse across test runs for speed

    @Container
    static final GenericContainer<?> redis =
        new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379)
            .withReuse(true);

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port",
            () -> redis.getMappedPort(6379).toString());
    }
}

// ✅ Resiliency integration test
class CircuitBreakerIntegrationTest extends IntegrationTestBase {

    @Autowired private InventoryAdapter inventoryAdapter;
    @Autowired private CircuitBreakerRegistry cbRegistry;

    @RegisterExtension
    static WireMockExtension wireMock = WireMockExtension.newInstance()
        .options(wireMockConfig().dynamicPort())
        .build();

    @Test
    @DisplayName("Circuit breaker opens after failure threshold and returns fallback")
    void shouldOpenCircuitBreakerAndReturnFallback() {
        wireMock.stubFor(get(urlPathMatching("/inventory/.*"))
            .willReturn(serverError()));

        // Trigger enough failures to open the circuit
        for (int i = 0; i < 15; i++) {
            try {
                inventoryAdapter.checkInventory(ProductId.of("p" + i)).get(2, SECONDS);
            } catch (Exception ignored) {}
        }

        CircuitBreaker cb = cbRegistry.circuitBreaker("inventory-service");
        assertThat(cb.getState())
            .as("Circuit should be open after 50%+ failures")
            .isEqualTo(CircuitBreaker.State.OPEN);

        // Fallback should be returned — not an exception
        assertThatCode(() -> {
            InventoryStatus status =
                inventoryAdapter.checkInventory(ProductId.of("new-product")).get(1, SECONDS);
            assertThat(status).isEqualTo(InventoryStatus.UNKNOWN);
        }).doesNotThrowAnyException();

        // Verify no calls made while circuit is open
        wireMock.verify(0, getRequestedFor(urlPathMatching("/inventory/new-product")));
    }
}
```

---

## 13. Security Standards

### 13.1 Input Validation — Boundary Enforcement

```java
// ✅ Validate at the API boundary — before anything reaches domain logic
public record CreateOrderRequest(

    @NotBlank(message = "customerId is required")
    @Size(max = 64, message = "customerId cannot exceed 64 characters")
    @Pattern(regexp = "^[a-zA-Z0-9\\-_]+$", message = "customerId contains invalid characters")
    String customerId,

    @NotEmpty(message = "lines is required and must not be empty")
    @Size(min = 1, max = 100, message = "lines must contain 1–100 items")
    @Valid
    List<OrderLineRequest> lines,

    @NotBlank(message = "idempotencyKey is required")
    @Size(min = 8, max = 64)
    @Pattern(regexp = "^[a-zA-Z0-9\\-_]+$")
    String idempotencyKey,

    @NotNull
    @Pattern(regexp = "^[A-Z]{3}$", message = "currency must be a 3-letter ISO code")
    String currency
) {}

// ✅ Controller — fail at the earliest possible point
@PostMapping("/orders")
@ResponseStatus(HttpStatus.CREATED)
public OrderResponse createOrder(
        @Valid @RequestBody CreateOrderRequest request,
        @RequestHeader(value = "X-Idempotency-Key")
        @NotBlank @Size(max = 64) String idempotencyKey) {
    // Guaranteed: request is structurally valid if we reach here
}
```

### 13.2 Secrets Management

```java
// ✅ NEVER in code or config files:
// ❌ database passwords
// ❌ API keys for payment providers, email, SMS
// ❌ JWT signing secrets
// ❌ Message broker credentials

// ✅ Secrets injected via environment variables sourced from a secrets manager
// application.yml:
// spring.datasource.password: ${DB_PASSWORD}  ← set from Vault/AWS Secrets/GCP SM

// ✅ Fail fast if secrets are missing — never start with partial config
@PostConstruct
public void validateSecrets() {
    String dbPassword = environment.getProperty("spring.datasource.password");
    if (dbPassword == null || dbPassword.isBlank()) {
        throw new IllegalStateException(
            "FATAL: DB_PASSWORD not configured — refusing to start");
    }
}
```

### 13.3 PII Handling

```java
// ✅ PII never travels beyond the service that owns it
// ✅ Events carry only IDs — recipients fetch details if needed

// ❌ WRONG: Event with PII
record OrderCreatedEvent(String orderId, String customerEmail, String phoneNumber, ...) {}

// ✅ CORRECT: Event with only identifiers
record OrderCreatedEvent(String orderId, String customerId, ...) {}
// Notification service receives the event, fetches email itself using customerId

// ✅ Masking utility for logs and error messages
public final class DataMasker {
    public static String maskEmail(String email) {
        if (email == null) return null;
        int at = email.indexOf('@');
        if (at <= 1) return "****";
        return email.substring(0, 1) + "***" + email.substring(at);
    }

    public static String maskId(String id) {
        if (id == null || id.length() < 6) return "****";
        return id.substring(0, 4) + "****" + id.substring(id.length() - 2);
    }

    public static String maskCardNumber(String cardNumber) {
        if (cardNumber == null || cardNumber.length() < 4) return "****";
        return "**** **** **** " + cardNumber.substring(cardNumber.length() - 4);
    }
}
```

---

## 14. API Design Standards

### 14.1 REST Controller Template

```java
// ✅ Controller is THIN — orchestration only, zero business logic
@RestController
@RequestMapping("/api/v1/orders")
@Validated
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Orders", description = "Order lifecycle management")
public class OrderController {

    private final CreateOrderUseCase createOrderUseCase;
    private final GetOrderUseCase getOrderUseCase;
    private final OrderDtoMapper mapper;
    private final OrderServiceMetrics metrics;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a new order")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Order created"),
        @ApiResponse(responseCode = "400", description = "Validation error"),
        @ApiResponse(responseCode = "409", description = "Duplicate idempotency key"),
        @ApiResponse(responseCode = "422", description = "Business rule violation"),
        @ApiResponse(responseCode = "503", description = "Downstream service unavailable")
    })
    public OrderResponse createOrder(
            @Valid @RequestBody CreateOrderRequest request,
            @RequestHeader("X-Idempotency-Key")
            @NotBlank @Pattern(regexp = "^[a-zA-Z0-9\\-_]{8,64}$")
            String idempotencyKey) {

        Timer.Sample sample = Timer.start();
        try {
            CreateOrderCommand command = mapper.toCommand(request, idempotencyKey);
            OrderResult result = createOrderUseCase.execute(command);

            return switch (result) {
                case OrderResult.Created(var order) -> {
                    metrics.recordOrderCreated(order, sample.stop());
                    yield mapper.toResponse(order);
                }
                case OrderResult.AlreadyExists(var id, var ts) ->
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Order already created at " + ts);
                case OrderResult.Rejected(var reason, var id) ->
                    throw new BusinessRuleViolationException(reason);
                case OrderResult.InsufficientInventory(var pid, var req, var avail) ->
                    throw new BusinessRuleViolationException(
                        "Insufficient inventory for product " + pid);
            };

        } catch (PaymentServiceUnavailableException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Order processing unavailable, please retry");
        }
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "Get order by ID")
    public ResponseEntity<OrderResponse> getOrder(
            @PathVariable @NotBlank @Size(max = 64) String orderId) {
        return getOrderUseCase.execute(OrderId.of(orderId))
            .map(mapper::toResponse)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
}
```

### 14.2 Global Exception Handler

```java
// ✅ One place for HTTP error mapping — consistent response schema everywhere
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    // Validation errors (400)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidation(MethodArgumentNotValidException ex) {
        List<FieldViolation> violations = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new FieldViolation(fe.getField(), fe.getDefaultMessage(),
                String.valueOf(fe.getRejectedValue())))
            .toList();
        return ErrorResponse.validation(violations);
    }

    // Domain business errors (422)
    @ExceptionHandler(DomainException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ErrorResponse handleDomain(DomainException ex) {
        log.info("Domain rule violation: {} - {}", ex.getErrorCode(), ex.getMessage());
        return ErrorResponse.domain(ex.getErrorCode(), ex.getMessage());
    }

    // Not found (404)
    @ExceptionHandler({OrderNotFoundException.class})
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleNotFound(DomainException ex) {
        return ErrorResponse.domain(ex.getErrorCode(), ex.getMessage());
    }

    // Infrastructure unavailable (503)
    @ExceptionHandler(InfrastructureException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public ErrorResponse handleInfrastructure(InfrastructureException ex,
                                               HttpServletRequest request) {
        String traceId = MDC.get("traceId");
        log.error("Infrastructure failure on {} {}, traceId={}",
            request.getMethod(), request.getRequestURI(), traceId, ex);
        return ErrorResponse.infrastructure("SERVICE_UNAVAILABLE",
            "Service temporarily unavailable. Reference: " + traceId);
    }

    // Catch-all (500) — log fully, expose nothing
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleUnexpected(Exception ex, HttpServletRequest request) {
        String traceId = MDC.get("traceId");
        log.error("Unhandled exception on {} {}, traceId={}",
            request.getMethod(), request.getRequestURI(), traceId, ex);
        return ErrorResponse.infrastructure("INTERNAL_ERROR",
            "Unexpected error. Reference: " + traceId);
    }
}

// ✅ Consistent error response record
public record ErrorResponse(
    String errorCode,
    String message,
    List<FieldViolation> fieldViolations,
    Instant timestamp,
    String traceId
) {
    public record FieldViolation(String field, String message, String rejectedValue) {}

    public static ErrorResponse validation(List<FieldViolation> violations) {
        return new ErrorResponse("VALIDATION_ERROR", "Request validation failed",
            violations, Instant.now(), MDC.get("traceId"));
    }

    public static ErrorResponse domain(String code, String message) {
        return new ErrorResponse(code, message, null, Instant.now(), MDC.get("traceId"));
    }

    public static ErrorResponse infrastructure(String code, String message) {
        return new ErrorResponse(code, message, null, Instant.now(), MDC.get("traceId"));
    }
}
```

### 14.3 API Versioning

```
RULE: Version in URL path — /api/v1/, /api/v2/
RULE: Never break an existing version
RULE: Run two versions in parallel during migrations
RULE: Deprecation lifecycle: announce → 3-month warning header → remove
RULE: Add Deprecation and Sunset headers when version is end-of-life

// Spring: add Deprecation header via ResponseBodyAdvice when detected
response.setHeader("Deprecation", "true");
response.setHeader("Sunset", "Sat, 01 Jun 2025 00:00:00 GMT");
response.setHeader("Link", "</api/v2/orders>; rel=\"successor-version\"");
```

---

## 15. Configuration Management

### 15.1 application.yml — Canonical Baseline

```yaml
spring:
  application:
    name: ${SERVICE_NAME:my-service}
  threads:
    virtual:
      enabled: true                         # Java 21 virtual threads
  lifecycle:
    timeout-per-shutdown-phase: 30s         # Grace period for in-flight requests

server:
  port: 8080
  shutdown: graceful                        # Drain connections before shutdown
  tomcat:
    connection-timeout: 5s
    threads:
      max: 4                                # Platform threads minimal — VT handles concurrency
      min-spare: 2

management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus, loggers
  endpoint:
    health:
      show-details: when-authorized
      probes:
        enabled: true                       # /actuator/health/readiness + /liveness
      group:
        readiness:
          include: db, broker, diskSpace
        liveness:
          include: ping
  metrics:
    tags:
      service: ${spring.application.name}
      environment: ${ENVIRONMENT:local}
  tracing:
    sampling:
      probability: ${TRACING_SAMPLE_RATE:0.1}

logging:
  level:
    root: INFO
    com.acme: ${APP_LOG_LEVEL:INFO}
    org.springframework.web: WARN
  pattern:
    console: "%d{ISO8601} %-5level [%X{traceId}] %logger{36} - %msg%n"
  # In production, use JSON appender (logstash-logback-encoder)

# ── Resilience4j ── (see Section 6.2 for full config) ───────────────────────────

# ── Service-specific feature flags ──────────────────────────────────────────────
features:
  idempotency:
    enabled: true
    ttl: 24h
  outbox:
    enabled: true
    poll-interval-ms: 500
    batch-size: 100
  circuit-breaker:
    enabled: ${CB_ENABLED:true}            # Allow disabling in tests
```

### 15.2 Environment Variable Contract

```
REQUIRED (service will refuse to start without these):
  DB_URL            — JDBC URL or connection string
  DB_PASSWORD       — never in config files
  BROKER_URL        — message broker connection string
  BROKER_PASSWORD   — never in config files
  SERVICE_NAME      — for metrics and logging

OPTIONAL (have safe defaults):
  ENVIRONMENT         (default: local)
  APP_LOG_LEVEL       (default: INFO)
  TRACING_SAMPLE_RATE (default: 0.1)
  CB_ENABLED          (default: true)

VALIDATION: @PostConstruct validates all REQUIRED vars exist on startup
```

---

## 16. Build & Dependency Standards

### 16.1 pom.xml Baseline

```xml
<properties>
    <java.version>21</java.version>
    <spring-boot.version>3.3.x</spring-boot.version>
    <resilience4j.version>2.2.0</resilience4j.version>
    <testcontainers.version>1.20.x</testcontainers.version>
    <archunit.version>1.3.x</archunit.version>
    <pact.version>4.6.x</pact.version>
</properties>

<dependencies>
    <!-- ── Core ──────────────────────────────────────────────────────────── -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>

    <!-- ── Resiliency ────────────────────────────────────────────────────── -->
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-spring-boot3</artifactId>
        <version>${resilience4j.version}</version>
    </dependency>
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-micrometer</artifactId>
        <version>${resilience4j.version}</version>
    </dependency>

    <!-- ── Observability ─────────────────────────────────────────────────── -->
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-tracing-bridge-otel</artifactId>
    </dependency>
    <dependency>
        <groupId>net.logstash.logback</groupId>
        <artifactId>logstash-logback-encoder</artifactId>
        <version>7.4</version>
    </dependency>

    <!-- ── Testing ───────────────────────────────────────────────────────── -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.wiremock</groupId>
        <artifactId>wiremock-standalone</artifactId>
        <version>3.x</version>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>com.tngtech.archunit</groupId>
        <artifactId>archunit-junit5</artifactId>
        <version>${archunit.version}</version>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>au.com.dius.pact.consumer</groupId>
        <artifactId>junit5</artifactId>
        <version>${pact.version}</version>
        <scope>test</scope>
    </dependency>
</dependencies>

<build>
    <plugins>
        <!-- ── Enforce dependency convergence ──────────────────────────── -->
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-enforcer-plugin</artifactId>
            <executions>
                <execution>
                    <id>enforce</id>
                    <goals><goal>enforce</goal></goals>
                    <configuration>
                        <rules>
                            <dependencyConvergence/>
                            <requireJavaVersion>
                                <version>[21,)</version>
                            </requireJavaVersion>
                        </rules>
                    </configuration>
                </execution>
            </executions>
        </plugin>

        <!-- ── Enable preview features if needed ───────────────────────── -->
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <configuration>
                <release>21</release>
                <!-- Uncomment for preview features (ScopedValue, String Templates):
                <compilerArgs>
                    <arg>- -enable-preview</arg>
                </compilerArgs> -->
            </configuration>
        </plugin>
    </plugins>
</build>
```

---

## 17. Anti-Patterns — Forbidden List

Every item below must be caught in code review. PRs containing these are rejected.

### Code Quality

```
❌ Catch Exception or Throwable broadly and swallow silently
❌ Return null from any method (use Optional, empty collections, or throw)
❌ Use Optional.get() without isPresent() — use orElseThrow with context
❌ System.out.println, e.printStackTrace() — use structured logging
❌ Thread.sleep() in business logic — use scheduled tasks or reactive delays
❌ Mutable static fields (non-final statics)
❌ Magic numbers — use named constants with explanatory names
❌ String concatenation in log messages — use structured arguments
❌ @Autowired on fields — use constructor injection only
❌ Business logic in @RestController, @Consumer, or @Scheduled methods
❌ Ignoring CompletableFuture failure callbacks — always handle exceptionally()
❌ Re-throwing without adding context — wrap with message explaining failure point
❌ Catching InterruptedException without restoring the interrupt flag
```

### Concurrency & Virtual Threads

```
❌ synchronized blocks or methods — use ReentrantLock
❌ ThreadLocal for request context — use ScopedValue
❌ Fixed thread pools for I/O tasks — use virtual thread executor
❌ Calling .get() on futures without a timeout — always bound with orTimeout()
❌ Spinning (busy wait) instead of parking — use semaphores or conditions
❌ Shared mutable state without synchronization
```

### Resiliency

```
❌ External calls without a circuit breaker
❌ External calls without a timeout
❌ Retrying non-idempotent operations without idempotency keys
❌ Throwing from a fallback method — always return a safe degraded value
❌ Identical retry and circuit breaker instance names — causes interference
❌ Calling .get() on async operations — defeats virtual thread purpose
❌ Publishing events inside a DB transaction — use Outbox pattern
❌ Swallowing consumer errors with a bare ack — route to DLQ explicitly
```

### Events & Messaging

```
❌ Events with PII (email, phone, address) — carry IDs only
❌ Removing or renaming fields in an existing event schema
❌ Consuming events without idempotency protection
❌ Publishing directly to broker inside a DB transaction (without Outbox)
❌ Acknowledging a message before processing is complete
❌ Using event ordering keys inconsistently across producers
❌ DLQ messages silently discarded — always persist and alert
```

### Security

```
❌ Hardcoded credentials, keys, or passwords anywhere in code
❌ Logging PII (full names, emails, card numbers, passwords)
❌ Trusting client-supplied IDs for authorization without server-side verification
❌ Returning stack traces or internal details to API consumers
❌ Skipping input validation for "internal" endpoints
```

### Architecture

```
❌ Cross-service DB joins or shared DB schemas
❌ Synchronous call chains deeper than 2 hops
❌ Business logic in infrastructure adapters or DTO mappers
❌ Domain exceptions importing framework classes
❌ Aggregate root bypassed — mutating state without going through the root
❌ Repository returning infrastructure entities to the domain layer
```

---

## 18. PR Checklist

Before requesting review, every item must be ✅:

**Resiliency**
- [ ] Every new external call has a named circuit breaker, retry, and timeout
- [ ] Every command handler or event consumer is idempotent
- [ ] Fallback methods do not throw and return safe defaults
- [ ] Timeouts follow the hierarchy (inner < outer)

**Virtual Threads**
- [ ] No `synchronized` blocks introduced (use `ReentrantLock`)
- [ ] No new `ThreadLocal` usage (use `ScopedValue`)
- [ ] CompletableFutures use `Executors.newVirtualThreadPerTaskExecutor()`
- [ ] Every `.get()` on a Future has a timeout

**Events**
- [ ] New events have `schemaVersion` field
- [ ] Event fields are backward-compatible (no removals, no renames)
- [ ] Event consumers use the Outbox pattern for publishing (or explicit justification)
- [ ] DLQ handling is implemented for the new consumer

**Code Quality**
- [ ] No business logic in controllers, adapters, or mappers
- [ ] Domain layer has zero framework imports (`domain/` compiles without Spring)
- [ ] Exceptions include error codes and context maps
- [ ] No PII in log statements
- [ ] No secrets in code or config files

**Testing**
- [ ] Domain logic covered by unit tests (no Spring context)
- [ ] Outbound ports tested with Testcontainers (not just mocks)
- [ ] Circuit breaker fallback explicitly tested
- [ ] ArchUnit tests pass (architecture boundaries not violated)

**Observability**
- [ ] New business operations emit metrics (counter + timer)
- [ ] New service dependencies have health check indicators updated
- [ ] New significant events have INFO-level structured log entries

---

*Template Version: 1.0*
*Stack: Java 21+ · Spring Boot 3.3+ · Resilience4j 2.x · Virtual Threads · Event-Driven*
*Maintained by: Platform Engineering | Review cycle: Quarterly*
*Last reviewed: 2025-Q1*