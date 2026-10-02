// The integer rule SauceScript a reader sees is held to: `docs:check` applies it to the manual's
// programs (`docs/examples/*.sauce.ts` and its SauceScript fences), `skills:check` to the skills'
// (example programs, ```sauce blocks, references, the SauceScript reference's programs).
//
// PLAIN INTEGERS. SauceScript writes an integer plainly: `0`, `3000`, `10 ** 18`, an address as its
// hex. The compiler reads every integer literal from its text as a 256-bit integer, so `1n` is the
// same integer and compiles to the same program (`sdk/test/integer-literals.test.ts` holds that on
// both targets); the `n` is TypeScript's, and a reader copies what it is shown. So a program here
// writes none. TypeScript host code is exempt — a runner, a ```ts fence, a closure in a `.ts` file —
// because there `tsc` types the literal, and a `bigint` beside a `number` is its error. Comments are
// not code, and are not read.
//
// An exception is the owning checker's: file -> literal as written -> why, and one nothing needs
// fails.

/** Every `n`-suffixed integer literal in `source`'s code, as written, with its line (1-based). */
export function bigintLiterals(ts, source) {
  const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.BigIntLiteral) {
      const start = node.getStart(file);
      found.push({
        start,
        end: node.end,
        text: source.slice(start, node.end),
        line: file.getLineAndCharacterOfPosition(start).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** `source` with every integer literal written plainly: each literal's `n` dropped, nothing else. */
export function withPlainIntegers(ts, source) {
  let out = source;
  for (const { end } of bigintLiterals(ts, source).reverse()) {
    out = out.slice(0, end - 1) + out.slice(end);
  }
  return out;
}

/**
 * The problems with one program's `source` (`where` names it; `line` is the line its first line is
 * on, for a fenced block): each `n`-suffixed integer literal, unless `allowed` (literal as written ->
 * why) allows it. `used` collects the allowed literals met, so the caller can fail an allowance
 * nothing needs any more.
 */
export function bigintLiteralProblems({ where, source, ts, line = 1, allowed = {}, used }) {
  const problems = [];
  for (const literal of bigintLiterals(ts, source)) {
    if (Object.hasOwn(allowed, literal.text)) {
      used?.add(literal.text);
      continue;
    }
    problems.push(
      `${where}:${line + literal.line - 1}: writes ${literal.text}: write the integer plainly, ` +
        `${literal.text.slice(0, -1)} (SauceScript reads both as the same integer)`,
    );
  }
  return problems;
}
