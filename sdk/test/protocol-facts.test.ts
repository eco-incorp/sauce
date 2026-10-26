/**
 * Registry facts a docs review found wrong, each checked against the chain or the verified source
 * before it was corrected, and pinned here so the wrong one cannot come back.
 *
 * - Superfluid's Host differs per chain: Polygon's was copied to Ethereum, Optimism, Base and
 *   Arbitrum, where it has no code. Each chain's is Superfluid's own (`contractsV1.host` in
 *   `@superfluid-finance/metadata`'s networks.json), and each has code there.
 * - The OP Stack L1StandardBridge's `depositETH`/`depositERC20` revert when a contract calls them
 *   ("StandardBridge: function can only be called from an EOA"), and a program runs in its Pot.
 *   The templates use the `*To` forms.
 * - GMX V1's `acceptablePrice` is a direction-specific bound on the mark price (BasePositionManager
 *   `_increasePosition`/`_decreasePosition`), not 0 for "market": the templates take it.
 * - The generated pages say which of an ABI's functions a deployment's code lacks (Arbitrum's
 *   bridged wstETH has none of WstETH's wrapping or rate functions).
 * - Exported JSDoc of the Solana venues is rendered as Markdown: a bare `a*b` pair is emphasis.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

import * as baseBridge from "../src/protocols/base-bridge/functions.js";
import * as gmxV1 from "../src/protocols/gmx-v1/functions.js";
import * as optimismBridge from "../src/protocols/optimism-bridge/functions.js";
import { deployments as superfluid } from "../src/protocols/superfluid/addresses.js";

const SDK = resolve(process.cwd());
const ROOT = resolve(SDK, "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** The code fences of a Markdown document. */
const fences = (markdown: string): string[] =>
  [...markdown.matchAll(/```[a-z]*\n([^]*?)```/g)].map((m) => m[1]!);

describe("Superfluid: each chain's own Host", () => {
  // Superfluid's networks.json, `contractsV1.host`, by chain id.
  const HOSTS: Record<number, string> = {
    1: "0x4E583d9390082B65Bef884b629DFA426114CED6d",
    10: "0x567c4B141ED61923967cA25Ef4906C8781069a10",
    137: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
    8453: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
    42161: "0xCf8Acb4eF033efF16E8080aed4c7D5B9285D2192",
  };

  it("names Superfluid's Host on every chain it records", () => {
    expect(Object.fromEntries(superfluid.map((d) => [d.chainId, d.addresses.host]))).toEqual(HOSTS);
  });
});

describe("OP Stack bridges: a Pot deposits with the *To forms", () => {
  const SENDER_DEFAULT = /\.deposit(?:ETH|ERC20)\(/;

  it.each([
    ["base-bridge", baseBridge],
    ["optimism-bridge", optimismBridge],
  ])("%s's templates and document", (slug, templates) => {
    const programs = [
      ...Object.values<string>(templates),
      ...fences(read(`skills/sauce-protocols/references/${slug}.md`)),
    ];
    expect(programs.length).toBeGreaterThanOrEqual(4);
    for (const program of programs) {
      expect(program).not.toMatch(SENDER_DEFAULT);
      expect(program).toMatch(/\.deposit(?:ETH|ERC20)To\(/);
    }
  });
});

describe("GMX V1: acceptablePrice is the caller's bound", () => {
  /** The arguments of the first `name(` call in `program`, split at top-level commas. */
  const argsOf = (program: string, name: string): string[] => {
    const start = program.indexOf(`${name}(`) + name.length + 1;
    const args: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of program.slice(start)) {
      if (ch === ")" && depth === 0) break;
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else current += ch;
    }
    if (current.trim()) args.push(current.trim());
    return args;
  };
  const document = fences(read("skills/sauce-protocols/references/gmx-v1.md")).join("\n");

  it.each([
    // createIncreasePosition(path, indexToken, amountIn, minOut, sizeDelta, isLong, acceptablePrice, …)
    ["createIncreasePosition", 6, gmxV1.openPosition],
    // createDecreasePosition(path, indexToken, collateralDelta, sizeDelta, isLong, receiver, acceptablePrice, …)
    ["createDecreasePosition", 6, gmxV1.closePosition],
  ] as const)("%s passes it through, in the template and the document", (fn, index, template) => {
    expect(argsOf(template, fn)[index]).toBe("acceptablePrice");
    expect(argsOf(document, fn)[index]).toBe("acceptablePrice");
  });
});

describe("generated pages: an ABI's functions a deployment lacks", () => {
  const lido = read("docs/reference/protocols/lido.md");
  const row = (chain: string): string =>
    lido.split("\n").find((line) => line.startsWith(`| [${chain}]`) && line.includes("wstETH"))!;

  it("marks Arbitrum's bridged wstETH, and only it", () => {
    for (const fn of ["wrap", "unwrap", "getStETHByWstETH", "getWstETHByStETH"]) {
      expect(row("Arbitrum One")).toContain(`\`${fn}\``);
    }
    expect(row("Arbitrum One")).toContain("not on this deployment");
    expect(row("Ethereum")).not.toContain("not on this deployment");
  });
});

describe("Solana venues: exported JSDoc renders as Markdown", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
    });
  /** A paragraph's `*`s outside code and bold that Markdown may read as emphasis. */
  const strays = (comment: string): string[] =>
    comment
      .replace(/^\/\*\*|\*\/$/g, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n")
      .replace(/```[^]*?```/g, "")
      .split(/\n\s*\n/)
      .map((p) => p.replace(/`[^`\n]*`/g, "").replace(/\*\*[^*\n]+\*\*/g, ""))
      .filter((p) => (p.match(/\S\*|\*\S/g) ?? []).length >= 2);

  it("has no bare multiplication pair in an exported declaration's comment", () => {
    const found: string[] = [];
    for (const file of files(join(SDK, "src", "svm", "venues"))) {
      const text = readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        const exported =
          ts.canHaveModifiers(statement) &&
          ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!exported) continue;
        for (const range of ts.getLeadingCommentRanges(text, statement.pos) ?? []) {
          const comment = text.slice(range.pos, range.end);
          if (!comment.startsWith("/**")) continue;
          for (const p of strays(comment)) found.push(`${file.slice(SDK.length)}: ${p.trim()}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
