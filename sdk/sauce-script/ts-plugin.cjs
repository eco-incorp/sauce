// A TypeScript language service plugin for SauceScript program files (`*.sauce.ts`): it removes
// the errors TypeScript reports on what is valid SauceScript and no declaration can describe.
//
//   - An integer index, `xs[i]` with `i` a `bigint` (TS2538). Every SauceScript number is a 256-bit
//     integer, so every index is a bigint, and TypeScript refuses a bigint index outright.
//   - A number and a bigint together: `x == 0`, `n + 1`, `f(500)` where a bigint is declared, a
//     bigint stored where TypeScript inferred a number (`let pool = 0; pool = f()`), and the
//     `number | bigint` of `c ? x : 0` (TS2365, TS2367, TS2322, TS2345). In SauceScript `1` and `1n`
//     are the same integer, an account compares as its address (`program == 0x06dd…`), and so does
//     a token or a contract, which is zero on a chain without it (`UniswapV3.Factory != 0`).
//   - With `await` on, the SDK manifest's one switch (`awaitSupported` in
//     `src/plugin/manifest.json`, read below; off while the compiler has no `await`): an `await`
//     that is a statement of `main`'s body, or of a closure's a call takes, or of a `try` block or
//     a branch of an `if` ending the body standing in either (TS1308). SauceScript then needs no
//     `async`: `await x; rest` is `x.then(() => { rest })`, as in JavaScript, and the compiler
//     builds the closure. An `await` anywhere else is refused by the compile, and TypeScript's
//     error on it stays. With it off, TypeScript's error on every `await` stays, as the compile
//     refuses each.
//
// Everything else TypeScript reports stays: a misspelled builtin, a wrong argument count, a method a
// contract does not have, and a name the program never declares, whatever its case: a program's
// inputs are `main`'s parameters, so an undeclared name is a mistake the compile also refuses. Only
// `*.sauce.ts` files are filtered; any other file in the project is left as TypeScript reports it.
// `sauce init` names this plugin in the program directory's tsconfig.json; tsserver loads it from
// the project's own `node_modules`, so an editor has to run the workspace's TypeScript for it to
// load (the declarations need nothing of the kind).
"use strict";

/** The SDK's manifest: `dist/plugin/` beside this file's copy in `dist/sauce-script/`, or the source
 *  one when this file is loaded from `sdk/sauce-script/`. */
/* eslint-disable @typescript-eslint/no-require-imports -- tsserver loads a plugin as CommonJS */
const MANIFEST = (() => {
  try {
    return require("../plugin/manifest.json");
  } catch {
    return require("../src/plugin/manifest.json");
  }
})();
/* eslint-enable @typescript-eslint/no-require-imports */

/** `one`, or a union of it: `c ? x : 0` is `number | bigint`. */
const UNION = (one) => String.raw`${one}(?: \| ${one})*`;
/** A TypeScript type that is a SauceScript number: `bigint`, `number`, a literal of either. */
const NUMBER = UNION(String.raw`(?:bigint|number|-?\d+n?|SauceInt)`);
/** ... or an `Account` (`Account<Writable, Signer>`), a token (`bigint & SauceTokenSource`) or a
 *  contract (`SauceContract<…Methods>`), each of which compares as its address. */
const INT = UNION(
  String.raw`(?:bigint|number|-?\d+n?|SauceInt|Account(?:<[\w, ]*>)?|bigint & Sauce\w+|SauceContract<\w+>)`,
);

