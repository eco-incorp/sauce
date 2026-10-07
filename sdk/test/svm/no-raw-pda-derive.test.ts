/**
 * Every program-derived address the SDK computes goes through the shared memo
 * (src/svm/venues/pda-memo.ts): a raw derivation re-runs the SHA-256 hashing and the ed25519
 * on-curve check on every call, for an address that never changes. This scans every `.ts` file
 * under `src` and fails, naming the file and line, on a derivation anywhere but the memo:
 *
 *   - a call to, an import of or a definition named like kit's `getProgramDerivedAddress`, a
 *     `find…Pda` helper (`findAssociatedTokenPda`, and every Codama-generated client's), or a
 *     Codama `get…InstructionAsync` builder, which derives its PDA accounts itself;
 *   - a hand-rolled `create_program_address`: the `"ProgramDerivedAddress"` marker it hashes, an
 *     on-curve check (`isOffCurveAddress`, `assertIsOffCurveAddress`, `offCurveAddress`,
 *     `compressedPointBytesAreOnCurve`), or a function named `createProgramAddress`.
 *
 * It reads the syntax tree, so a comment naming one of these is not a finding. A re-export is not
 * a derivation either: `svm/kit.ts` hands kit's `getProgramDerivedAddress` to a consumer's own code.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The one file allowed to derive. */
const MEMO = "src/svm/venues/pda-memo.ts";
/** Files the scan must include, so a move cannot leave it passing over nothing. */
const REQUIRED = [MEMO, "src/svm/kitchen.ts", "src/svm/portal.ts", "src/svm/alt.ts"];

const RAW_NAMES = new Set([
  "getProgramDerivedAddress",
  "createProgramAddress",
  "isOffCurveAddress",
  "assertIsOffCurveAddress",
  "offCurveAddress",
  "compressedPointBytesAreOnCurve",
]);
const isRaw = (name: string): boolean =>
  RAW_NAMES.has(name) || /^find[A-Z]\w*Pda$/.test(name) || /^get\w+InstructionAsync$/.test(name);

/** Each raw derivation in `text`, as `<file>:<line>: <what>`. */
function rawDerivations(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: string[] = [];
  const report = (node: ts.Node, what: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push(`${file}:${line + 1}: ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression;
      if (ts.isIdentifier(callee) && isRaw(callee.text)) report(node, `calls ${callee.text}`);
    } else if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (isRaw(imported)) report(node, `imports ${imported}`);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      isRaw(node.name.text)
    ) {
      report(node, `defines ${node.name.text}`);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "ProgramDerivedAddress"
    ) {
      report(node, 'hashes the "ProgramDerivedAddress" marker');
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
const findingsOf = (file: string): string[] =>
  rawDerivations(file, readFileSync(join(SDK, file), "utf8"));

describe("no PDA is derived outside the memo", () => {
  it("scans every source file, the memo and the routed sites included", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const file of REQUIRED) expect(files).toContain(file);
  });

  it("recognises every raw form, and no comment", () => {
    const text = [
      'import { getProgramDerivedAddress as derive, isOffCurveAddress } from "@solana/kit";',
      'import { findAssociatedTokenPda } from "@solana-program/token";',
      "const ix = await getCreateLookupTableInstructionAsync({ authority, payer, recentSlot });",
      "const [a] = await getProgramDerivedAddress({ programAddress, seeds });",
      "const [b] = await findAssociatedTokenPda({ owner, mint, tokenProgram });",
      'const digest = sha256(pool, programId, "ProgramDerivedAddress");',
      "if (!isOffCurveAddress(key)) throw new Error();",
      "function createProgramAddress(seeds, programId) {}",
      "const c = kit.getProgramDerivedAddress({ programAddress, seeds });",
      "// getProgramDerivedAddress(...), sha256(..., 'ProgramDerivedAddress'), isOffCurveAddress(k)",
      "/** findAssociatedTokenPda({ owner, mint }) */",
      'const d = memoizedCreateProgramAddress(programId, seeds); export { getProgramDerivedAddress } from "@solana/kit";',
    ].join("\n");
    expect(rawDerivations("x.ts", text)).toEqual([
      "x.ts:1: imports getProgramDerivedAddress",
      "x.ts:1: imports isOffCurveAddress",
      "x.ts:2: imports findAssociatedTokenPda",
      "x.ts:3: calls getCreateLookupTableInstructionAsync",
      "x.ts:4: calls getProgramDerivedAddress",
      "x.ts:5: calls findAssociatedTokenPda",
      'x.ts:6: hashes the "ProgramDerivedAddress" marker',
      "x.ts:7: calls isOffCurveAddress",
      "x.ts:8: defines createProgramAddress",
      "x.ts:9: calls getProgramDerivedAddress",
    ]);
  });

  it("finds the derivations in the memo itself", () => {
    expect(findingsOf(MEMO)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/calls getProgramDerivedAddress$/),
        expect.stringMatching(/calls isOffCurveAddress$/),
        expect.stringMatching(/"ProgramDerivedAddress" marker$/),
      ]),
    );
  });

  it("finds none anywhere else in src", () => {
    expect(files.filter((file) => file !== MEMO).flatMap(findingsOf)).toEqual([]);
  });
});
