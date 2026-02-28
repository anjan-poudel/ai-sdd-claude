/**
 * Safe DSL evaluator — no eval(), exec(), or __import__().
 * Pure function: evaluate(expr, context) → boolean.
 */

import type { ASTNode, LiteralValue } from "./types.ts";
import { parse } from "./parser.ts";

type Context = Record<string, unknown>;

/**
 * Resolve a dot-separated path in context.
 * Missing paths return undefined (not an error).
 *
 * Example: resolvePath(["review", "decision"], { review: { decision: "GO" } }) → "GO"
 */
function resolvePath(segments: string[], context: Context): unknown {
  let current: unknown = context;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Compare two values using the given operator.
 */
function compare(left: unknown, op: string, right: unknown): boolean {
  // Null/undefined comparisons: only == and != make sense
  if (left === undefined || left === null) {
    if (op === "==") return right === null || right === undefined;
    if (op === "!=") return right !== null && right !== undefined;
    return false;
  }
  if (right === undefined || right === null) {
    if (op === "==") return left === null || left === undefined;
    if (op === "!=") return left !== null && left !== undefined;
    return false;
  }

  switch (op) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">":  return (left as number) > (right as number);
    case ">=": return (left as number) >= (right as number);
    case "<":  return (left as number) < (right as number);
    case "<=": return (left as number) <= (right as number);
    default:   return false;
  }
}

/**
 * Evaluate an AST node against a context.
 */
function evalNode(node: ASTNode, context: Context): boolean | LiteralValue {
  switch (node.kind) {
    case "or": {
      const left = evalNode(node.left, context);
      const right = evalNode(node.right, context);
      return Boolean(left) || Boolean(right);
    }

    case "and": {
      const left = evalNode(node.left, context);
      const right = evalNode(node.right, context);
      return Boolean(left) && Boolean(right);
    }

    case "not": {
      const val = evalNode(node.operand, context);
      return !Boolean(val);
    }

    case "comparison": {
      const leftVal = resolvePath(node.left.segments, context);
      let rightVal: unknown;

      if (node.right.kind === "literal") {
        rightVal = node.right.value;
      } else {
        // path op path
        rightVal = resolvePath(node.right.segments, context);
      }

      return compare(leftVal, node.op, rightVal);
    }

    case "path": {
      // A bare path shouldn't appear as a top-level expression (parser prevents it),
      // but if it does, resolve it as truthy/falsy
      const val = resolvePath(node.segments, context);
      return val !== null && val !== undefined && val !== false;
    }

    case "literal": {
      return node.value;
    }
  }
}

/**
 * Evaluate an expression string against a context dictionary.
 *
 * @param expression - DSL expression string
 * @param context - flat context dictionary with nested values
 * @returns boolean result; missing paths return false (never throw)
 *
 * @throws ParseError if the expression is syntactically invalid
 */
export function evaluate(expression: string, context: Context): boolean {
  const ast = parse(expression);
  const result = evalNode(ast, context);
  return Boolean(result);
}

/**
 * Evaluate a pre-parsed AST against a context.
 * Use this for performance when the same expression is evaluated many times.
 */
export function evaluateAST(ast: ASTNode, context: Context): boolean {
  const result = evalNode(ast, context);
  return Boolean(result);
}
