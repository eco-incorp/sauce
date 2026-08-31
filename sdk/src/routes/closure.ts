/**
 * Closure route bodies — `() => {...}` accepted as a `SauceBody` alongside a string.
 *
 * Mechanism: `Function.prototype.toString.call(fn)` returns the verbatim declared text
 * (ES2018-spec-guaranteed). We parse `(${text})` with acorn (parsing the parenthesized form is
 * what makes both a `function (){}` expression and an arrow valid inputs to one parse), take the
 * single `ExpressionStatement`'s function node, and either:
 *  - a BLOCK body: slice the ORIGINAL text between the block's own braces using the node's
 *    `start`/`end` ranges (minus the one-character paren offset) and emit `function main() {\n<slice>\n}`
 *    — the slice is verbatim source, so comments/formatting/nested arrows/string literals survive
 *    untouched;
 *  - a CONCISE body (`() => expr`): slice the expression's range and synthesize
 *    `function main() {\n  return <slice>;\n}`.
 *
 * Never hand-slice on `=>` or brace-counting: a `=>` inside a string literal, a template literal,
 * a comment, or a default parameter breaks naive slicing, which is exactly why acorn is used.
 *
 * CAPTURE: there is none, by construction, and that is CORRECT — a free identifier that is neither
 * a chain-scoped ambient name nor a caller-supplied `defines` entry is a hard "`X` is not a declared variable"
 * compile error, which can never silently bake a stale JS value into bytecode.
 */
import * as acorn from "acorn";

export type SauceBody = string | (() => unknown);

class SauceClosureError extends Error {}

function fail(message: string): never {
  throw new SauceClosureError(`sauceBodyToSource: ${message}`);
}

/**
 * Extracts a complete `function main(){...}` program from a closure's own declared source text.
 * Fails closed (never silently falls back) on anything this first cut doesn't support.
 */
export function sauceBodyToSource(body: () => unknown): string {
  if (typeof body !== "function") {
    fail(`expected a function, got ${typeof body}`);
  }

  const text = Function.prototype.toString.call(body) as string;
  if (text.includes("[native code]")) {
    fail(
      "the closure's own toString() returned '[native code]' -- this can happen for a bound/proxied " +
        "function, or under a hostile minifier that strips function bodies; pass a string instead.",
    );
  }

  let parsed: acorn.Node;
  const PAREN_OFFSET = 1; // the leading "(" we prepend below
  try {
    parsed = acorn.parseExpressionAt(`(${text})`, 0, { ecmaVersion: "latest" });
  } catch (err) {
    fail(
      `could not parse the closure's own declared source with acorn (${(err as Error).message}) -- ` +
        "this can happen under a bundler/minifier that rewrites function text; pass a string instead.",
    );
  }

  const fnNode = parsed as unknown as {
    type: string;
    async?: boolean;
    generator?: boolean;
    params?: unknown[];
    body: { type: string; start: number; end: number };
  };

  if (fnNode.type !== "ArrowFunctionExpression" && fnNode.type !== "FunctionExpression") {
    fail(`expected a function/arrow expression, parsed a '${fnNode.type}' instead`);
  }
  if (fnNode.async) {
    fail("an async closure is not supported -- a route body must be synchronous SauceScript");
  }
  if (fnNode.generator) {
    fail("a generator closure is not supported");
  }
  if (fnNode.params !== undefined && fnNode.params.length > 0) {
    fail(
      "a closure with parameters is not supported yet -- main(args) support is a deliberate later " +
        "unit; write a zero-parameter closure or pass a string instead",
    );
  }

  const start = fnNode.body.start - PAREN_OFFSET;
  const end = fnNode.body.end - PAREN_OFFSET;

  if (fnNode.body.type === "BlockStatement") {
    // start/end include the surrounding braces themselves; slice the interior.
    const interior = text.slice(start + 1, end - 1);
    return `function main() {\n${interior}\n}`;
  }

  const exprText = text.slice(start, end);
  return `function main() {\n  return ${exprText};\n}`;
}

/** True for anything `sauceBodyToSource` (rather than the plain string path) should handle. */
export function isSauceClosure(body: SauceBody): body is () => unknown {
  return typeof body === "function";
}
