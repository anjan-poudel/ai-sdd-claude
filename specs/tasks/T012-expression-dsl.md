# T012: Expression DSL and Safe Evaluator

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** none
**Size:** S (4 days)
**Source:** Synthesized-Codex (GAP-L2-001)

---

## Context

All `exit_conditions`, gate expressions, and policy conditions in workflow YAML are currently untyped string literals. Without a formal grammar and safe evaluator, they either require Python `eval()` (prompt injection / code execution risk) or ad-hoc parsing (inconsistent behavior across overlays).

The Expression DSL provides a whitelist-only grammar evaluated by a safe evaluator with no access to Python builtins, file system, or network.

---

## Acceptance Criteria

```gherkin
Feature: Expression DSL

  Scenario: Simple equality expression evaluates correctly
    Given expression "review.decision == GO"
    And task context { "review": { "decision": "GO" } }
    When the evaluator runs
    Then the result is true

  Scenario: Numeric threshold evaluates correctly
    Given expression "confidence_score >= 0.85"
    And task context { "confidence_score": 0.90 }
    When the evaluator runs
    Then the result is true

  Scenario: Boolean path lookup evaluates correctly
    Given expression "pair.challenger_approved == true"
    And task context { "pair": { "challenger_approved": true } }
    When the evaluator runs
    Then the result is true

  Scenario: Compound AND expression
    Given expression "policy_gate.verdict == PASS and hil.resolved == true"
    And context { "policy_gate": { "verdict": "PASS" }, "hil": { "resolved": true } }
    When the evaluator runs
    Then the result is true

  Scenario: Missing path returns false (not error)
    Given expression "review.decision == GO"
    And task context with no "review" key
    When the evaluator runs
    Then the result is false
    And no exception is raised

  Scenario: Invalid expression fails at load time
    Given workflow YAML with exit_condition "os.system('rm -rf /')"
    When the workflow loads
    Then a validation error is raised: "expression uses disallowed construct"
    And the workflow does not execute

  Scenario: No eval() in codebase
    Given the evaluator module
    When the source code is scanned
    Then no calls to eval(), exec(), or __import__() are present

  Scenario: Golden corpus passes
    Given the golden test corpus of 30 valid and 20 invalid expressions
    When all expressions are parsed
    Then all valid expressions parse without error
    And all invalid expressions raise a parse/validation error
```

---

## DSL Grammar (Formal)

```
expr        ::= or_expr
or_expr     ::= and_expr ("or" and_expr)*
and_expr    ::= not_expr ("and" not_expr)*
not_expr    ::= "not" not_expr | comparison | "(" expr ")"
comparison  ::= path op literal | path op path
op          ::= "==" | "!=" | ">" | ">=" | "<" | "<="
path        ::= identifier ("." identifier)*
literal     ::= string_literal | number_literal | bool_literal | null_literal
string_literal ::= /[A-Z_a-z][A-Z_a-z0-9]*/   # unquoted constant (e.g., GO, PASS)
                 | '"' [^"]* '"'                # quoted string
number_literal ::= /[0-9]+(\.[0-9]+)?/
bool_literal   ::= "true" | "false"
null_literal   ::= "null"
identifier     ::= /[a-z_][a-z_0-9]*/
```

**Allowed**: path lookups, comparisons, logical operators, literals.
**Disallowed**: function calls, imports, list indexing, arithmetic, string concatenation.

---

## Context Shape

The evaluator operates over a flat task context dictionary:

```python
context = {
    "review": { "decision": "GO" },
    "confidence_score": 0.87,
    "pair": { "challenger_approved": False },
    "policy_gate": { "verdict": "PASS" },
    "hil": { "resolved": True },
    "loop": { "iteration": 2 }
}
```

Paths like `review.decision` are resolved by walking the dict keys. Missing paths return `None` (falsy), never raise.

---

## Implementation Notes

- Parser: recursive descent (or PEG library like `lark`); no `eval()`, no `exec()`.
- Validation at workflow load time: every `exit_conditions` expression is parsed; any parse failure halts load.
- Validation error message includes: expression text, position of error, expected tokens.
- Evaluator is pure function: `evaluate(expr_string: str, context: dict) -> bool`.
- All allowed path prefixes are whitelisted from the workflow's defined context keys.

---

## Golden Test Corpus (Sample)

| Expression | Context | Expected |
|---|---|---|
| `review.decision == GO` | `{"review": {"decision": "GO"}}` | true |
| `confidence_score >= 0.85` | `{"confidence_score": 0.90}` | true |
| `confidence_score >= 0.85` | `{"confidence_score": 0.70}` | false |
| `pair.challenger_approved == true` | `{"pair": {"challenger_approved": true}}` | true |
| `not (review.decision == GO)` | `{"review": {"decision": "NO_GO"}}` | true |
| `a == b and c == d` | `{"a": "x", "b": "x", "c": "y", "d": "y"}` | true |
| `missing.path == GO` | `{}` | false |
| `eval("1+1")` | any | **ParseError** |
| `__import__("os")` | any | **ParseError** |
| `review.decision` | any | **ParseError** (no operator) |

---

## Files to Create

- `dsl/grammar.py`
- `dsl/parser.py`
- `dsl/evaluator.py`
- `dsl/tests/golden/valid.yaml`
- `dsl/tests/golden/invalid.yaml`
- `dsl/tests/test_dsl.py`

---

## Test Strategy

- Unit tests: golden corpus (30 valid + 20 invalid expressions).
- Unit tests: all operator types, all literal types, nested AND/OR/NOT.
- Security tests: attempt injection patterns (`eval`, `exec`, `__import__`, OS commands) — all must raise ParseError.
- Integration test: workflow with DSL expressions loads and evaluates correctly at runtime.

## Rollback/Fallback

- If DSL validation fails at load, emit a clear error with the expression and position.
- Never fall back to `eval()` or `exec()` — fail loudly.
