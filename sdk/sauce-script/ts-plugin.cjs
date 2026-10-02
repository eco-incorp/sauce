// A TypeScript language service plugin for SauceScript program files (`*.sauce.ts`): it removes
// the errors TypeScript reports on what is valid SauceScript and no declaration can describe.
//
//   - An integer index, `xs[i]` with `i` a `bigint` (TS2538). Every SauceScript number is a 256-bit
//     integer, so every index is a bigint, and TypeScript refuses a bigint index outright.
//   - A number and a bigint together: `x == 0`, `n + 1`, `f(500)` where a bigint is declared
//     (TS2365, TS2367, TS2322, TS2345). In SauceScript `1` and `1n` are the same integer, and an
//     account compares as its address (`program == 0x06dd…`).
//   - An undeclared UPPER_CASE name (TS2304, TS2552): a define, which the compile is given
//     (`--define AMOUNT=5`) and the editor is not. A misspelled one still fails the compile.
//
// Everything else TypeScript reports stays: a misspelled builtin, a wrong argument count, a method a
// contract does not have. Only `*.sauce.ts` files are filtered; any other file in the project is
// left as TypeScript reports it. `sauce init` names this plugin in the program directory's
// tsconfig.json; tsserver loads it from the project's own `node_modules`, so an editor has to run
// the workspace's TypeScript for it to load (the declarations need nothing of the kind).
"use strict";

const DEFINE = /^[A-Z][A-Z0-9_]*$/;
/** A TypeScript type that is a SauceScript integer: `bigint`, `number`, a literal of either, or an
 *  `Account` (`Account<Writable, Signer>`), which compares as its address. */
const INT = String.raw`(?:bigint|number|-?\d+n?|SauceInt|Account(?:<[\w, ]*>)?)`;
const BIGINT = String.raw`(?:bigint|-?\d+n)`;
const NUMBER = String.raw`(?:number|-?\d+)`;

const PATTERNS = {
  // Type 'bigint' cannot be used as an index type. / Type '0n' cannot be …
  2538: new RegExp(String.raw`^Type '${BIGINT}' cannot be used as an index type`),
  // Operator '+' cannot be applied to types 'number' and 'bigint'.
  2365: new RegExp(String.raw`^Operator '[^']+' cannot be applied to types '${INT}' and '${INT}'`),
  // This comparison appears to be unintentional because the types 'bigint' and 'number' have no overlap.
  2367: new RegExp(String.raw`because the types '${INT}' and '${INT}' have no overlap`),
  // Type 'number' is not assignable to type 'bigint'.
  2322: new RegExp(String.raw`^Type '${NUMBER}' is not assignable to type '${BIGINT}'`),
  // Argument of type '500' is not assignable to parameter of type 'bigint'.
  2345: new RegExp(
    String.raw`^Argument of type '${NUMBER}' is not assignable to parameter of type '${BIGINT}'`,
  ),
};

/**
 * Whether `diagnostic` is one TypeScript reports on valid SauceScript. `flatten` is TypeScript's
 * `flattenDiagnosticMessageText`.
 */
function isFalsePositive(diagnostic, flatten) {
  const text = flatten(diagnostic.messageText, "\n");
  if (diagnostic.code === 2304 || diagnostic.code === 2552) {
    const name = /^Cannot find name '([^']+)'/.exec(text);

    return name !== null && DEFINE.test(name[1]);
  }
  const pattern = PATTERNS[diagnostic.code];

  return pattern !== undefined && pattern.test(text);
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
              (diagnostic) => !isFalsePositive(diagnostic, ts.flattenDiagnosticMessageText),
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
