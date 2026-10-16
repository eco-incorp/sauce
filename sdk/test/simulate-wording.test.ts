/**
 * What a user reads says simulate, never rehearse: the command is `sauce simulate`, and what it and
 * every other command run with no key is a simulation. Every string the shipped source can show —
 * the `sauce` command's --help, notes, warnings and errors, the MCP server's tool descriptions,
 * instructions and results, the SDK's errors and SauceScript's revert messages — is a string literal
 * in `sdk/src`, `mcp/src` or `actions/src`, so this reads each one with TypeScript's parser and fails
 * any that says rehearse or rehearsal. Comments, identifiers and module specifiers (`./rehearse.js`)
 * are code, not text, and are left alone. The manual and the skills are held to the same rule by
 * `pnpm docs:check` and `pnpm skills:check`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["sdk/src", "mcp/src", "actions/src"];
/** Files the scan must read, so a move cannot leave it passing over nothing. */
const REQUIRED = [
  "sdk/src/cli/run.ts",
  "sdk/src/cli/simulate.ts",
  "mcp/src/tools.ts",
  "mcp/src/server.ts",
];
const WORD = /rehears/i;

/** A module specifier: an import's, an export's, `import("…")`'s or `import("…")` as a type's. */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)
  );
}

/** Every text `source` holds as a string, a template's pieces included, with the line it is on. */
function texts(file: string, source: string): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      !isModuleSpecifier(node)
    ) {
      found.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function shipped(): Map<string, string> {
  const listed = execFileSync("git", ["ls-files", "-z", "--", ...ROOTS], {
    cwd: REPO,
    encoding: "utf-8",
  });
  const out = new Map<string, string>();
  for (const file of listed.split("\0")) {
    if (/\.(?:[cm]?ts|[cm]?js)$/.test(file)) out.set(file, readFileSync(join(REPO, file), "utf-8"));
  }
  return out;
}

describe("what a user reads says simulate", () => {
  it("reads strings, and not comments, identifiers or module specifiers", () => {
    const source = [
      'import { rehearse } from "./rehearse.js";',
      'export type { Rehearsal } from "./rehearse.js";',
      "// A rehearsal of the cook.",
      "const rehearsal = await rehearse();",
      'const lazy = await import("./rehearse.js");',
      'type Lazy = typeof import("./rehearse.js");',
      "throw new Error(`the rehearsal reverts: ${rehearsal.reason}`);",
      'notes.push("rehearsed on block " + block);',
    ].join("\n");
    expect(texts("probe.ts", source).filter(({ text }) => WORD.test(text))).toEqual([
      { line: 7, text: "the rehearsal reverts: " },
      { line: 8, text: "rehearsed on block " },
    ]);
  });

  it("no string the shipped source holds says rehearse or rehearsal", () => {
    const files = shipped();
    for (const file of REQUIRED) expect([...files.keys()]).toContain(file);
    const found: string[] = [];
    let strings = 0;
    for (const [file, source] of files) {
      for (const { line, text } of texts(file, source)) {
        strings++;
        if (WORD.test(text)) found.push(`${file}:${line}: ${JSON.stringify(text)}`);
      }
    }
    // The command's --help alone is thousands of strings: a scan that read a handful read nothing.
    expect(strings).toBeGreaterThan(10_000);
    expect(found).toEqual([]);
  });
});
