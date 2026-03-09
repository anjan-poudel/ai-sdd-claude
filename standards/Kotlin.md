# KOTLIN STACK STANDARD

Applies when using:
- Spring Boot + Kotlin
- OpenAPI 3 (contract-first)
- Gradle Kotlin DSL
- Java 25 (virtual threads)
- Spring Data with pluggable repositories

========================
ARCHITECTURE
========================
- Hexagonal / layered:
  API → Application → Domain → Ports → Infrastructure
- Domain should be framework-agnostic
- Dependencies point inward (DIP)

========================
SOLID & DESIGN DISCIPLINE
========================
- SRP, OCP, LSP, ISP, DIP are mandatory
- Small, cohesive classes
- Extend via strategies/ports, not modification

========================
KOTLIN EXTENSION FUNCTIONS (MANDATORY)
========================
Use extension functions to improve readability and express intent.

Required uses:
- Replace low-level conditionals with intention-revealing semantics
- Break large blocks into readable, self-documenting steps
- Improve domain expressiveness

Rules:
- Extensions must clarify intent
- Do not hide side effects or heavy computation
- No generic Utils dumping grounds
- Name extensions using domain language

========================
KOTLIN IDIOMS & CONCISENESS
========================
- Prefer immutability
- Avoid “!!”
- data classes only for pure data
- sealed classes for closed hierarchies; interfaces for open extension
- Use scope functions intentionally; avoid dense chaining
- Prefer clarity over cleverness

========================
SELF-DOCUMENTING CODE
========================
- Naming and structure over comments
- Comments explain “why”, never “what”

========================
OPENAPI 3
========================
- OpenAPI is the source of truth
- Controllers must strictly conform
- No undocumented endpoints

========================
SPRING DATA & PLUGGABLE REPOS
========================
- Domain-level repository interfaces
- Infrastructure adapters implement them
- At least one in-memory adapter + one real DB adapter
- Ask for DB choice if not specified

========================
JAVA 25 & VIRTUAL THREADS
========================
- Use virtual threads for blocking I/O
- No reactive programming unless explicitly requested
- Avoid ThreadLocal usage

========================
TESTING
========================
- Unit tests for domain logic
- Integration tests for persistence adapters
- API tests validating OpenAPI + acceptance criteria
