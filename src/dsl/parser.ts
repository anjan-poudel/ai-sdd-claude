/**
 * Recursive descent parser for the Expression DSL.
 * No eval(), exec(), or __import__() — pure hand-written parser.
 *
 * Grammar:
 *   expr        ::= or_expr
 *   or_expr     ::= and_expr ("or" and_expr)*
 *   and_expr    ::= not_expr ("and" not_expr)*
 *   not_expr    ::= "not" not_expr | comparison | "(" expr ")"
 *   comparison  ::= path op literal | path op path
 *   op          ::= "==" | "!=" | ">" | ">=" | "<" | "<="
 *   path        ::= identifier ("." identifier)*
 *   literal     ::= string_literal | number_literal | bool_literal | null_literal
 */

import type {
  ASTNode,
  ComparisonNode,
  ComparisonOp,
  LiteralNode,
  LiteralValue,
  PathNode,
} from "./types.ts";
import { ParseError } from "./types.ts";

type Token =
  | { kind: "ident"; value: string; pos: number }
  | { kind: "number"; value: number; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "op"; value: string; pos: number }
  | { kind: "lparen"; pos: number }
  | { kind: "rparen"; pos: number }
  | { kind: "dot"; pos: number }
  | { kind: "eof"; pos: number };

const COMPARISON_OPS = new Set(["==", "!=", ">=", "<=", ">", "<"]);

