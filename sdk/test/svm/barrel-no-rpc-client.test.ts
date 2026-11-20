/**
 * `@eco-incorp/sauce/svm` does not load Sauce's Kitchen client implementation. That module
 * calls `createSolanaRpc` and `createSolanaRpcSubscriptions` and is available separately as
 * `@eco-incorp/sauce/svm/client`; the barrel re-exports its types only. This test walks relative
 * runtime imports in Sauce's own sources, not bare-package edges such as `@solana/kit`, whose
 * RPC-related dependencies still load. A value re-export of `./client.js` must fail the test.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as client from "../../src/svm/client.js";
import * as svm from "../../src/svm/index.js";

const SVM_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/svm");
const RPC_CONSTRUCTORS = new Set(["createSolanaRpc", "createSolanaRpcSubscriptions"]);

/** The source file a relative specifier names from `from`, or undefined for a package or a missing file. */
function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base.replace(/\.js$/, ".ts"),
    join(base.replace(/\.js$/, ""), "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Sauce source files reached through relative runtime imports; type-only edges are erased and bare packages are not traversed. */
function runtimeClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        const typeOnly =
          clause !== undefined &&
          (clause.isTypeOnly ||
            (clause.name === undefined &&
              clause.namedBindings !== undefined &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.length > 0 &&
              clause.namedBindings.elements.every((element) => element.isTypeOnly)));
        if (!typeOnly) specifier = statement.moduleSpecifier.text;
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const typeOnly =
          statement.isTypeOnly ||
          (statement.exportClause !== undefined &&
            ts.isNamedExports(statement.exportClause) &&
            statement.exportClause.elements.length > 0 &&
            statement.exportClause.elements.every((element) => element.isTypeOnly));
        if (!typeOnly) specifier = statement.moduleSpecifier.text;
      }
      const next = specifier === undefined ? undefined : resolveRelative(file, specifier);
      if (next !== undefined) queue.push(next);
    }
  }
  return seen;
}

/** Whether a source names an RPC constructor as an identifier: a comment that mentions one does not. */
function namesRpcConstructor(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const walk = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && RPC_CONSTRUCTORS.has(node.text)) ||
    ts.forEachChild(node, walk) === true;
  return walk(source);
}

describe("the ./svm barrel", () => {
  it("exports the Kitchen client factory from ./svm/client and not from the barrel", () => {
    expect(typeof client.createSauceSvmClient).toBe("function");
    expect("createSauceSvmClient" in svm).toBe(false);
  });

  it("reaches no Sauce source naming an RPC constructor through relative runtime imports", () => {
    const reached = runtimeClosure(join(SVM_DIR, "index.ts"));
    expect(reached.size).toBeGreaterThan(10);
    expect(reached.has(join(SVM_DIR, "client.ts"))).toBe(false);
    const constructing = [...reached].filter(namesRpcConstructor);
    expect(constructing).toEqual([]);
  });

  it("re-exports the Kitchen client types without a runtime edge", () => {
    // `export type *` leaves no runtime edge, so the closure above stays free of client.ts; the names a consumer imports as types stay on the barrel
    const source = readFileSync(join(SVM_DIR, "index.ts"), "utf8");
    expect(source).toMatch(/^export type \* from "\.\/client\.js";$/m);
  });
});
