/**
 * Every mint the SDK classifies in shipped code is classified by its OWNER: an extensionless
 * Token-2022 mint is 82 bytes, byte for byte a legacy SPL mint, so `classifyMintProgram(mint,
 * data)` without the owner takes it for legacy and a swap built on that names the wrong token
 * program. This scans every `.ts` file under `src` and fails, naming the file, line and enclosing
 * function, on a `classifyMintProgram` call given fewer than three arguments (or a spread, whose
 * count it cannot see), however it is imported or aliased.
 *
 * The one exception is `resolveTokenProgram`, the documented data-only resolver for a caller that
 * has no owner (`token-program.ts` says when to prefer `resolveTokenProgramOwned`). It reads the
 * syntax tree, so a comment naming the call is not a finding.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME = "classifyMintProgram";
/** The one call allowed to omit the owner, as `<file>:<enclosing function>`. */
const ALLOWED = ["src/svm/token-program.ts:resolveTokenProgram"];
/** Files the scan must include, so a move cannot leave it passing over nothing. */
const REQUIRED = [
  "src/svm/token-program.ts",
  "src/svm/token-accounts.ts",
  "src/svm/venues/woofi/index.ts",
  "src/svm/venues/raydium-clmm/index.ts",
];

/** The name of the function a node sits in, or `<module>`. */
function enclosingFunction(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (
      (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isFunctionExpression(at)) &&
      at.name !== undefined
    ) {
      return at.name.getText();
    }
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && at.parent !== undefined) {
      const holder = at.parent;
      if (
        (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) &&
        ts.isIdentifier(holder.name)
      ) {
        return holder.name.text;
      }
    }
  }
  return "<module>";
}

/** Each owner-less classification in `text`, as `<file>:<line>: <function>`. */
function ownerlessCalls(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // The local names the function goes by in this file: itself, and any import alias of it.
  const names = new Set([NAME]);
  const collect = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === NAME) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression;
      if (
        ts.isIdentifier(callee) &&
        names.has(callee.text) &&
        (node.arguments.length < 3 || node.arguments.some((arg) => ts.isSpreadElement(arg)))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        findings.push(`${file}:${line + 1}: ${enclosingFunction(node)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

const files = readdirSync(join(SDK, "src"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => relative(SDK, join(entry.parentPath, entry.name)))
  .sort();

describe("every mint is classified by its owner", () => {
  it("scans every source file, the resolver and the venue gates included", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const file of REQUIRED) expect(files).toContain(file);
  });

  it("recognises every owner-less form, and no comment", () => {
    const text = [
      'import { classifyMintProgram, classifyMintProgram as classify } from "../token-program.js";',
      "function gate(mint, data) { return classifyMintProgram(mint, data); }",
      "const arrow = (mint, data) => classify(mint, data);",
      "const spread = (args) => classifyMintProgram(...args);",
      "const nested = (m, d) => tokenProgram.classifyMintProgram(m, d);",
      "function ok(mint, account) { return classifyMintProgram(mint, account.data, account.owner); }",
      "// classifyMintProgram(mint, data) is how it used to read",
      "/** classify(mint, data) */",
      "const other = (a, b) => classifyMintProgramOwned(a, b);",
    ].join("\n");
    expect(ownerlessCalls("x.ts", text)).toEqual([
      "x.ts:2: gate",
      "x.ts:3: arrow",
      "x.ts:4: spread",
      "x.ts:5: nested",
    ]);
  });

  it("finds the gate this PR fixed, as WooFi had it", () => {
    // `gateMint` in sdk/src/svm/venues/woofi/index.ts before the owner-aware loader.
    const before = [
      'import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";',
      "async function gateMint(load: AccountLoader, mint: Address, pool: Address): Promise<void> {",
      "  const data = await load(mint);",
      "  if (data === null) return;",
      "  if (classifyMintProgram(mint, data) === TOKEN_2022_PROGRAM_ID) {",
      "    throw new Error(`woofi: dropping pool ${pool} — mint ${mint} is Token-2022`);",
      "  }",
      "}",
    ].join("\n");
    expect(ownerlessCalls("src/svm/venues/woofi/index.ts", before)).toEqual([
      "src/svm/venues/woofi/index.ts:5: gateMint",
    ]);
  });

  it("finds the documented data-only resolver, and nothing else in src", () => {
    const findings = files.flatMap((file) =>
      ownerlessCalls(file, readFileSync(join(SDK, file), "utf8")),
    );
    // Compared without line numbers, so an edit above the resolver does not fail this.
    expect(findings.map((finding) => finding.replace(/:\d+: /, ":"))).toEqual(ALLOWED);
  });
});