// Disallowed identifiers (security: prevent injection via identifier tricks)
const DISALLOWED_IDENTS = new Set([
  "eval", "exec", "__import__", "__builtins__", "import",
  "open", "os", "sys", "subprocess", "globals", "locals",
  "getattr", "setattr", "delattr", "hasattr", "vars",
]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }

    const pos = i;
    const ch = input[i]!;

    // Parentheses
    if (ch === "(") {
      tokens.push({ kind: "lparen", pos });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", pos });
      i++;
      continue;
    }

    // Dot
    if (ch === ".") {
      tokens.push({ kind: "dot", pos });
      i++;
      continue;
    }

    // Two-char operators
    if (i + 1 < input.length) {
      const two = input.slice(i, i + 2);
      if (COMPARISON_OPS.has(two)) {
        tokens.push({ kind: "op", value: two, pos });
        i += 2;
        continue;
      }
    }

    // Single-char operators
    if (COMPARISON_OPS.has(ch)) {
      tokens.push({ kind: "op", value: ch, pos });
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = "";
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\") {
          i++;
          if (i < input.length) {
            str += input[i];
            i++;
          }
        } else {
          str += input[i];
          i++;
        }
      }
      if (i >= input.length) {
        throw new ParseError("Unterminated string literal", pos, input);
      }
      i++; // consume closing quote
      tokens.push({ kind: "string", value: str, pos });
      continue;
    }

    // Number — consume digits, optional single decimal point + digits
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9]/.test(input[i]!)) {
        num += input[i];
        i++;
      }
      if (i < input.length && input[i] === ".") {
        num += ".";
        i++;
        if (i >= input.length || !/[0-9]/.test(input[i]!)) {
          throw new ParseError("Invalid number literal (expected digits after '.')", pos, input);
        }
        while (i < input.length && /[0-9]/.test(input[i]!)) {
          num += input[i];
          i++;
        }
        // A second dot means invalid (e.g. 1.2.3)
        if (i < input.length && input[i] === ".") {
          throw new ParseError("Invalid number literal (multiple decimal points)", pos, input);
        }
      }
      const parsed = parseFloat(num);
      if (isNaN(parsed)) {
        throw new ParseError(`Invalid number: ${num}`, pos, input);
      }
      tokens.push({ kind: "number", value: parsed, pos });
      continue;
    }

    // Identifier (keyword or path segment)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i]!)) {
        ident += input[i];
        i++;
      }
      // Check for disallowed identifiers (security)
      if (DISALLOWED_IDENTS.has(ident)) {
        throw new ParseError(
          `expression uses disallowed construct: '${ident}'`,
          pos,
          input,
        );
      }
      // Check for function call pattern (identifier followed by '(')
      let j = i;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      if (j < input.length && input[j] === "(") {
        // Only 'not' keyword is allowed to be followed by '(' semantically — but
        // the grammar handles 'not' as a keyword, not as a function call syntax.
        // Any other ident(...) is a function call → disallowed.
        if (ident !== "not" && ident !== "and" && ident !== "or" &&
          ident !== "true" && ident !== "false" && ident !== "null") {
          throw new ParseError(
            `expression uses disallowed construct: function call '${ident}(...)'`,
            pos,
            input,
          );
        }
      }
      tokens.push({ kind: "ident", value: ident, pos });
      continue;
    }

    throw new ParseError(`Unexpected character '${ch}'`, pos, input);
  }

  tokens.push({ kind: "eof", pos: i });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "eof", pos: this.source.length };
  }

  private consume(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private expect(kind: Token["kind"]): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(
        `Expected ${kind} but got ${tok.kind}`,
        tok.pos,
        this.source,
      );
    }
    return this.consume();
  }

  parse(): ASTNode {
    const node = this.parseOrExpr();
    const tok = this.peek();
    if (tok.kind !== "eof") {
      throw new ParseError(
        `Unexpected token '${tok.kind === "ident" ? (tok as { kind: "ident"; value: string; pos: number }).value : tok.kind}' after expression end`,
        tok.pos,
        this.source,
      );
    }
    return node;
  }

  private parseOrExpr(): ASTNode {
    let left = this.parseAndExpr();
    while (
      this.peek().kind === "ident" &&
      (this.peek() as { kind: "ident"; value: string; pos: number }).value === "or"
    ) {
      this.consume(); // consume 'or'
      const right = this.parseAndExpr();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAndExpr(): ASTNode {
    let left = this.parseNotExpr();
    while (
      this.peek().kind === "ident" &&
      (this.peek() as { kind: "ident"; value: string; pos: number }).value === "and"
    ) {
      this.consume(); // consume 'and'
      const right = this.parseNotExpr();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseNotExpr(): ASTNode {
    if (
      this.peek().kind === "ident" &&
      (this.peek() as { kind: "ident"; value: string; pos: number }).value === "not"
    ) {
      this.consume(); // consume 'not'
      const operand = this.parseNotExpr();
      return { kind: "not", operand };
    }

    if (this.peek().kind === "lparen") {
      this.consume(); // consume '('
      const expr = this.parseOrExpr();
      this.expect("rparen");
      return expr;
    }

    return this.parseComparison();
  }

  private parseComparison(): ASTNode {
    const left = this.parsePath();
    const tok = this.peek();

    if (tok.kind === "op") {
      const opStr = (tok as { kind: "op"; value: string; pos: number }).value;
      if (!COMPARISON_OPS.has(opStr)) {
        throw new ParseError(`Unknown operator '${opStr}'`, tok.pos, this.source);
      }
      this.consume(); // consume operator

      const op = opStr as ComparisonOp;
      const right = this.parseOperand();

      const node: ComparisonNode = { kind: "comparison", left, op, right };
      return node;
    }

    // A bare path with no comparison operator is a parse error per spec
    throw new ParseError(
      `Expected comparison operator after path '${left.segments.join(".")}'`,
      tok.pos,
      this.source,
    );
  }

  private parsePath(): PathNode {
    const tok = this.peek();
    if (tok.kind !== "ident") {
      throw new ParseError(
        `Expected identifier, got '${tok.kind}'`,
        tok.pos,
        this.source,
      );
    }

    const identTok = tok as { kind: "ident"; value: string; pos: number };
    // 'not', 'and', 'or', 'true', 'false', 'null' are keywords — not valid path starts
    if (["and", "or", "not", "true", "false", "null"].includes(identTok.value)) {
      throw new ParseError(
        `Keyword '${identTok.value}' cannot be used as a path`,
        tok.pos,
        this.source,
      );
    }
    this.consume();

    const segments: string[] = [identTok.value];

    // Consume dot-separated segments
    while (this.peek().kind === "dot") {
      this.consume(); // consume '.'
      const nextTok = this.peek();
      if (nextTok.kind !== "ident") {
        throw new ParseError(
          `Expected identifier after '.'`,
          nextTok.pos,
          this.source,
        );
      }
      segments.push((nextTok as { kind: "ident"; value: string; pos: number }).value);
      this.consume();
    }

    return { kind: "path", segments };
  }

  private parseOperand(): LiteralNode | PathNode {
    const tok = this.peek();

    // Number literal
    if (tok.kind === "number") {
      this.consume();
      return { kind: "literal", value: (tok as { kind: "number"; value: number; pos: number }).value };
    }

    // Quoted string literal
    if (tok.kind === "string") {
      this.consume();
      return { kind: "literal", value: (tok as { kind: "string"; value: string; pos: number }).value };
    }

    // Keyword literals and identifiers
    if (tok.kind === "ident") {
      const identTok = tok as { kind: "ident"; value: string; pos: number };
      if (identTok.value === "true") {
        this.consume();
        return { kind: "literal", value: true };
      }
      if (identTok.value === "false") {
        this.consume();
        return { kind: "literal", value: false };
      }
      if (identTok.value === "null") {
        this.consume();
        return { kind: "literal", value: null };
      }
      // Unquoted uppercase/mixed-case constant (e.g. GO, PASS, NO_GO)
      if (/^[A-Z_][A-Z_0-9]*$/.test(identTok.value)) {
        this.consume();
        return { kind: "literal", value: identTok.value };
      }
      // Otherwise treat as a path (path op path comparison)
      return this.parsePath();
    }

    throw new ParseError(
      `Expected literal or path, got '${tok.kind}'`,
      tok.pos,
      this.source,
    );
  }
}

/**
 * Parse an expression string into an AST.
 * Throws ParseError if the expression is invalid.
 */
export function parse(expression: string): ASTNode {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens, expression);
  return parser.parse();
}

/**
 * Validate an expression without evaluating it.
 * Returns true if valid, throws ParseError if not.
 */
export function validate(expression: string): true {
  parse(expression);
  return true;
}
