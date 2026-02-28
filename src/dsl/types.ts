/**
 * AST node types for the Expression DSL.
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

export type ASTNode =
  | OrNode
  | AndNode
  | NotNode
  | ComparisonNode
  | PathNode
  | LiteralNode;

export interface OrNode {
  kind: "or";
  left: ASTNode;
  right: ASTNode;
}

export interface AndNode {
  kind: "and";
  left: ASTNode;
  right: ASTNode;
}

export interface NotNode {
  kind: "not";
  operand: ASTNode;
}

export type ComparisonOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface ComparisonNode {
  kind: "comparison";
  left: PathNode;
  op: ComparisonOp;
  right: LiteralNode | PathNode;
}

export interface PathNode {
  kind: "path";
  segments: string[];
}

export type LiteralValue = string | number | boolean | null;

export interface LiteralNode {
  kind: "literal";
  value: LiteralValue;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly expression: string,
  ) {
    super(`ParseError at position ${position}: ${message}\nExpression: ${expression}`);
    this.name = "ParseError";
  }
}
