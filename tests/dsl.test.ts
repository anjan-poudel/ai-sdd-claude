/**
 * T012: DSL golden corpus — 30 valid + 20 invalid expressions
 */

import { describe, it, expect } from "bun:test";
import { evaluate } from "../src/dsl/evaluator.ts";
import { parse, validate } from "../src/dsl/parser.ts";
import { ParseError } from "../src/dsl/types.ts";

// ─── Valid Expressions ────────────────────────────────────────────────────────

describe("DSL: valid expressions", () => {
  it("01 simple equality — GO", () => {
    expect(evaluate("review.decision == GO", { review: { decision: "GO" } })).toBe(true);
  });

  it("02 simple equality — fail when wrong value", () => {
    expect(evaluate("review.decision == GO", { review: { decision: "NO_GO" } })).toBe(false);
  });

  it("03 numeric >= threshold passes", () => {
    expect(evaluate("confidence_score >= 0.85", { confidence_score: 0.90 })).toBe(true);
  });

  it("04 numeric >= threshold fails", () => {
    expect(evaluate("confidence_score >= 0.85", { confidence_score: 0.70 })).toBe(false);
  });

  it("05 boolean path true", () => {
    expect(evaluate("pair.challenger_approved == true", { pair: { challenger_approved: true } })).toBe(true);
  });

  it("06 boolean path false", () => {
    expect(evaluate("pair.challenger_approved == true", { pair: { challenger_approved: false } })).toBe(false);
  });

  it("07 compound AND — both true", () => {
    expect(evaluate(
      "policy_gate.verdict == PASS and hil.resolved == true",
      { policy_gate: { verdict: "PASS" }, hil: { resolved: true } },
    )).toBe(true);
  });

  it("08 compound AND — one false", () => {
    expect(evaluate(
      "policy_gate.verdict == PASS and hil.resolved == true",
      { policy_gate: { verdict: "PASS" }, hil: { resolved: false } },
    )).toBe(false);
  });

  it("09 compound OR — one true", () => {
    expect(evaluate("a == X or b == Y", { a: "Z", b: "Y" })).toBe(true);
  });

  it("10 compound OR — both false", () => {
    expect(evaluate("a == x or b == y", { a: "z", b: "z" })).toBe(false);
  });

  it("11 NOT negation of true", () => {
    expect(evaluate("not (review.decision == GO)", { review: { decision: "NO_GO" } })).toBe(true);
  });

  it("12 NOT negation of false", () => {
    expect(evaluate("not (review.decision == GO)", { review: { decision: "GO" } })).toBe(false);
  });

  it("13 missing path returns false", () => {
    expect(evaluate("review.decision == GO", {})).toBe(false);
  });

  it("14 missing nested path returns false (no exception)", () => {
    expect(evaluate("review.decision == GO", { review: {} })).toBe(false);
  });

  it("15 != operator", () => {
    expect(evaluate("status != FAILED", { status: "COMPLETED" })).toBe(true);
  });

  it("16 != operator — equal values", () => {
    expect(evaluate("status != FAILED", { status: "FAILED" })).toBe(false);
  });

  it("17 < operator", () => {
    expect(evaluate("loop.iteration < 5", { loop: { iteration: 3 } })).toBe(true);
  });

  it("18 <= operator boundary", () => {
    expect(evaluate("loop.iteration <= 5", { loop: { iteration: 5 } })).toBe(true);
  });

  it("19 > operator", () => {
    expect(evaluate("score > 0.9", { score: 0.95 })).toBe(true);
  });

  it("20 == with null literal", () => {
    expect(evaluate("value == null", { value: null })).toBe(true);
  });

  it("21 == with null — non-null value", () => {
    expect(evaluate("value == null", { value: "something" })).toBe(false);
  });

  it("22 deeply nested path", () => {
    expect(evaluate("a.b.c == OK", { a: { b: { c: "OK" } } })).toBe(true);
  });

  it("23 quoted string literal", () => {
    expect(evaluate('status == "COMPLETED"', { status: "COMPLETED" })).toBe(true);
  });

  it("24 quoted string with spaces", () => {
    expect(evaluate('message == "hello world"', { message: "hello world" })).toBe(true);
  });

  it("25 complex AND + OR", () => {
    expect(evaluate(
      "a == X and b == Y or c == Z",
      { a: "X", b: "Y", c: "Z" },
    )).toBe(true);
  });

  it("26 NOT with compound", () => {
    expect(evaluate(
      "not (a == x and b == y)",
      { a: "x", b: "z" },
    )).toBe(true);
  });

  it("27 false literal comparison", () => {
    expect(evaluate("active == false", { active: false })).toBe(true);
  });

  it("28 integer equality", () => {
    expect(evaluate("count == 3", { count: 3 })).toBe(true);
  });

  it("29 path op path comparison", () => {
    expect(evaluate("a == b", { a: "same", b: "same" })).toBe(true);
  });

  it("30 path op path comparison — different values", () => {
    expect(evaluate("a == b", { a: "x", b: "y" })).toBe(false);
  });
});

// ─── Invalid Expressions ──────────────────────────────────────────────────────

describe("DSL: invalid expressions (must throw ParseError)", () => {
  const invalidCases = [
    { name: "01 eval() call", expr: 'eval("1+1")' },
    { name: "02 exec() call", expr: 'exec("rm -rf /")' },
    { name: "03 __import__ call", expr: '__import__("os")' },
    { name: "04 os.system call", expr: "os.system('rm -rf /')" },
    { name: "05 bare path (no operator)", expr: "review.decision" },
    { name: "06 missing right operand", expr: "review.decision ==" },
    { name: "07 missing left operand", expr: "== GO" },
    { name: "08 list indexing", expr: "items[0] == x" },
    { name: "09 arithmetic expression", expr: "a + b == c" },
    { name: "10 string concatenation", expr: "a + b" },
    { name: "11 unknown operator ~=", expr: "a ~= b" },
    { name: "12 unterminated string", expr: 'status == "OPEN' },
    { name: "13 mismatched parens", expr: "(a == b" },
    { name: "14 extra tokens after expr", expr: "a == b c == d" },
    { name: "15 bare keyword 'and'", expr: "and a == b" },
    { name: "16 bare keyword 'or'", expr: "or a == b" },
    { name: "17 double operator", expr: "a == == b" },
    { name: "18 invalid number literal", expr: "score == 1.2.3" },
    { name: "19 function call pattern", expr: "len(items) == 5" },
    { name: "20 import via ident", expr: "import == ok" },
  ];

  for (const { name, expr } of invalidCases) {
    it(name, () => {
      expect(() => parse(expr)).toThrow(ParseError);
    });
  }
});

// ─── Security: no eval/exec in evaluator ──────────────────────────────────────

describe("DSL: security invariants", () => {
  it("evaluate() returns boolean — never throws on missing path", () => {
    expect(() => evaluate("deeply.nested.missing.path == GO", {})).not.toThrow();
    expect(evaluate("deeply.nested.missing.path == GO", {})).toBe(false);
  });

  it("validate() returns true for valid expression", () => {
    expect(validate("status == COMPLETED")).toBe(true);
  });

  it("disallowed construct raises ParseError with message", () => {
    let err: unknown;
    try {
      parse("eval('1+1')");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).message).toContain("disallowed construct");
  });
});
