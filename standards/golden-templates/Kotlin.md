# 🏆 Golden Template: Kotlin · Coroutines · Event-Driven Microservices · Resiliency-First

> **Purpose:** Authoritative engineering standard for AI agents and LLMs generating Kotlin code in this stack.
> Every pattern, snippet, and rule targets Distinguished Engineer–level quality.
> **Immutable law:** When guidelines conflict with convenience, guidelines win.
> **Scope:** Technology-agnostic at the infrastructure layer — patterns apply whether
> you use Kafka, RabbitMQ, AWS SQS, or GCP Pub/Sub; PostgreSQL, MongoDB, or DynamoDB.
> **Kotlin-first:** No Java idioms ported to Kotlin. If it looks like Java written in Kotlin, it is wrong.

---

## Table of Contents

1. [Immutable Principles](#1-immutable-principles)
2. [Kotlin Language Standards](#2-kotlin-language-standards)
3. [Architecture Boundaries](#3-architecture-boundaries)
4. [Project Structure — Hexagonal Architecture](#4-project-structure--hexagonal-architecture)
5. [Coroutines — The Concurrency Model](#5-coroutines--the-concurrency-model)
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

| ID  | Principle                             | Rule                                                                                  |
|-----|---------------------------------------|---------------------------------------------------------------------------------------|
| P01 | **Kotlin-first, always**              | Use Kotlin idioms: data classes, sealed types, extension functions, scope functions    |
| P02 | **Null safety is non-negotiable**     | No `!!` operator anywhere in production code. No `lateinit` without a clear reason    |
| P03 | **Coroutines over threads**           | No `Thread.sleep`, no `Executors`, no `CompletableFuture` — use coroutines            |
| P04 | **Structured concurrency**            | Every coroutine has a parent scope. Orphaned coroutines are bugs                      |
| P05 | **Fail fast, recover gracefully**     | Every external call has an explicit timeout, circuit breaker, and fallback            |
| P06 | **Idempotency by default**            | Every command handler and event consumer is safe to replay                            |
| P07 | **Immutability first**                | `val` over `var`. Immutable collections everywhere. Mutation is explicit and named    |
| P08 | **Explicit over implicit**            | Every timeout, retry, dispatcher, and queue bound is declared — no surprise defaults  |
| P09 | **Structured logging only**           | No `println`, no string concatenation in logs, no unstructured messages               |
| P10 | **Secrets never in code**             | No hardcoded credentials, tokens, or keys anywhere in the codebase                    |
| P11 | **Service owns its data**             | No cross-service database access; data shared only via events or APIs                 |
| P12 | **Events are versioned contracts**    | Schema-versioned, backward-compatible, documented, never silently changed             |
| P13 | **Test behaviour, not mocks**         | Integration tests exercise real infrastructure (Testcontainers) wherever feasible     |
| P14 | **Observability is not optional**     | Every service ships metrics, traces, and structured logs from day one                 |

---

## 2. Kotlin Language Standards

### 2.1 The `!!` Operator — Absolutely Forbidden

```kotlin
// ❌ FORBIDDEN — !! is a runtime NullPointerException waiting to happen
val name = user.name!!
val result = map["key"]!!.process()

// ✅ REQUIRED — be explicit about the null case
val name = user.name ?: throw IllegalStateException("User ${user.id} has no name")

val result = map["key"]
    ?.process()
    ?: throw KeyNotFoundException("Required key not found in map")

// ✅ For collections / optionals — use safe idioms
val first = list.firstOrNull() ?: return emptyResult()
val value = map.getOrElse("key") { computeDefault() }
val safe = nullable?.let { process(it) } ?: fallback()
```

### 2.2 `val` Over `var` — Immutability as Default

```kotlin
// ❌ WRONG — mutable state without justification
var orderId = OrderId.generate()
var total = Money.zero(Currency.USD)
var status = OrderStatus.PENDING

// ✅ CORRECT — immutable by default, mutation is a deliberate operation
val orderId = OrderId.generate()
val total = lines.fold(Money.zero(Currency.USD), Money::add)
val status = OrderStatus.PENDING

// ✅ When mutation IS justified — give it a clear name
private var _status: OrderStatus = OrderStatus.PENDING
// Expose via a function that documents intent:
fun confirm() {
    check(_status == OrderStatus.PENDING) {
        "Cannot confirm order in status $_status"
    }
    _status = OrderStatus.CONFIRMED
}
```

### 2.3 Data Classes — The Domain DTO

```kotlin
// ✅ Data classes for immutable value containers
data class Money(
    val amount: BigDecimal,
    val currency: Currency,
) {
    init {
        require(amount >= BigDecimal.ZERO) { "Money cannot be negative: $amount" }
        // Normalize scale at construction — prevents equality bugs
    }

    // ✅ Copy-on-modify — functional update pattern
    fun add(other: Money): Money {
        require(currency == other.currency) {
            "Currency mismatch: $currency vs ${other.currency}"
        }
        return copy(amount = amount + other.amount)
    }

    fun isGreaterThan(other: Money): Boolean {
        require(currency == other.currency) { "Currency mismatch" }
        return amount > other.amount
    }

    companion object {
        fun of(amount: String, currencyCode: String) =
            Money(BigDecimal(amount), Currency.getInstance(currencyCode))

        fun zero(currency: Currency) = Money(BigDecimal.ZERO, currency)
    }
}

// ✅ Value object wrapper — type safety over primitive obsession
@JvmInline
value class OrderId(val value: String) {
    init {
        require(value.isNotBlank()) { "OrderId must not be blank" }
        require(value.matches(Regex("^[a-zA-Z0-9\\-]{8,64}$"))) {
            "OrderId format invalid: $value"
        }
    }

    companion object {
        fun generate() = OrderId(UUID.randomUUID().toString())
        fun of(value: String) = OrderId(value)
    }

    override fun toString() = value
}

// ✅ Inline value classes for ALL primitive wrappers — zero runtime cost
@JvmInline value class CustomerId(val value: String)
@JvmInline value class ProductId(val value: String)
@JvmInline value class IdempotencyKey(val value: String)
```

### 2.4 Sealed Classes — Exhaustive Domain Modeling

```kotlin
// ✅ Model ALL possible outcomes — no null returns, no boolean flags
sealed class OrderResult {
    data class Created(val order: Order) : OrderResult()
    data class AlreadyExists(val orderId: OrderId, val originalCreatedAt: Instant) : OrderResult()
    data class Rejected(val reason: String, val orderId: OrderId) : OrderResult()
    data class InsufficientInventory(
        val productId: ProductId,
        val requested: Int,
        val available: Int,
    ) : OrderResult()
}

// ✅ Exhaustive when — compiler error if a case is missing
fun handleResult(result: OrderResult): ResponseEntity<*> = when (result) {
    is OrderResult.Created ->
        ResponseEntity.status(HttpStatus.CREATED).body(result.order.toResponse())
    is OrderResult.AlreadyExists ->
        ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ErrorResponse.conflict("Already created at ${result.originalCreatedAt}"))
    is OrderResult.Rejected ->
        ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
            .body(ErrorResponse.domain("REJECTED", result.reason))
    is OrderResult.InsufficientInventory ->
        ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
            .body(ErrorResponse.domain("INSUFFICIENT_INVENTORY",
                "Only ${result.available} of ${result.requested} available"))
}

// ✅ Same pattern for event processing outcomes
sealed class EventProcessingResult {
    data class Processed(val eventId: String, val duration: Duration) : EventProcessingResult()
    data class Skipped(val eventId: String, val reason: String) : EventProcessingResult()
    data class Failed(
        val eventId: String,
        val errorCode: String,
        val retryable: Boolean,
    ) : EventProcessingResult()
}
```

### 2.5 Extension Functions — Enhance Without Inheritance

```kotlin
// ✅ Extension functions for domain enrichment — clean, discoverable
fun Order.isEligibleForDiscount(): Boolean =
    status == OrderStatus.CONFIRMED && totalAmount.isGreaterThan(Money.of("100", "USD"))

fun Order.toAuditEntry(actor: String): AuditEntry =
    AuditEntry(
        resourceId = id.value,
        resourceType = "Order",
        actor = actor,
        action = status.name,
        timestamp = updatedAt,
    )

// ✅ Extension functions for result transformations
fun OrderResult.Created.toResponse(): CreateOrderResponse =
    CreateOrderResponse(
        orderId = order.id.value,
        status = order.status.name,
        totalAmount = order.totalAmount.amount,
        currency = order.totalAmount.currency.currencyCode,
        createdAt = order.createdAt,
    )

// ✅ Extension properties for computed values
val Money.toCents: Long get() = amount.multiply(BigDecimal("100")).toLong()
val OrderId.isProvisional: Boolean get() = value.startsWith("PROV-")

// ✅ Extension on nullable — safe transformations
fun String?.toOrderId(): OrderId? = this?.let { OrderId.of(it) }
fun String?.toOrderIdOrThrow(fieldName: String = "orderId"): OrderId =
    this?.let { OrderId.of(it) }
        ?: throw IllegalArgumentException("$fieldName must not be null or blank")
```

### 2.6 Scope Functions — Use Deliberately

```kotlin
// ✅ Scope function selection guide:
// let   → transform a nullable value, or isolate a block for a value
// run   → transform a non-null receiver, or execute a block with result
// apply → configure an object (builder pattern), returns the receiver
// also  → side effects (logging, metrics) without changing the value
// with  → operate on a receiver without extension syntax

// ✅ let — null-safe transformation
val enriched = order.customerId
    .let { customerId -> customerService.getProfile(customerId) }
    ?.let { profile -> order.enrichWith(profile) }
    ?: order.withUnknownCustomer()

// ✅ apply — object configuration / builder
val message = PubsubMessage.newBuilder()
    .apply {
        data = ByteString.copyFromUtf8(payload)
        putAttributes("eventType", event::class.simpleName ?: "Unknown")
        putAttributes("schemaVersion", event.schemaVersion.toString())
        putAttributes("traceId", MDC.get("traceId") ?: "")
        orderingKey = event.aggregateId
    }
    .build()

// ✅ also — side effects without breaking the chain
return orderRepository.save(order)
    .also { saved -> eventPublisher.publish(OrderCreatedEvent.from(saved)) }
    .also { saved -> metrics.recordOrderCreated(saved) }
    .also { saved -> log.info("Order created", kv("orderId", saved.id.value)) }

// ❌ WRONG — chaining scope functions when plain code is clearer
val result = value
    .let { it.process() }
    .run { transform() }
    .apply { configure() } // cryptic — unreadable to reviewers

// ✅ RULE: If you need to think twice to read it, write it as plain code
```

### 2.7 Collections — Functional, Immutable

```kotlin
// ✅ Always use immutable collections by default
val lines: List<OrderLine> = listOf(line1, line2)
val statusMap: Map<OrderId, OrderStatus> = mapOf(id1 to PENDING, id2 to CONFIRMED)
val activeStatuses: Set<OrderStatus> = setOf(PENDING, CONFIRMED, PROCESSING)

// ✅ Mutable only when needed, scoped to the function
fun buildSummary(orders: List<Order>): Summary {
    val grouped = buildMap<OrderStatus, MutableList<Order>> {
        orders.forEach { order ->
            getOrPut(order.status) { mutableListOf() }.add(order)
        }
    }
    return Summary(grouped.mapValues { it.value.toList() }) // return immutable
}

// ✅ Sequence for lazy evaluation on large collections
fun findHighValuePendingOrders(orders: Sequence<Order>): List<Order> =
    orders
        .filter { it.status == OrderStatus.PENDING }
        .filter { it.totalAmount.isGreaterThan(Money.of("500", "USD")) }
        .sortedByDescending { it.totalAmount.amount }
        .take(100)
        .toList()

// ❌ DON'T use mutableListOf() and then return a mutable list from a function
fun getOrders(): MutableList<Order> { ... } // WRONG — exposes internal state

// ✅ Always return immutable
fun getOrders(): List<Order> { ... }

// ✅ Destructuring for readability
val (created, failed) = orders.partition { it.status == OrderStatus.CREATED }
val (first, rest) = lines.let { it.first() to it.drop(1) }
```

### 2.8 Companion Objects and `object` Declarations

```kotlin
// ✅ Companion object for factory methods and constants
class Order private constructor( // Private constructor — force factory use
    val id: OrderId,
    val customerId: CustomerId,
    private var _status: OrderStatus,
    val lines: List<OrderLine>,
    val totalAmount: Money,
    val createdAt: Instant,
) {
    val status: OrderStatus get() = _status

    companion object {
        fun create(command: CreateOrderCommand): Order {
            require(command.lines.isNotEmpty()) { "Order must have at least one line" }
            require(command.lines.size <= 100) { "Order cannot exceed 100 lines" }

            val lines = command.lines.map { OrderLine.from(it) }
            val total = lines.fold(Money.zero(command.currency), Money::add)

            return Order(
                id = OrderId.generate(),
                customerId = command.customerId,
                _status = OrderStatus.PENDING,
                lines = lines,
                totalAmount = total,
                createdAt = Instant.now(),
            )
        }

        // Reconstitution — for repository adapters only
        internal fun reconstitute(
            id: OrderId,
            customerId: CustomerId,
            status: OrderStatus,
            lines: List<OrderLine>,
            totalAmount: Money,
            createdAt: Instant,
        ) = Order(id, customerId, status, lines, totalAmount, createdAt)
    }
}

// ✅ Singleton utilities — use object declaration
object DataMasker {
    fun maskEmail(email: String): String {
        val atIndex = email.indexOf('@')
        return if (atIndex <= 1) "****"
        else "${email.first()}***${email.substring(atIndex)}"
    }

    fun maskId(id: String): String =
        if (id.length < 6) "****"
        else "${id.take(4)}****${id.takeLast(2)}"
}
```

---

## 3. Architecture Boundaries

### 3.1 Microservice Scope Rules

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

### 3.2 Communication Decision Matrix

```
Use SYNCHRONOUS (HTTP/gRPC) when:
  ✅ Response required immediately to fulfil the request
  ✅ Operation is a query (read-only)
  ✅ SLA coupling is acceptable

Use ASYNCHRONOUS (Events/Messages) when:
  ✅ Caller does not need the result immediately
  ✅ Multiple consumers need the same information
  ✅ Cross-service workflows (sagas)
  ✅ The operation is a state change

NEVER:
  ❌ Synchronous chain deeper than 2 hops
  ❌ Fire-and-forget without a delivery guarantee (Outbox)
  ❌ Two-phase commit across services — use Saga or Outbox
```

### 3.3 Saga Pattern

```
CHOREOGRAPHY (preferred for ≤4 steps):
  Each service reacts to events and emits new events.
  No central coordinator.

  OrderService  ──[OrderCreated]──▶  InventoryService
                                            │
                                  [InventoryReserved]
                                            │
                                    ▶  PaymentService
                                            │
                                  [PaymentProcessed]──▶  OrderService ──[OrderConfirmed]

ORCHESTRATION (preferred for >4 steps or complex compensation):
  Saga orchestrator owns the workflow state machine.

  SagaOrchestrator ──▶ reserveInventory (command)
                   ◀── InventoryReserved (reply)
                   ──▶ chargePayment (command)
                   ◀── PaymentFailed (reply)
                   ──▶ releaseInventory (compensating command)
```

---

## 4. Project Structure — Hexagonal Architecture

### 4.1 Module Layout

```
{service-name}/
├── api/                              # Public contracts — shared with consumers
│   └── src/main/kotlin/
│       └── com/{company}/{service}/api/
│           ├── command/              # Inbound command DTOs (data classes)
│           ├── query/                # Inbound query DTOs
│           ├── response/             # Outbound response DTOs
│           └── event/                # Domain event schemas (versioned data classes)
│
├── domain/                           # Pure business logic — ZERO framework deps
│   └── src/main/kotlin/
│       └── com/{company}/{service}/domain/
│           ├── model/                # Aggregates, entities, value objects
│           ├── service/              # Domain services (stateless pure functions)
│           ├── event/                # Domain events (internal)
│           └── port/
│               ├── inbound/          # Use-case interfaces
│               └── outbound/         # Repository / publisher interfaces
│
├── application/                      # Orchestrates domain + ports
│   └── src/main/kotlin/
│       └── com/{company}/{service}/application/
│           ├── usecase/              # One class per use case
│           └── saga/                 # Saga orchestrators (if used)
│
├── infrastructure/                   # Technical adapters
│   └── src/main/kotlin/
│       └── com/{company}/{service}/infrastructure/
│           ├── persistence/          # DB repositories, entities, mappers
│           ├── messaging/            # Publishers, subscribers, serializers
│           ├── http/                 # Outbound HTTP clients
│           ├── cache/                # Cache adapters
│           └── config/               # Spring @Configuration classes
│
└── bootstrap/                        # Entry point — wiring only
    └── src/main/kotlin/
        └── com/{company}/{service}/
            └── Application.kt
```

### 4.2 Dependency Rules — Enforced via ArchUnit

```
domain        → no dependencies on other layers (pure Kotlin / Java stdlib)
application   → depends on domain only
infrastructure → depends on application + domain
bootstrap     → depends on all layers (wires everything)

Tested in ArchitectureTest.kt — build fails on violations
```

### 4.3 Package Naming

```kotlin
// ✅ Correct package names
com.acme.orders.domain.model.Order
com.acme.orders.domain.port.outbound.OrderRepository
com.acme.orders.application.usecase.CreateOrderUseCase
com.acme.orders.infrastructure.persistence.OrderEntity
com.acme.orders.infrastructure.messaging.OrderEventPublisher
com.acme.orders.api.event.OrderCreatedEvent
```

---

## 5. Coroutines — The Concurrency Model

### 5.1 Core Rules

```
RULE 1: Every suspend function must have a named, bounded CoroutineScope parent.
RULE 2: Never use GlobalScope in production — it has no structured lifecycle.
RULE 3: Dispatcher selection is explicit and documented per call site.
RULE 4: All coroutines are cancellable — check cancellation in long loops.
RULE 5: Timeout is always finite — no infinite suspending calls.
RULE 6: Flows are cold — use SharedFlow/StateFlow for hot broadcast.
RULE 7: Never mix blocking I/O with Dispatchers.Default — use Dispatchers.IO.
```

### 5.2 Dispatcher Selection

```kotlin
// ✅ Dispatcher selection guide — explicit at every call site
object AppDispatchers {
    // CPU-bound: database serialization, complex calculations
    val computation: CoroutineDispatcher = Dispatchers.Default

    // I/O-bound: database calls, HTTP, file I/O — use coroutine-native clients
    // where possible (Ktor, R2DBC, reactive MongoDB); fall back to IO for blocking
    val io: CoroutineDispatcher = Dispatchers.IO

    // Main thread: only for UI or very specific frameworks
    // val main: CoroutineDispatcher = Dispatchers.Main  // Not used in backend services
}

// ✅ Annotate suspend functions with dispatcher expectations
/**
 * Suspends on [Dispatchers.IO].
 * Callers on [Dispatchers.Default] are automatically switched.
 */
suspend fun fetchOrder(orderId: OrderId): Order =
    withContext(AppDispatchers.io) {
        orderRepository.findByIdOrThrow(orderId)
    }

// ✅ CPU-bound work — explicit switch
suspend fun calculatePricing(order: Order): PricingResult =
    withContext(AppDispatchers.computation) {
        pricingEngine.calculate(order) // CPU-intensive
    }

// ❌ FORBIDDEN — blocking call on Default dispatcher (starves CPU threads)
suspend fun badFetch(id: OrderId): Order =
    orderRepository.blockingFindById(id) // blocks a Default thread

// ✅ REQUIRED — wrap legacy blocking calls
suspend fun safeFetch(id: OrderId): Order =
    withContext(Dispatchers.IO) {
        orderRepository.blockingFindById(id) // IO thread handles the block
    }
```

### 5.3 Structured Concurrency — Concurrent Fan-Out

```kotlin
// ✅ coroutineScope — cancels all children if any fails
suspend fun enrichOrder(orderId: OrderId): EnrichedOrder = coroutineScope {
    // All launched concurrently — any failure cancels the rest
    val orderDeferred = async { orderRepository.findByIdOrThrow(orderId) }
    val customerDeferred = async { customerService.getProfile(orderId) }
    val productsDeferred = async { productService.getDetailsForOrder(orderId) }
    val shippingDeferred = async { shippingService.estimateForOrder(orderId) }

    // Await all — coroutineScope propagates first exception automatically
    EnrichedOrder(
        order = orderDeferred.await(),
        customer = customerDeferred.await(),
        products = productsDeferred.await(),
        shipping = shippingDeferred.await(),
    )
}

// ✅ supervisorScope — children fail independently (use for partial results)
suspend fun enrichOrderWithPartialFallback(orderId: OrderId): EnrichedOrder =
    supervisorScope {
        val orderDeferred = async { orderRepository.findByIdOrThrow(orderId) }

        // These are optional — degrade gracefully if unavailable
        val recommendationsDeferred = async {
            runCatching { recommendationService.get(orderId) }
                .getOrElse {
                    log.warn("Recommendations unavailable for order {}", orderId)
                    emptyList()
                }
        }

        EnrichedOrder(
            order = orderDeferred.await(),             // Required — propagates failure
            recommendations = recommendationsDeferred.await(), // Optional — uses fallback
        )
    }

// ✅ Timeout — always finite
suspend fun checkInventoryWithTimeout(productId: ProductId): InventoryStatus =
    withTimeout(2_000L) { // 2 seconds — explicit, named
        inventoryClient.check(productId)
    }

// ✅ withTimeoutOrNull — for nullable fallback pattern
suspend fun getPriceWithFallback(productId: ProductId): Money =
    withTimeoutOrNull(1_000L) {
        pricingService.getPrice(productId)
    } ?: Money.zero(Currency.USD) // Safe fallback on timeout
```

### 5.4 Flow — Reactive Streams with Coroutines

```kotlin
// ✅ Cold Flow — produced lazily, one-to-one
fun streamPendingOrders(since: Instant): Flow<Order> = flow {
    var page = 0
    do {
        val orders = orderRepository.findPendingPage(since, page, PAGE_SIZE)
        orders.forEach { emit(it) }
        page++
    } while (orders.size == PAGE_SIZE)
}
    .flowOn(AppDispatchers.io) // ← correct: declare where the flow executes

// ✅ Flow operators — functional transformation pipeline
fun streamHighValueOrders(since: Instant): Flow<EnrichedOrder> =
    streamPendingOrders(since)
        .filter { it.totalAmount.isGreaterThan(Money.of("500", "USD")) }
        .map { order -> enrichOrder(order) }
        .catch { e ->
            log.error("Error streaming orders", e)
            // emit a sentinel or just complete — don't rethrow unless critical
        }
        .onEach { order ->
            metrics.recordOrderStreamed(order)
        }
        .buffer(capacity = 64) // Decouple producer and consumer speeds

// ✅ SharedFlow — hot, multicast (event bus pattern)
class OrderEventBus {
    private val _events = MutableSharedFlow<DomainEvent>(
        replay = 0,           // No replay for late subscribers
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST, // Explicit overflow strategy
    )
    val events: SharedFlow<DomainEvent> = _events.asSharedFlow()

    suspend fun emit(event: DomainEvent) {
        _events.emit(event)
    }
}

// ✅ StateFlow — hot, single-value state holder
class OrderStatusTracker {
    private val _status = MutableStateFlow(OrderStatus.PENDING)
    val status: StateFlow<OrderStatus> = _status.asStateFlow()

    fun updateStatus(newStatus: OrderStatus) {
        _status.value = newStatus
    }
}

// ✅ Collecting a Flow — always in a coroutine with scope
class OrderProcessor(
    private val eventBus: OrderEventBus,
    private val scope: CoroutineScope,  // Injected scope — never GlobalScope
) {
    init {
        scope.launch {
            eventBus.events
                .filterIsInstance<OrderCreatedEvent>()
                .collect { event -> processOrderCreated(event) }
        }
    }
}
```

### 5.5 Coroutine Scope Management

```kotlin
// ✅ Service-level scope — tied to Spring lifecycle
@Service
class OrderProcessingService(
    private val orderRepository: OrderRepository,
) : DisposableBean {

    // Supervisor job — individual task failures don't cancel the service scope
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob +
        CoroutineName("OrderProcessingService"))

    fun startBackgroundProcessing() {
        serviceScope.launch(CoroutineName("outbox-poller")) {
            while (isActive) { // ← always check isActive in loops
                pollOutbox()
                delay(500)     // Suspend — doesn't block a thread
            }
        }
    }

    // ✅ Implement DisposableBean — clean shutdown
    override fun destroy() {
        serviceJob.cancel("Service shutting down")
    }
}

// ✅ Spring Boot integration — use coroutineScope in request handlers
@RestController
class OrderController(private val useCase: CreateOrderUseCase) {

    @PostMapping("/orders")
    suspend fun createOrder(@RequestBody @Valid request: CreateOrderRequest): ResponseEntity<*> {
        // Spring WebFlux / Coroutine MVC handles the scope automatically
        val result = useCase.execute(request.toCommand())
        return handleResult(result)
    }
}

// ❌ FORBIDDEN — GlobalScope has no lifecycle control
GlobalScope.launch { processOrder(command) } // Orphaned coroutine — resource leak
```

### 5.6 Channel — Point-to-Point Work Queues

```kotlin
// ✅ Channel for producer-consumer pipelines
class OutboxRelay(private val scope: CoroutineScope) {

    private val workChannel = Channel<OutboxEvent>(
        capacity = 1000,
        onBufferOverflow = BufferOverflow.SUSPEND, // Back-pressure: suspend producer
    )

    // Producer — called by outbox poller
    suspend fun enqueue(event: OutboxEvent) {
        workChannel.send(event) // suspends if channel is full
    }

    // Consumer pipeline — N concurrent workers
    fun start(workerCount: Int = 4) {
        repeat(workerCount) { workerId ->
            scope.launch(CoroutineName("outbox-worker-$workerId")) {
                for (event in workChannel) { // ← for-loop on Channel is idiomatic
                    publishTobroker(event)
                }
            }
        }
    }

    fun stop() {
        workChannel.close()
    }
}
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
 │  5. TimeLimiter / withTimeout (bound latency)   │
 └─────────────────────────────────────────────────┘
         ↓
   External Service / DB / Queue

RULE: Inner timeout < Outer timeout (always leave headroom)
RULE: Retry count × maxWait < Circuit breaker evaluation window
RULE: Every config is named and externalized — never hardcoded
RULE: Every fallback logs a WARN metric — degradation is observable
```

### 6.2 Resilience4j + Kotlin Coroutines Configuration

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    configs:
      default:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 20
        minimum-number-of-calls: 10
        failure-rate-threshold: 50
        slow-call-rate-threshold: 80
        slow-call-duration-threshold: 2s
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 5
        automatic-transition-from-open-to-half-open-enabled: true
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - kotlinx.coroutines.TimeoutCancellationException
        ignore-exceptions:
          - com.acme.domain.NotFoundException
          - com.acme.domain.ValidationException
    instances:
      payment-service:
        base-config: default
        wait-duration-in-open-state: 60s
      inventory-service:
        base-config: default
      notification-service:
        base-config: default
        failure-rate-threshold: 80

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
        ignore-exceptions:
          - com.acme.domain.DomainException
    instances:
      payment-service:
        base-config: default
        max-attempts: 2
      inventory-service:
        base-config: default

  bulkhead:
    configs:
      default:
        max-concurrent-calls: 20
        max-wait-duration: 50ms
    instances:
      payment-service:
        max-concurrent-calls: 10
      inventory-service:
        max-concurrent-calls: 25

  timelimiter:
    configs:
      default:
        timeout-duration: 3s
        cancel-running-future: true
    instances:
      payment-service:
        timeout-duration: 5s
      inventory-service:
        timeout-duration: 2s

  ratelimiter:
    instances:
      payment-gateway-api:
        limit-for-period: 50
        limit-refresh-period: 1s
        timeout-duration: 500ms
```

### 6.3 Resilience4j — Kotlin Coroutine Integration

```kotlin
// ✅ Kotlin-idiomatic coroutine suspending extensions for Resilience4j
// Use resilience4j-kotlin module for native suspend support

@Service
class InventoryAdapter(
    private val circuitBreakerRegistry: CircuitBreakerRegistry,
    private val retryRegistry: RetryRegistry,
    private val bulkheadRegistry: BulkheadRegistry,
    private val client: InventoryHttpClient,
    private val metrics: MeterRegistry,
) : InventoryPort {

    private val circuitBreaker = circuitBreakerRegistry.circuitBreaker("inventory-service")
    private val retry = retryRegistry.retry("inventory-service")
    private val bulkhead = bulkheadRegistry.bulkhead("inventory-service")

    init {
        // Observe state transitions for alerting
        circuitBreaker.eventPublisher.onStateTransition { event ->
            log.warn(
                "Circuit breaker [inventory-service] {} → {}",
                event.stateTransition.fromState,
                event.stateTransition.toState,
            )
            metrics.counter("circuit_breaker.state_transition",
                "name", "inventory-service",
                "from", event.stateTransition.fromState.name,
                "to", event.stateTransition.toState.name,
            ).increment()
        }
    }

    // ✅ Coroutine-native: executeSuspendFunction from resilience4j-kotlin
    override suspend fun checkInventory(productId: ProductId): InventoryStatus =
        circuitBreaker.executeSuspendFunction {
            retry.executeSuspendFunction {
                bulkhead.executeSuspendFunction {
                    withTimeout(2_000L) {
                        client.check(productId.value)
                    }
                }
            }
        }.recoverFromOpenCircuit(productId)

    // ✅ Recovery extension — clean and explicit
    private fun InventoryStatus?.recoverFromOpenCircuit(productId: ProductId): InventoryStatus =
        this ?: run {
            metrics.counter("inventory.fallback.activations").increment()
            log.warn("Inventory circuit breaker OPEN for product {}, returning UNKNOWN", productId)
            InventoryStatus.UNKNOWN // Degrade safely — never fake "available"
        }
}

// ✅ Extension functions for cleaner Resilience4j coroutine usage
suspend fun <T> CircuitBreaker.executeSuspendFunction(block: suspend () -> T): T? =
    try {
        executeWithResourceAsync(block)
    } catch (e: CallNotPermittedException) {
        null // Caller handles null as "circuit open"
    }

// ✅ Payment adapter — never degrade silently
@Service
class PaymentAdapter(
    circuitBreakerRegistry: CircuitBreakerRegistry,
    retryRegistry: RetryRegistry,
    private val client: PaymentHttpClient,
) : PaymentPort {

    private val circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment-service")
    private val retry = retryRegistry.retry("payment-service")

    override suspend fun charge(command: PaymentCommand): PaymentResult {
        return try {
            circuitBreaker.executeSuspendFunction {
                retry.executeSuspendFunction {
                    withTimeout(5_000L) { client.charge(command) }
                }
            } ?: throw PaymentServiceUnavailableException(command.orderId)

        } catch (e: CallNotPermittedException) {
            throw PaymentServiceUnavailableException(command.orderId)
        } catch (e: BulkheadFullException) {
            throw PaymentServiceOverloadedException(command.orderId)
        } catch (e: TimeoutCancellationException) {
            throw PaymentTimeoutException(command.orderId)
        }
        // ❌ Payment NEVER has a silent fallback — throw, not degrade
    }
}
```

### 6.4 Idempotency — Universal Pattern

```kotlin
// ✅ Idempotency key interface — every command that mutates state must implement this
interface IdempotentCommand {
    val idempotencyKey: IdempotencyKey
    val serviceId: String
    val operationName: String
    val idempotencyTtl: Duration get() = Duration.ofHours(24)
}

// ✅ Idempotency store — pluggable
interface IdempotencyStore {
    suspend fun isAlreadyProcessed(key: String): Boolean
    suspend fun markProcessed(key: String, ttl: Duration)
    suspend fun <T : Any> getStoredResult(key: String, type: KClass<T>): T?
    suspend fun <T : Any> markProcessedWithResult(key: String, result: T, ttl: Duration)
}

// ✅ Reified inline for type-safe result retrieval
suspend inline fun <reified T : Any> IdempotencyStore.getStoredResult(key: String): T? =
    getStoredResult(key, T::class)

// ✅ Idempotency decorator — inline function for zero-overhead abstraction
suspend inline fun <C : IdempotentCommand, reified R : Any> IdempotencyStore.executeIdempotent(
    command: C,
    crossinline handler: suspend (C) -> R,
): R {
    val key = "${command.serviceId}:${command.operationName}:${command.idempotencyKey.value}"

    getStoredResult<R>(key)?.let { stored ->
        log.info("Idempotent replay for key {}: returning stored result", key)
        return stored
    }

    val result = handler(command)
    markProcessedWithResult(key, result, command.idempotencyTtl)
    return result
}

// ✅ Usage in application layer
@UseCase
class CreateOrderUseCase(
    private val orderRepository: OrderRepository,
    private val eventPublisher: DomainEventPublisher,
    private val idempotencyStore: IdempotencyStore,
) {
    suspend fun execute(command: CreateOrderCommand): OrderResult =
        idempotencyStore.executeIdempotent(command) { cmd ->
            val order = Order.create(cmd)
            orderRepository.save(order)
            eventPublisher.publish(OrderCreatedEvent.from(order))
            OrderResult.Created(order)
        }
}
```

### 6.5 Graceful Degradation Catalog

```kotlin
// ✅ Catalog of degraded responses — one per dependency
object DegradedResponses {

    // Inventory: UNKNOWN is safe — caller treats as "check later"
    fun inventory(productId: ProductId): InventoryStatus {
        log.warn("Using degraded inventory response for product {}", productId)
        return InventoryStatus.UNKNOWN
    }

    // Recommendations: empty is safe — UI handles gracefully
    fun recommendations(): List<ProductRecommendation> = emptyList()

    // Pricing: use cached or catalog price
    suspend fun pricing(productId: ProductId, priceCache: PriceCache): Money =
        priceCache.get(productId)
            ?: Money.zero(Currency.getInstance("USD"))
                .also { log.warn("Using zero fallback price for product {}", productId) }

    // Notifications: queue locally for retry — don't fail the business op
    suspend fun notification(
        userId: String,
        message: String,
        retryQueue: LocalRetryQueue,
    ): NotificationResult {
        retryQueue.enqueue(PendingNotification(userId, message))
        return NotificationResult.QUEUED_FOR_RETRY
    }

    // ❌ NEVER create a payment fallback — payment must throw
    // Payment degradation = money silently lost or silently double-charged
}
```

---

## 7. Domain Modeling Standards

### 7.1 Aggregate Root

```kotlin
// ✅ Aggregate root — private constructor, all mutations via methods
class Order private constructor(
    val id: OrderId,
    val customerId: CustomerId,
    val lines: List<OrderLine>,
    val totalAmount: Money,
    val createdAt: Instant,
    status: OrderStatus,
) {
    // ── Mutable state with backing property ──────────────────────────────────
    private var _status: OrderStatus = status
    val status: OrderStatus get() = _status

    private var _updatedAt: Instant = createdAt
    val updatedAt: Instant get() = _updatedAt

    // ── Domain events (transient — not persisted) ─────────────────────────────
    private val _domainEvents = mutableListOf<DomainEvent>()

    // ── Domain operations — enforce invariants ────────────────────────────────
    fun confirm(): Order {
        check(_status == OrderStatus.PENDING) {
            "Cannot confirm order ${id.value} in status $_status"
        }
        _status = OrderStatus.CONFIRMED
        _updatedAt = Instant.now()
        _domainEvents += OrderConfirmedEvent.from(this)
        return this
    }

    fun cancel(reason: CancellationReason): Order {
        check(_status !in setOf(OrderStatus.FULFILLED, OrderStatus.SHIPPED)) {
            "Cannot cancel order ${id.value} — already $_status"
        }
        _status = OrderStatus.CANCELLED
        _updatedAt = Instant.now()
        _domainEvents += OrderCancelledEvent.from(this, reason)
        return this
    }

    // ── Event collection — polled by repository after save ────────────────────
    fun pollDomainEvents(): List<DomainEvent> =
        _domainEvents.toList().also { _domainEvents.clear() }

    companion object {
        fun create(command: CreateOrderCommand): Order {
            require(command.lines.isNotEmpty()) { "Order must have at least one line" }
            require(command.lines.size <= 100) { "Order cannot exceed 100 lines" }

            val lines = command.lines.map { OrderLine.from(it) }
            val total = lines.fold(Money.zero(command.currency), Money::add)

            return Order(
                id = OrderId.generate(),
                customerId = command.customerId,
                lines = lines,
                totalAmount = total,
                createdAt = Instant.now(),
                status = OrderStatus.PENDING,
            ).also { order ->
                order._domainEvents += OrderCreatedEvent.from(order)
            }
        }

        internal fun reconstitute(
            id: OrderId,
            customerId: CustomerId,
            status: OrderStatus,
            lines: List<OrderLine>,
            totalAmount: Money,
            createdAt: Instant,
        ) = Order(id, customerId, lines, totalAmount, createdAt, status)
    }
}
```

### 7.2 Domain Events

```kotlin
// ✅ Domain events — sealed hierarchy, immutable, versioned
sealed class DomainEvent {
    abstract val eventId: String
    abstract val aggregateId: String
    abstract val aggregateType: String
    abstract val occurredAt: Instant
    abstract val schemaVersion: Int
}

data class OrderCreatedEvent(
    override val eventId: String = UUID.randomUUID().toString(),
    override val aggregateId: String,
    override val aggregateType: String = "Order",
    override val occurredAt: Instant = Instant.now(),
    override val schemaVersion: Int = 1,        // Bump on breaking changes
    val customerId: String,
    val lines: List<OrderLineSnapshot>,
    val totalAmount: MoneySnapshot,
) : DomainEvent() {
    companion object {
        fun from(order: Order) = OrderCreatedEvent(
            aggregateId = order.id.value,
            customerId = order.customerId.value,
            lines = order.lines.map { OrderLineSnapshot.from(it) },
            totalAmount = MoneySnapshot.from(order.totalAmount),
        )
    }
}

data class OrderCancelledEvent(
    override val eventId: String = UUID.randomUUID().toString(),
    override val aggregateId: String,
    override val aggregateType: String = "Order",
    override val occurredAt: Instant = Instant.now(),
    override val schemaVersion: Int = 1,
    val reason: String,
    val cancelledBy: String,
) : DomainEvent() {
    companion object {
        fun from(order: Order, reason: CancellationReason) = OrderCancelledEvent(
            aggregateId = order.id.value,
            reason = reason.description,
            cancelledBy = reason.initiator,
        )
    }
}
```

### 7.3 Repository Interface — Pure Domain Contract

```kotlin
// ✅ Repository lives in domain.port.outbound — zero infrastructure imports
interface OrderRepository {

    // Queries — always suspend, return null-safe types
    suspend fun findById(orderId: OrderId): Order?
    suspend fun findByIdOrThrow(orderId: OrderId): Order =
        findById(orderId) ?: throw OrderNotFoundException(orderId)

    suspend fun findByIdempotencyKey(key: IdempotencyKey): Order?
    suspend fun findByCustomerAndStatus(
        customerId: CustomerId,
        status: OrderStatus,
    ): List<Order>

    suspend fun existsById(orderId: OrderId): Boolean

    // Mutations
    suspend fun save(order: Order): Order

    // Streaming — for bulk operations
    fun streamPendingOlderThan(threshold: Instant): Flow<Order>
}
```

---

## 8. Event-Driven Architecture Patterns

### 8.1 Outbox Pattern — Guaranteed Delivery

```kotlin
// ✅ Outbox entity
data class OutboxEvent(
    val id: String = UUID.randomUUID().toString(),
    val aggregateId: String,
    val aggregateType: String,
    val eventType: String,
    val payload: String,
    val status: OutboxStatus = OutboxStatus.PENDING,
    val createdAt: Instant = Instant.now(),
    val processedAt: Instant? = null,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val nextRetryAt: Instant = Instant.now(),
) {
    enum class OutboxStatus { PENDING, PROCESSING, PUBLISHED, DEAD }

    fun withRetry(error: String): OutboxEvent {
        val newRetryCount = retryCount + 1
        val backoffSeconds = 2.0.pow(newRetryCount).toLong().coerceAtMost(300)
        return copy(
            retryCount = newRetryCount,
            lastError = error,
            status = if (newRetryCount >= MAX_RETRIES) OutboxStatus.DEAD else OutboxStatus.PENDING,
            nextRetryAt = Instant.now().plusSeconds(backoffSeconds),
        )
    }

    companion object {
        const val MAX_RETRIES = 5
    }
}

// ✅ Outbox publisher — writes to DB atomically with business data
@Component
class OutboxEventPublisher(
    private val outboxRepository: OutboxRepository,
    private val objectMapper: ObjectMapper,
) : DomainEventPublisher {

    /**
     * MUST be called within the same transaction as the business operation.
     * The actual broker publish is done asynchronously by [OutboxPoller].
     */
    override suspend fun publish(event: DomainEvent) {
        val outboxEvent = OutboxEvent(
            aggregateId = event.aggregateId,
            aggregateType = event.aggregateType,
            eventType = event::class.simpleName ?: "Unknown",
            payload = objectMapper.writeValueAsString(event),
        )
        outboxRepository.save(outboxEvent)
    }
}

// ✅ Outbox poller — Kotlin coroutines, clean lifecycle
@Service
class OutboxPoller(
    private val outboxRepository: OutboxRepository,
    private val brokerPublisher: MessageBrokerPublisher,
    private val metrics: MeterRegistry,
    private val alerting: AlertingService,
) : DisposableBean {

    private val pollerJob = SupervisorJob()
    private val pollerScope = CoroutineScope(Dispatchers.IO + pollerJob +
        CoroutineName("OutboxPoller"))

    companion object {
        private const val BATCH_SIZE = 100
        private val POLL_INTERVAL = 500.milliseconds
    }

    fun start() {
        pollerScope.launch {
            while (isActive) {
                runCatching { pollAndPublish() }
                    .onFailure { e ->
                        log.error("Outbox poll cycle failed", e)
                        metrics.counter("outbox.poll.error").increment()
                    }
                delay(POLL_INTERVAL)
            }
        }
    }

    private suspend fun pollAndPublish() {
        val pending = outboxRepository.findPendingBatch(Instant.now(), BATCH_SIZE)

        pending.forEach { event ->
            publishWithTracking(event)
        }
    }

    private suspend fun publishWithTracking(event: OutboxEvent) {
        try {
            outboxRepository.markProcessing(event.id) // Optimistic lock
            brokerPublisher.publish(event)
            outboxRepository.markPublished(event.id, Instant.now())
            metrics.counter("outbox.published",
                "event_type", event.eventType).increment()

        } catch (e: OptimisticLockException) {
            // Another instance processing it — normal in multi-pod deployments
            log.debug("Skipping event {} — already processing", event.id)

        } catch (e: Exception) {
            val updated = event.withRetry(e.message ?: "Unknown error")
            outboxRepository.updateForRetry(updated)

            if (updated.status == OutboxEvent.OutboxStatus.DEAD) {
                metrics.counter("outbox.dead_letter", "event_type", event.eventType).increment()
                log.error("Event {} DEAD after {} retries", event.id, updated.retryCount, e)
                alerting.notify(Alert.critical(
                    title = "Outbox dead letter",
                    message = "eventId=${event.id} type=${event.eventType} " +
                        "aggregateId=${event.aggregateId}",
                ))
            }
        }
    }

    suspend fun replayDeadEvents(eventType: String, maxCount: Int): Int {
        val dead = outboxRepository.findDeadByType(eventType, maxCount)
        dead.forEach { outboxRepository.resetForRetry(it.id) }
        log.info("Reset {} dead events of type {} for replay", dead.size, eventType)
        return dead.size
    }

    override fun destroy() {
        pollerJob.cancel("OutboxPoller shutting down")
    }
}
```

### 8.2 Event Consumer — Exactly-Once Processing

```kotlin
// ✅ Idiomatic Kotlin event consumer
@Component
class OrderCreatedEventConsumer(
    private val idempotencyStore: IdempotencyStore,
    private val reserveInventoryUseCase: ReserveInventoryUseCase,
    private val metrics: MeterRegistry,
) {
    /**
     * Return normally  → message ACKed.
     * Throw [RetryableException]     → broker requeues for retry.
     * Throw [NonRetryableException]  → broker routes to DLQ.
     */
    suspend fun onOrderCreated(message: ConsumedMessage<OrderCreatedEvent>) {
        val event = message.payload
        val idempotencyKey = "order-created:${message.id}"

        MDC.put("traceId", event.eventId)
        MDC.put("eventType", "OrderCreated")
        MDC.put("aggregateId", event.aggregateId)

        try {
            if (idempotencyStore.isAlreadyProcessed(idempotencyKey)) {
                log.info("Duplicate message {} — skipping", message.id)
                metrics.counter("consumer.duplicate_skipped",
                    "event_type", "OrderCreated").increment()
                return
            }

            val result: EventProcessingResult = when (event.schemaVersion) {
                1 -> processV1(event)
                2 -> processV2(event)
                else -> {
                    log.warn("Unknown schema version {} for OrderCreated", event.schemaVersion)
                    EventProcessingResult.Skipped(event.eventId,
                        "unknown schema version ${event.schemaVersion}")
                }
            }

            idempotencyStore.markProcessed(idempotencyKey, Duration.ofDays(7))

            metrics.counter("consumer.processed",
                "event_type", "OrderCreated",
                "result", result::class.simpleName ?: "Unknown",
            ).increment()

        } catch (e: DomainException) {
            log.error("Non-retryable error processing OrderCreated {}: {}",
                event.eventId, e.message)
            metrics.counter("consumer.non_retryable_error", "event_type", "OrderCreated").increment()
            throw NonRetryableException("Business rule violation: ${e.message}", e)

        } catch (e: CancellationException) {
            throw e // Never swallow CancellationException — it's the coroutine lifecycle

        } catch (e: Exception) {
            log.warn("Transient error processing OrderCreated {}, will retry", event.eventId, e)
            metrics.counter("consumer.transient_error", "event_type", "OrderCreated").increment()
            throw RetryableException("Transient failure", e)

        } finally {
            MDC.clear()
        }
    }

    private suspend fun processV1(event: OrderCreatedEvent): EventProcessingResult {
        reserveInventoryUseCase.execute(ReserveInventoryCommand.from(event))
        return EventProcessingResult.Processed(event.eventId, Duration.ZERO)
    }

    private suspend fun processV2(event: OrderCreatedEvent): EventProcessingResult =
        processV1(event) // backward compat
}
```

### 8.3 Event Schema Evolution Contract

```
╔══════════════════════════════════════════════════════════════════════╗
║              EVENT SCHEMA EVOLUTION CONTRACT                         ║
╠══════════════════════════════════════════════════════════════════════╣
║ ALLOWED (non-breaking):                                              ║
║   ✅ Add new nullable fields with defaults                           ║
║   ✅ Add new event data classes to the sealed hierarchy              ║
║   ✅ Deprecate fields (@Deprecated annotation + keep them)           ║
║   ✅ Widen field types (Int → Long)                                  ║
║                                                                      ║
║ FORBIDDEN (breaking):                                                ║
║   ❌ Remove or rename data class fields                              ║
║   ❌ Change field types (narrowing or semantic change)               ║
║   ❌ Remove a subtype from a sealed class                            ║
║   ❌ Reuse an event class name with different fields                 ║
║   ❌ Change the orderingKey / partition strategy                     ║
║                                                                      ║
║ PROCESS FOR BREAKING CHANGES:                                        ║
║   1. Create new event class (e.g. OrderCreatedV2)                   ║
║   2. Publish BOTH versions during the migration window               ║
║   3. Migrate all consumers to the new version                       ║
║   4. Remove old version after all consumers migrated                ║
║                                                                      ║
║ schemaVersion is MANDATORY on every event data class                 ║
║ Consumers MUST handle current AND all previous schema versions       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 9. Error Handling Strategy

### 9.1 Exception Hierarchy

```kotlin
// ✅ Sealed exception hierarchy — explicit, typed, navigable
sealed class DomainException(
    val errorCode: String,
    message: String,
    val context: Map<String, Any> = emptyMap(),
) : RuntimeException(message)

// ── Not found ────────────────────────────────────────────────────────────────
class OrderNotFoundException(orderId: OrderId) : DomainException(
    errorCode = "ORDER_NOT_FOUND",
    message = "Order ${orderId.value} not found",
    context = mapOf("orderId" to orderId.value),
)

// ── Invalid state ────────────────────────────────────────────────────────────
class InvalidOrderStateException(
    orderId: OrderId,
    currentStatus: OrderStatus,
    attemptedOperation: String,
) : DomainException(
    errorCode = "INVALID_ORDER_STATE",
    message = "Cannot $attemptedOperation order ${orderId.value} in status $currentStatus",
    context = mapOf(
        "orderId" to orderId.value,
        "currentStatus" to currentStatus.name,
        "attemptedOperation" to attemptedOperation,
    ),
)

// ── Business rules ────────────────────────────────────────────────────────────
class InsufficientInventoryException(
    productId: ProductId,
    requested: Int,
    available: Int,
) : DomainException(
    errorCode = "INSUFFICIENT_INVENTORY",
    message = "Product ${productId.value}: requested $requested, available $available",
    context = mapOf(
        "productId" to productId.value,
        "requested" to requested,
        "available" to available,
    ),
)

// ── Infrastructure errors ─────────────────────────────────────────────────────
sealed class InfrastructureException(
    message: String,
    val retryable: Boolean,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

class PaymentServiceUnavailableException(orderId: OrderId) : InfrastructureException(
    message = "Payment service unavailable for order ${orderId.value}",
    retryable = true,
)

class EventPublicationException(eventType: String, cause: Throwable) : InfrastructureException(
    message = "Failed to publish event: $eventType",
    retryable = true,
    cause = cause,
)

// ── Message processing ────────────────────────────────────────────────────────
class RetryableException(message: String, cause: Throwable) : RuntimeException(message, cause)
class NonRetryableException(message: String, cause: Throwable) : RuntimeException(message, cause)
```

### 9.2 `Result` and `runCatching` — Functional Error Handling

```kotlin
// ✅ Use Result<T> for operations that can fail in expected ways
suspend fun safeFetchOrder(orderId: OrderId): Result<Order> =
    runCatching { orderRepository.findByIdOrThrow(orderId) }

// ✅ Chaining with Result
suspend fun processOrderEnrichment(orderId: OrderId): Result<EnrichedOrder> =
    safeFetchOrder(orderId)
        .mapCatching { order ->
            coroutineScope {
                val customer = async { customerService.getProfile(order.customerId) }
                EnrichedOrder(order, customer.await())
            }
        }
        .onSuccess { log.info("Enriched order {}", orderId) }
        .onFailure { e -> log.warn("Failed to enrich order {}", orderId, e) }

// ✅ Recovering from specific failures
val order = safeFetchOrder(orderId)
    .recover { e ->
        when (e) {
            is OrderNotFoundException -> Order.placeholder(orderId)
            else -> throw e // Re-throw unexpected failures
        }
    }
    .getOrThrow()

// ❌ DON'T: recover swallowing all exceptions
val bad = runCatching { fetchOrder(orderId) }
    .getOrNull() // Swallows all exceptions — context lost

// ✅ DO: be explicit about what you recover from
val good = runCatching { fetchOrder(orderId) }
    .recover { e ->
        when (e) {
            is OrderNotFoundException -> null  // Intentional: not found is OK here
            else -> throw e                   // All others propagate
        }
    }
    .getOrThrow()
```

### 9.3 CancellationException — Never Swallow

```kotlin
// ❌ FORBIDDEN — swallowing CancellationException breaks coroutine cancellation
suspend fun badHandler() {
    try {
        suspendingOperation()
    } catch (e: Exception) {
        log.error("Error", e) // This catches CancellationException too!
    }
}

// ✅ REQUIRED — always re-throw CancellationException
suspend fun goodHandler() {
    try {
        suspendingOperation()
    } catch (e: CancellationException) {
        throw e // Let the coroutine machinery handle it
    } catch (e: Exception) {
        log.error("Error in suspending operation", e)
        throw OperationFailedException(e)
    }
}

// ✅ Alternative — runCatching does NOT catch CancellationException
suspend fun safeHandler() {
    runCatching { suspendingOperation() }
        .onFailure { e -> log.error("Operation failed", e) }
}
// Note: runCatching re-throws CancellationException automatically in Kotlin coroutines
```

---

## 10. Observability & Operability

### 10.1 Structured Logging

```kotlin
// ✅ JSON-structured logging via logstash-logback-encoder
// Every log entry is a queryable data point

// ✅ MDC filter — enrich all logs in the request/event scope
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class ObservabilityFilter : WebFilter {

    override fun filter(exchange: ServerWebExchange, chain: WebFilterChain): Mono<Void> {
        val traceId = exchange.request.headers
            .getFirst("traceparent")
            ?: exchange.request.headers.getFirst("X-Request-ID")
            ?: UUID.randomUUID().toString().replace("-", "")

        return chain.filter(exchange)
            .contextWrite(
                ReactorContext.of(
                    "traceId" to traceId,
                    "service" to applicationName,
                    "version" to applicationVersion,
                )
            )
    }
}

// ✅ Coroutine-aware MDC helper
suspend fun <T> withMDC(vararg pairs: Pair<String, String>, block: suspend () -> T): T {
    pairs.forEach { (k, v) -> MDC.put(k, v) }
    return try {
        block()
    } finally {
        pairs.forEach { (k, _) -> MDC.remove(k) }
    }
}

// ✅ Structured log arguments — never concatenate
private fun logOrderCreated(order: Order, duration: Duration) {
    log.info(
        "Order created",
        kv("event", "ORDER_CREATED"),
        kv("orderId", order.id.value),
        kv("customerId", DataMasker.maskId(order.customerId.value)), // PII masked
        kv("lineCount", order.lines.size),
        kv("totalAmountCents", order.totalAmount.toCents),
        kv("currency", order.totalAmount.currency.currencyCode),
        kv("processingTimeMs", duration.toMillis()),
    )
}

// ✅ Log level contract — strict
// ERROR  requires immediate action (page on-call)
// WARN   unexpected but handled; investigate next business day
// INFO   significant business events (order created, payment processed)
// DEBUG  developer diagnostics; disabled in production
// TRACE  never in production

// ✅ NEVER log
// ❌ Full card numbers, CVVs, passwords, API keys
// ❌ Personal data: full name, email, phone, address — log masked IDs only
// ❌ Stack traces at INFO/WARN — only at ERROR
```

### 10.2 Metrics — Business + Technical

```kotlin
// ✅ Business-meaningful metrics — not just HTTP stats
@Component
class OrderServiceMetrics(registry: MeterRegistry, orderRepository: OrderRepository) {

    private val ordersCreated: Counter = Counter.builder("business.orders.created.total")
        .description("Total orders successfully created")
        .register(registry)

    private val ordersFailed: Counter = Counter.builder("business.orders.failed.total")
        .description("Total order creation failures")
        .register(registry)

    private val creationDuration: Timer = Timer.builder("business.orders.creation.duration")
        .description("End-to-end order creation latency")
        .publishPercentiles(0.50, 0.90, 0.95, 0.99)
        .publishPercentileHistogram()
        .register(registry)

    private val orderValue: DistributionSummary = DistributionSummary
        .builder("business.orders.value.cents")
        .description("Distribution of order values in cents")
        .publishPercentiles(0.50, 0.75, 0.95, 0.99)
        .register(registry)

    // Gauge: lazily sampled on each Prometheus scrape
    private val pendingOrdersGauge = Gauge.builder("business.orders.pending.count",
        orderRepository) { repo -> runBlocking { repo.countByStatus(OrderStatus.PENDING).toDouble() } }
        .description("Current number of pending orders")
        .register(registry)

    fun recordOrderCreated(order: Order, duration: Duration) {
        ordersCreated.increment()
        creationDuration.record(duration)
        orderValue.record(order.totalAmount.toCents.toDouble())
    }

    fun recordOrderFailed(reason: String) {
        ordersFailed.increment(Tags.of("reason", reason))
    }
}

// ✅ Kotlin extension for timer
inline fun <T> Timer.record(block: () -> T): T {
    val sample = Timer.start()
    return try {
        block()
    } finally {
        sample.stop(this)
    }
}

suspend inline fun <T> Timer.recordSuspend(crossinline block: suspend () -> T): T {
    val sample = Timer.start()
    return try {
        block()
    } finally {
        sample.stop(this)
    }
}
```

### 10.3 Health Check — Readiness vs Liveness

```kotlin
// ✅ Readiness: "Am I ready to receive traffic?"
@Component("readiness")
class ServiceReadinessIndicator(
    private val dataSource: DataSource,
    private val circuitBreakerRegistry: CircuitBreakerRegistry,
    private val brokerHealth: MessageBrokerHealthChecker,
) : HealthIndicator {

    override fun health(): Health {
        val details = mutableMapOf<String, Any>()
        var allHealthy = true

        // Database
        runCatching { dataSource.connection.use { it.isValid(1) } }
            .onSuccess { details["database"] = "UP" }
            .onFailure {
                details["database"] = "DOWN: ${it.message}"
                allHealthy = false
            }

        // Message broker
        if (!brokerHealth.isConnected()) {
            details["messageBroker"] = "DOWN"
            allHealthy = false
        } else {
            details["messageBroker"] = "UP"
        }

        // Circuit breakers
        circuitBreakerRegistry.allCircuitBreakers
            .filter { it.state == CircuitBreaker.State.OPEN }
            .forEach { cb ->
                details["circuitBreaker.${cb.name}"] = "OPEN"
                allHealthy = false
            }

        return if (allHealthy) Health.up().withDetails(details).build()
        else Health.down().withDetails(details).build()
    }
}

// ✅ Liveness: "Am I deadlocked? Should Kubernetes restart me?"
// NO external dependency checks here — that causes restart loops
@Component("liveness")
class ServiceLivenessIndicator : HealthIndicator {

    private val threadMXBean: ThreadMXBean = ManagementFactory.getThreadMXBean()

    override fun health(): Health {
        val deadlocked = threadMXBean.findDeadlockedThreads()
        return if (deadlocked != null && deadlocked.isNotEmpty())
            Health.down().withDetail("deadlockedThreads", deadlocked.size).build()
        else
            Health.up().build()
    }
}
```

---

## 11. Testing Standards

### 11.1 Test Pyramid

```
Unit Tests        (60–70%)   Instant · No I/O · Domain logic only · kotest or JUnit 5
Integration Tests  (20–30%)   Real infrastructure via Testcontainers · <5s each
Contract Tests     (~5%)      Pact consumer-driven contracts for events and APIs
E2E Tests          (~5%)      Full service via HTTP against staging

RULE: Never mock what you can Testcontainer
RULE: Unit tests test domain logic — not framework plumbing
RULE: A test that relies only on mocks of the infrastructure is not an integration test
RULE: Use kotest for expressive Kotlin-native assertions
```

### 11.2 Domain Unit Tests — Kotest

```kotlin
// ✅ Kotest BehaviorSpec — BDD-style, reads like documentation
class OrderSpec : BehaviorSpec({

    given("an order creation command with valid lines") {
        val command = CreateOrderCommand(
            customerId = CustomerId("cust-1"),
            idempotencyKey = IdempotencyKey("test-key-abc"),
            currency = Currency.getInstance("USD"),
            lines = listOf(
                OrderLineCommand(ProductId("p1"), "Widget", 2, Money.of("10.00", "USD")),
                OrderLineCommand(ProductId("p2"), "Gadget", 3, Money.of("5.00", "USD")),
            ),
        )

        `when`("the order is created") {
            val order = Order.create(command)

            then("total is correctly calculated") {
                order.totalAmount shouldBe Money.of("35.00", "USD") // 2×10 + 3×5
            }

            then("status is PENDING") {
                order.status shouldBe OrderStatus.PENDING
            }

            then("an OrderCreated domain event is recorded") {
                order.pollDomainEvents()
                    .shouldHaveSize(1)
                    .first()
                    .shouldBeInstanceOf<OrderCreatedEvent>()
            }
        }
    }

    given("a confirmed order") {
        val order = OrderFixtures.aConfirmedOrder()

        `when`("cancellation is attempted") {
            then("throws InvalidOrderStateException") {
                shouldThrow<InvalidOrderStateException> {
                    order.cancel(CancellationReason("customer request", "customer"))
                }.also { ex ->
                    ex.errorCode shouldBe "INVALID_ORDER_STATE"
                    ex.context["currentStatus"] shouldBe "CONFIRMED"
                }
            }
        }
    }
})

// ✅ FunSpec — for unit tests without BDD ceremony
class MoneyTest : FunSpec({

    test("adding money of same currency returns sum") {
        val a = Money.of("10.00", "USD")
        val b = Money.of("5.50", "USD")
        a.add(b) shouldBe Money.of("15.50", "USD")
    }

    test("adding money of different currency throws") {
        val usd = Money.of("10.00", "USD")
        val eur = Money.of("5.00", "EUR")
        shouldThrow<IllegalArgumentException> { usd.add(eur) }
            .message shouldContain "Currency mismatch"
    }

    test("money normalizes scale on construction") {
        Money.of("10", "USD").amount.scale() shouldBe 2
        Money.of("10.1", "USD").amount shouldBe BigDecimal("10.10")
    }
})
```

### 11.3 Application Layer Tests — MockK

```kotlin
// ✅ Use MockK for Kotlin-native mocking — never Mockito in Kotlin code
@ExtendWith(MockKExtension::class)
class CreateOrderUseCaseTest {

    @MockK private lateinit var orderRepository: OrderRepository
    @MockK private lateinit var inventoryPort: InventoryPort
    @MockK private lateinit var eventPublisher: DomainEventPublisher
    @MockK private lateinit var idempotencyStore: IdempotencyStore

    private lateinit var useCase: CreateOrderUseCase

    @BeforeEach
    fun setup() {
        useCase = CreateOrderUseCase(orderRepository, inventoryPort, eventPublisher, idempotencyStore)
    }

    @Test
    fun `should create order when inventory is available`() = runTest {
        // Arrange
        val command = CreateOrderCommandFixtures.aValidCommand()
        coEvery { idempotencyStore.isAlreadyProcessed(any()) } returns false
        coEvery { inventoryPort.checkInventory(any()) } returns InventoryStatus.AVAILABLE
        coEvery { orderRepository.save(any()) } answers { firstArg() }
        coJustRun { eventPublisher.publish(any()) }
        coJustRun { idempotencyStore.markProcessed(any(), any()) }

        // Act
        val result = useCase.execute(command)

        // Assert
        result shouldBeInstanceOf OrderResult.Created::class
        coVerify { orderRepository.save(match { it.status == OrderStatus.PENDING }) }
        coVerify { eventPublisher.publish(any<OrderCreatedEvent>()) }
    }

    @Test
    fun `should return AlreadyExists for duplicate idempotency key`() = runTest {
        val command = CreateOrderCommandFixtures.aValidCommand()
        val existingOrder = OrderFixtures.aPendingOrder()
        coEvery { idempotencyStore.isAlreadyProcessed(any()) } returns true
        coEvery { idempotencyStore.getStoredResult<OrderResult>(any()) } returns
            OrderResult.Created(existingOrder)

        val result = useCase.execute(command)

        result shouldBeInstanceOf OrderResult.Created::class
        coVerify { orderRepository wasNot called }
        coVerify { eventPublisher wasNot called }
    }
}
```

### 11.4 Architecture Enforcement Tests — ArchUnit

```kotlin
// ✅ Architecture rules enforced at build time
@AnalyzeClasses(packages = ["com.acme.orders"])
class ArchitectureTest {

    @ArchTest
    val domainHasNoFrameworkDependencies: ArchRule = noClasses()
        .that().resideInAPackage("..domain..")
        .should().dependOnClassesThat()
        .resideInAnyPackage(
            "org.springframework..",
            "jakarta.persistence..",
        )
        .`as`("Domain layer must have zero framework dependencies")

    @ArchTest
    val infrastructureDoesNotLeakIntoDomain: ArchRule = noClasses()
        .that().resideInAPackage("..domain..")
        .should().dependOnClassesThat()
        .resideInAPackage("..infrastructure..")
        .`as`("Domain must not depend on infrastructure")

    @ArchTest
    val applicationOnlyDependsOnDomain: ArchRule = classes()
        .that().resideInAPackage("..application..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage(
            "..domain..",
            "..api..",
            "kotlin..",
            "java..",
            "kotlinx.coroutines..",
        )
        .`as`("Application layer must only use domain and coroutines")

    @ArchTest
    val noNullBangOperator: ArchRule = noClasses()
        .that().resideInAPackage("com.acme.orders..")
        .should(useKotlinNullBang())
        .`as`("The !! operator is forbidden — handle nulls explicitly")
}
```

### 11.5 Integration Tests — Testcontainers + Kotest

```kotlin
// ✅ Shared container base — reused across tests for speed
abstract class IntegrationTestBase : StringSpec() {

    companion object {
        val postgres = PostgreSQLContainer<Nothing>("postgres:16-alpine").apply {
            withDatabaseName("testdb")
            withUsername("test")
            withPassword("test")
            withReuse(true)
            start()
        }

        val redis = GenericContainer<Nothing>("redis:7-alpine").apply {
            withExposedPorts(6379)
            withReuse(true)
            start()
        }
    }

    override fun extensions() = listOf(
        SpringExtension,
        resetDatabaseExtension,
    )
}

// ✅ Circuit breaker integration test
class CircuitBreakerIntegrationTest : IntegrationTestBase() {

    @Autowired private lateinit var inventoryAdapter: InventoryAdapter
    @Autowired private lateinit var circuitBreakerRegistry: CircuitBreakerRegistry

    private val wireMock = WireMockServer(wireMockConfig().dynamicPort())

    init {
        beforeSpec { wireMock.start() }
        afterSpec { wireMock.stop() }

        "circuit breaker should open after failure threshold and return fallback" {
            // Arrange
            wireMock.stubFor(get(urlPathMatching("/inventory/.*"))
                .willReturn(serverError()))

            // Trigger failures
            repeat(15) {
                runCatching {
                    inventoryAdapter.checkInventory(ProductId("p$it"))
                }
            }

            // Circuit should be open
            circuitBreakerRegistry.circuitBreaker("inventory-service").state shouldBe
                CircuitBreaker.State.OPEN

            // Fallback returned — no call made to the service
            val status = inventoryAdapter.checkInventory(ProductId("new-product"))
            status shouldBe InventoryStatus.UNKNOWN

            wireMock.verify(0, getRequestedFor(urlPathMatching("/inventory/new-product")))
        }

        "circuit breaker should half-open after wait duration" {
            // Advance time past the open window...
        }
    }
}
```

---

## 12. Security Standards

### 12.1 Input Validation

```kotlin
// ✅ Validate at the API boundary — Kotlin-idiomatic with Bean Validation
data class CreateOrderRequest(
    @field:NotBlank(message = "customerId is required")
    @field:Size(max = 64)
    @field:Pattern(regexp = "^[a-zA-Z0-9\\-_]+$", message = "customerId contains invalid characters")
    val customerId: String,

    @field:NotEmpty(message = "lines must not be empty")
    @field:Size(min = 1, max = 100, message = "lines must contain 1–100 items")
    @field:Valid
    val lines: List<OrderLineRequest>,

    @field:NotBlank
    @field:Size(min = 8, max = 64)
    @field:Pattern(regexp = "^[a-zA-Z0-9\\-_]+$")
    val idempotencyKey: String,

    @field:NotNull
    @field:Pattern(regexp = "^[A-Z]{3}$", message = "currency must be a 3-letter ISO code")
    val currency: String,
) {
    // ✅ Domain conversion with additional validation
    fun toCommand(): CreateOrderCommand {
        val currency = runCatching { Currency.getInstance(this.currency) }
            .getOrElse { throw IllegalArgumentException("Unknown currency: ${this.currency}") }

        return CreateOrderCommand(
            customerId = CustomerId(customerId),
            idempotencyKey = IdempotencyKey(idempotencyKey),
            currency = currency,
            lines = lines.map { it.toCommand() },
        )
    }
}
```

### 12.2 PII Handling

```kotlin
// ✅ Events carry only IDs — never PII
// ❌ WRONG — PII in event
data class OrderCreatedEvent(
    val orderId: String,
    val customerEmail: String,   // ← PII! Don't!
    val phoneNumber: String,     // ← PII! Don't!
)

// ✅ CORRECT — IDs only, recipient fetches details if needed
data class OrderCreatedEvent(
    val orderId: String,
    val customerId: String,      // Notification service fetches email using customerId
)

// ✅ Masking in logs
object DataMasker {
    fun maskEmail(email: String): String {
        val at = email.indexOf('@')
        return if (at <= 1) "****" else "${email.first()}***${email.substring(at)}"
    }

    fun maskId(id: String): String =
        if (id.length < 6) "****"
        else "${id.take(4)}****${id.takeLast(2)}"

    fun maskCardNumber(cardNumber: String): String =
        "**** **** **** ${cardNumber.takeLast(4)}"
}
```

### 12.3 Secrets Management

```kotlin
// ✅ Secrets validation on startup — fail fast, never start misconfigured
@Component
class SecretsValidator(private val environment: Environment) : InitializingBean {

    private val requiredSecrets = listOf(
        "DB_URL",
        "DB_PASSWORD",
        "BROKER_URL",
        "BROKER_PASSWORD",
    )

    override fun afterPropertiesSet() {
        val missing = requiredSecrets.filter {
            environment.getProperty(it).isNullOrBlank()
        }
        check(missing.isEmpty()) {
            "FATAL: Required secrets not configured: $missing — refusing to start"
        }
    }
}
```

---

## 13. API Design Standards

### 13.1 Coroutine-Based REST Controller

```kotlin
// ✅ Controller is thin — suspend functions, zero business logic
@RestController
@RequestMapping("/api/v1/orders")
@Validated
class OrderController(
    private val createOrderUseCase: CreateOrderUseCase,
    private val getOrderUseCase: GetOrderUseCase,
    private val mapper: OrderDtoMapper,
    private val metrics: OrderServiceMetrics,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    suspend fun createOrder(
        @Valid @RequestBody request: CreateOrderRequest,
        @RequestHeader("X-Idempotency-Key")
        @NotBlank @Size(max = 64) idempotencyKey: String,
    ): OrderResponse {
        val sample = Timer.start()
        return try {
            val command = request.toCommand()
            when (val result = createOrderUseCase.execute(command)) {
                is OrderResult.Created -> {
                    metrics.recordOrderCreated(result.order, sample.stop())
                    result.order.toResponse()
                }
                is OrderResult.AlreadyExists ->
                    throw ResponseStatusException(HttpStatus.CONFLICT,
                        "Already created at ${result.originalCreatedAt}")
                is OrderResult.Rejected ->
                    throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        result.reason)
                is OrderResult.InsufficientInventory ->
                    throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "Insufficient inventory for product ${result.productId}")
            }
        } catch (e: PaymentServiceUnavailableException) {
            throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Service temporarily unavailable, please retry")
        }
    }

    @GetMapping("/{orderId}")
    suspend fun getOrder(@PathVariable @NotBlank orderId: String): ResponseEntity<OrderResponse> =
        getOrderUseCase.execute(OrderId.of(orderId))
            ?.toResponse()
            ?.let { ResponseEntity.ok(it) }
            ?: ResponseEntity.notFound().build()

    // ✅ Streaming endpoint — Flow mapped to SSE or streaming response
    @GetMapping("/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun streamOrders(
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) since: Instant,
    ): Flow<OrderResponse> =
        getOrderUseCase.streamSince(since)
            .map { it.toResponse() }
            .catch { e -> log.warn("Order stream error", e) }
}
```

### 13.2 Global Exception Handler

```kotlin
// ✅ Centralized error mapping — consistent response format
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleValidation(ex: MethodArgumentNotValidException): ErrorResponse {
        val violations = ex.bindingResult.fieldErrors.map { fe ->
            ErrorResponse.FieldViolation(fe.field, fe.defaultMessage ?: "invalid",
                fe.rejectedValue?.toString())
        }
        return ErrorResponse.validation(violations)
    }

    @ExceptionHandler(DomainException::class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    fun handleDomain(ex: DomainException): ErrorResponse {
        log.info("Domain exception: {} - {}", ex.errorCode, ex.message)
        return ErrorResponse.domain(ex.errorCode, ex.message ?: "Domain error")
    }

    @ExceptionHandler(OrderNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(ex: OrderNotFoundException): ErrorResponse =
        ErrorResponse.domain(ex.errorCode, ex.message ?: "Not found")

    @ExceptionHandler(InfrastructureException::class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    fun handleInfrastructure(ex: InfrastructureException, request: HttpServletRequest): ErrorResponse {
        val traceId = MDC.get("traceId")
        log.error("Infrastructure failure on {} {}, traceId={}",
            request.method, request.requestURI, traceId, ex)
        return ErrorResponse.infrastructure("SERVICE_UNAVAILABLE",
            "Service temporarily unavailable. Reference: $traceId")
    }

    @ExceptionHandler(Exception::class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    fun handleUnexpected(ex: Exception, request: HttpServletRequest): ErrorResponse {
        val traceId = MDC.get("traceId")
        log.error("Unhandled exception on {} {}, traceId={}",
            request.method, request.requestURI, traceId, ex)
        return ErrorResponse.infrastructure("INTERNAL_ERROR",
            "Unexpected error. Reference: $traceId")
    }
}

// ✅ Consistent error response — data class
data class ErrorResponse(
    val errorCode: String,
    val message: String,
    val fieldViolations: List<FieldViolation>? = null,
    val timestamp: Instant = Instant.now(),
    val traceId: String? = MDC.get("traceId"),
) {
    data class FieldViolation(
        val field: String,
        val message: String,
        val rejectedValue: String? = null,
    )

    companion object {
        fun validation(violations: List<FieldViolation>) =
            ErrorResponse("VALIDATION_ERROR", "Request validation failed",
                fieldViolations = violations)

        fun domain(code: String, message: String) =
            ErrorResponse(code, message)

        fun infrastructure(code: String, message: String) =
            ErrorResponse(code, message)
    }
}
```

---

## 14. Configuration Management

### 14.1 application.yml — Canonical Baseline

```yaml
spring:
  application:
    name: ${SERVICE_NAME:my-service}
  lifecycle:
    timeout-per-shutdown-phase: 30s

server:
  port: 8080
  shutdown: graceful

management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus, loggers
  endpoint:
    health:
      show-details: when-authorized
      probes:
        enabled: true
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
  # JSON appender configured in logback-spring.xml

features:
  idempotency:
    enabled: true
    ttl: 24h
  outbox:
    poll-interval-ms: 500
    batch-size: 100
  circuit-breaker:
    enabled: ${CB_ENABLED:true}
```

### 14.2 Type-Safe Configuration — `@ConfigurationProperties`

```kotlin
// ✅ Type-safe configuration — no stringly-typed @Value everywhere
@ConfigurationProperties(prefix = "features.outbox")
@ConstructorBinding
data class OutboxProperties(
    val pollIntervalMs: Long = 500,
    val batchSize: Int = 100,
    val maxRetries: Int = 5,
    val enabled: Boolean = true,
)

@ConfigurationProperties(prefix = "features.idempotency")
@ConstructorBinding
data class IdempotencyProperties(
    val enabled: Boolean = true,
    val ttl: Duration = Duration.ofHours(24),
)

// ✅ Validate on startup
@Validated
@ConfigurationProperties(prefix = "http.client")
@ConstructorBinding
data class HttpClientProperties(
    @field:Min(100) @field:Max(30000)
    val connectTimeoutMs: Long = 1000,

    @field:Min(100) @field:Max(30000)
    val readTimeoutMs: Long = 3000,

    @field:Min(1) @field:Max(100)
    val maxConcurrentCalls: Int = 20,
)
```

---

## 15. Build & Dependency Standards

### 15.1 build.gradle.kts Baseline

```kotlin
// build.gradle.kts
plugins {
    kotlin("jvm") version "2.0.x"
    kotlin("plugin.spring") version "2.0.x"
    kotlin("plugin.allopen") version "2.0.x"
    id("org.springframework.boot") version "3.3.x"
    id("io.spring.dependency-management") version "1.1.x"
    id("com.tngtech.archunit") version "1.3.x"
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        freeCompilerArgs.addAll(
            "-Xjsr305=strict",           // Strict null-safety for Spring annotations
            "-Xcontext-receivers",        // Context receivers (experimental)
        )
        allWarningsAsErrors = true       // Treat warnings as errors
    }
}

// ✅ allopen — Spring needs to proxy final classes
allOpen {
    annotation("org.springframework.stereotype.Service")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Repository")
    annotation("org.springframework.web.bind.annotation.RestController")
}

dependencies {
    // ── Kotlin ──────────────────────────────────────────────────────────────
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor")  // For Spring WebFlux
    implementation("io.projectreactor.kotlin:reactor-kotlin-extensions")

    // ── Spring Boot ──────────────────────────────────────────────────────────
    implementation("org.springframework.boot:spring-boot-starter-webflux")   // Coroutine-native
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-validation")

    // ── Resiliency ───────────────────────────────────────────────────────────
    implementation("io.github.resilience4j:resilience4j-spring-boot3:2.2.0")
    implementation("io.github.resilience4j:resilience4j-kotlin:2.2.0")       // Coroutine support
    implementation("io.github.resilience4j:resilience4j-micrometer:2.2.0")

    // ── Observability ────────────────────────────────────────────────────────
    implementation("io.micrometer:micrometer-registry-prometheus")
    implementation("io.micrometer:micrometer-tracing-bridge-otel")
    implementation("net.logstash.logback:logstash-logback-encoder:7.4")

    // ── Serialization ────────────────────────────────────────────────────────
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")

    // ── Testing ──────────────────────────────────────────────────────────────
    testImplementation("io.kotest:kotest-runner-junit5:5.9.x")
    testImplementation("io.kotest:kotest-assertions-core:5.9.x")
    testImplementation("io.kotest.extensions:kotest-extensions-spring:1.3.x")
    testImplementation("io.mockk:mockk:1.13.x")
    testImplementation("com.ninja-squad:springmockk:4.0.x")                   // Spring + MockK
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")
    testImplementation("org.wiremock:wiremock-standalone:3.x")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.x")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test")       // runTest
    testImplementation("au.com.dius.pact.consumer:junit5:4.6.x")
}

tasks.withType<Test> {
    useJUnitPlatform()
    jvmArgs("-Djdk.tracePinnedThreads=full") // Detect virtual thread pinning in tests
}
```

---

## 16. Anti-Patterns — Forbidden List

Every item below must be caught in code review. PRs containing these are rejected.

### Kotlin Idioms

```
❌ The !! operator anywhere in production code
❌ var when val is possible
❌ Mutable collections returned from public methods (return List not MutableList)
❌ Nullable return types when Optional / sealed class / exception expresses intent better
❌ Java-style getters/setters — use Kotlin properties
❌ if/else chains where sealed class + when is cleaner
❌ toString() for serialization or business logic
❌ Copy-pasting Java idioms: Collections.unmodifiableList(), Optional.of(), etc.
❌ lateinit without a clear documented lifecycle justification
❌ object expressions (anonymous objects) for simple lambdas — use lambdas
```

### Coroutines

```
❌ GlobalScope — no lifecycle, orphaned coroutines
❌ Thread.sleep() — use delay()
❌ runBlocking in production suspend call chains — blocks the thread
❌ runBlocking inside a coroutine — deadlock risk
❌ Swallowing CancellationException — always re-throw it
❌ blocking I/O on Dispatchers.Default — use Dispatchers.IO
❌ launch without a parent scope — orphaned coroutine
❌ async without awaiting — fire-and-forget leaks
❌ withTimeout without handling TimeoutCancellationException at the right boundary
❌ collect in a coroutine without backpressure consideration
❌ SharedFlow with replay > 0 when late subscribers should not receive history
❌ Creating a new CoroutineScope without SupervisorJob for service-level scopes
```

### Resiliency

```
❌ External calls without circuit breaker
❌ External calls without timeout
❌ Retrying non-idempotent operations without idempotency protection
❌ Throwing from a fallback method — return safe degraded value
❌ Publishing events inside a DB transaction — use Outbox
❌ Consumer ACK before processing is complete
❌ DLQ messages silently discarded — always persist and alert
❌ Identical retry + circuit breaker instance names — causes interference
```

### Events & Messaging

```
❌ Events containing PII (email, phone, address) — IDs only
❌ Removing or renaming fields in an existing event data class
❌ Consumer processing without idempotency protection
❌ Direct broker publish inside a DB transaction (skip Outbox)
❌ Using Java serialization for events — use JSON / Avro / Protobuf
❌ DLQ events silently dropped — always persist and notify on-call
```

### Security

```
❌ Hardcoded credentials, keys, or passwords
❌ Logging PII — full names, emails, card numbers, passwords
❌ Returning stack traces or internal exception messages to API callers
❌ Skipping input validation for "internal" APIs
❌ Trusting client-supplied IDs for authorisation without server-side verification
```

### Architecture

```
❌ Cross-service DB access or shared schemas
❌ Synchronous call chains deeper than 2 hops
❌ Business logic in controllers, consumers, or DTO mappers
❌ Domain exceptions importing Spring / persistence framework classes
❌ Infrastructure types (entities, documents) leaking into the domain layer
❌ Aggregate state mutated without going through the aggregate root
❌ Companion object used as a service with injected dependencies — use @Service
```

---

## 17. PR Checklist

Before requesting review, every item must be ✅:

**Kotlin Quality**
- [ ] No `!!` operator in production code
- [ ] `var` usage is justified with a comment explaining why `val` isn't possible
- [ ] Public APIs return immutable collections (`List`, not `MutableList`)
- [ ] Sealed classes used for all multi-outcome results (no `Boolean` flags or `null`)
- [ ] `when` expressions on sealed classes are exhaustive (no `else` catch-all hiding missing cases)

**Coroutines**
- [ ] Every coroutine has a named, bounded parent scope (no `GlobalScope`)
- [ ] `CancellationException` is never caught and swallowed
- [ ] Blocking I/O is wrapped in `withContext(Dispatchers.IO)`
- [ ] Every `async` has a corresponding `await()`
- [ ] All suspending calls have an explicit or inherited timeout

**Resiliency**
- [ ] Every new external call has a named circuit breaker, retry, and timeout
- [ ] Every command handler and event consumer is idempotent
- [ ] Fallback methods do not throw — they return safe defaults or degrade
- [ ] Timeout hierarchy documented in code (inner < outer)

**Events**
- [ ] New events have `schemaVersion` field (starting at `1`)
- [ ] No breaking changes to existing event data classes (no field removals/renames)
- [ ] Event publishing uses Outbox pattern (or explicit written justification)
- [ ] DLQ handling implemented for every new consumer

**Code Quality**
- [ ] Zero business logic in controllers, adapters, or mappers
- [ ] Domain module has zero Spring or persistence framework imports
- [ ] All exceptions carry `errorCode` and `context` map
- [ ] No PII in log statements
- [ ] No secrets or credentials in code or config files

**Testing**
- [ ] Domain logic covered by pure unit tests (no Spring context)
- [ ] Outbound ports tested with Testcontainers (not just MockK)
- [ ] Circuit breaker fallback behaviour explicitly tested
- [ ] ArchUnit tests pass — architecture boundaries not violated
- [ ] `runTest` used for all coroutine tests (not `runBlocking`)

**Observability**
- [ ] New business operations emit a counter and a timer metric
- [ ] New service dependencies added to readiness health indicator
- [ ] Significant business transitions have `INFO`-level structured log entries

---

*Template Version: 1.0*
*Stack: Kotlin 2.x · Spring Boot 3.3+ · Coroutines · Resilience4j 2.x · Kotest · MockK*
*Maintained by: Platform Engineering | Review cycle: Quarterly*
*Last reviewed: 2025-Q1*