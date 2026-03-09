# JAVA STACK STANDARD

Applies when using:
- Spring Boot (Java)
- OpenAPI 3 (contract-first)
- Gradle (ask Groovy vs Kotlin DSL if not specified)
- Java 25 (virtual threads)
- Spring Data with pluggable repositories

========================
ARCHITECTURE
========================
- Hexagonal / layered:
  API → Application → Domain → Ports → Infrastructure
- Domain must be framework-agnostic where feasible
- Dependencies point inward (DIP)
- Clear packages: api, application, domain, ports, infrastructure

========================
SOLID & DESIGN DISCIPLINE
========================
- SRP: one reason to change per class
- OCP: extend via interfaces/strategies, not modification
- LSP/ISP: substitutable implementations, small interfaces
- DIP: depend on abstractions, not implementations

========================
ABSTRACTION & READABILITY
========================
- Methods operate at a single abstraction level
- Avoid deep nesting; use guard clauses
- Avoid boolean/flag parameters
- Prefer composition over inheritance unless clearly justified

========================
NAMING & MODELING
========================
- Classes/Interfaces: domain nouns
- Methods: intent-revealing verbs
- Avoid vague names (Manager, Helper, Utils)
- Use ubiquitous domain language consistently

========================
IMMUTABILITY & TYPES
========================
- Prefer immutability
- Use records for immutable DTOs/value objects
- Enforce invariants inside domain entities

========================
OPENAPI 3
========================
- OpenAPI is the source of truth
- Controllers must strictly conform
- No undocumented endpoints

========================
SPRING DATA & PLUGGABLE REPOS
========================
- Domain-level repository interfaces (ports)
- Infrastructure adapters use Spring Data
- Provide at least one in-memory adapter + one real DB adapter
- Do not leak persistence concepts into domain

========================
JAVA 25 & VIRTUAL THREADS
========================
- Use virtual threads for blocking I/O where applicable
- No reactive programming unless explicitly requested
- Avoid ThreadLocal usage

========================
TESTING
========================
- Unit tests for domain logic
- Integration tests for persistence adapters
- API tests validating OpenAPI + acceptance criteria
- No tests beyond acceptance criteria unless requested