const PATTERNS = {
  // Type 'bigint' cannot be used as an index type. / Type '0n' cannot be …
  2538: new RegExp(String.raw`^Type '${NUMBER}' cannot be used as an index type`),
  // Operator '+' cannot be applied to types 'number' and 'bigint'.
  2365: new RegExp(String.raw`^Operator '[^']+' cannot be applied to types '${INT}' and '${INT}'`),
  // This comparison appears to be unintentional because the types 'bigint' and 'number' have no overlap.
  2367: new RegExp(String.raw`because the types '${INT}' and '${INT}' have no overlap`),
  // Type 'number' is not assignable to type 'bigint'. / Type 'number | bigint' is not assignable …
  2322: new RegExp(String.raw`^Type '${NUMBER}' is not assignable to type '${NUMBER}'`),
  // Argument of type '500' is not assignable to parameter of type 'bigint'.
  2345: new RegExp(
    String.raw`^Argument of type '${NUMBER}' is not assignable to parameter of type '${NUMBER}'`,
  ),
};

/**
 * Whether `diagnostic` is one TypeScript reports on valid SauceScript. `flatten` is TypeScript's
 * `flattenDiagnosticMessageText`; `ts`, TypeScript itself, reads where an `await` stands.
 */
function isFalsePositive(diagnostic, flatten, ts) {
  if (diagnostic.code === 1308) {
    return MANIFEST.awaitSupported === true && ts !== undefined && awaitsInProgram(diagnostic, ts);
  }
  const pattern = PATTERNS[diagnostic.code];

  return pattern !== undefined && pattern.test(flatten(diagnostic.messageText, "\n"));
}

/**
 * Whether the `await` TypeScript wants an `async` function around (TS1308) is a statement directly
 * in `main`'s body or in the body of a closure a call takes, or in a `try` block standing there, or
 * in a branch of an `if` there with nothing after it: where SauceScript takes one.
 */
function awaitsInProgram(diagnostic, ts) {
  const file = diagnostic.file;
  if (file === undefined || diagnostic.start === undefined) return false;
  let awaited;
  const visit = (node) => {
    if (awaited !== undefined || diagnostic.start < node.pos || diagnostic.start >= node.end) {
      return;
    }
    if (ts.isAwaitExpression(node) && node.getStart(file) === diagnostic.start) {
      awaited = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  const first = awaited?.parent;
  if (first === undefined || !ts.isExpressionStatement(first)) return false;
  let statement = first;
  let tried = false;
  for (;;) {
    const parent = statement.parent;
    // A branch of an `if` that is one statement stands where the `if` does.
    if (ts.isIfStatement(parent)) {
      statement = parent;
      continue;
    }
    if (parent === undefined || !ts.isBlock(parent)) return false;
    // A `try` or an `if` the `await` stands in ends its body: a statement after it would run
    // wherever the branch taken continued.
    if (statement !== first && parent.statements[parent.statements.length - 1] !== statement) {
      return false;
    }
    const owner = parent.parent;
    // An `await` in a `try` block (one, not nested) or in a branch of an `if` stands where the
    // `try` or the `if` does.
    if (ts.isTryStatement(owner) && owner.tryBlock === parent && !tried) {
      tried = true;
      statement = owner;
      continue;
    }
    if (ts.isIfStatement(owner)) {
      statement = owner;
      continue;
    }

    return (
      (ts.isFunctionDeclaration(owner) && owner.name?.text === "main") ||
      (ts.isArrowFunction(owner) && ts.isCallExpression(owner.parent))
    );
  }
}

const isProgram = (fileName) => /\.sauce\.ts$/.test(fileName);

function init(modules) {
  const ts = modules.typescript;

  return {
    create(info) {
      const service = info.languageService;
      const proxy = Object.create(null);
      for (const key of Object.keys(service)) {
        const member = service[key];
        proxy[key] = typeof member === "function" ? member.bind(service) : member;
      }
      proxy.getSemanticDiagnostics = (fileName) => {
        const diagnostics = service.getSemanticDiagnostics(fileName);

        return isProgram(fileName)
          ? diagnostics.filter(
              (diagnostic) => !isFalsePositive(diagnostic, ts.flattenDiagnosticMessageText, ts),
            )
          : diagnostics;
      };

      return proxy;
    },
  };
}

init.isFalsePositive = isFalsePositive;
init.isProgram = isProgram;
module.exports = init;
