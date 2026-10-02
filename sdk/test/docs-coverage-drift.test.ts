/**
 * `docs/api/coverage.md` states how many protocols, descriptors, chains and token symbols the SDK
 * registers. Those are the numbers a reader decides against — "is my protocol in there?" — and
 * nothing else checks them, so they are exactly the sort of claim that goes quietly stale after a
 * registry grows.
 *
 * This reads the numbers back out of the published page and compares them to the live registries.
 * It is deliberately a drift guard and not a formatting test: it locates each figure by the text
 * around it, so the prose can be rewritten freely as long as the figures stay true.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_CHAINS, getAllChainIds } from "../src/chains/index.js";
import { listProtocols } from "../src/protocols/index.js";
import { listDescriptors } from "../src/descriptors/query.js";
import { STOCK_ISSUERS } from "../src/routes/stock-tokens.js";
import { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "../src/routes/token-registry.js";

/** Solana's canonical chain id, whose mints are mainnet-beta's: the page counts them under it. */
const SOLANA = 1399811149;
/** Every chain's rows, an EVM chain's and Solana's, by chain id as the page lists them. */
const ROWS_BY_CHAIN: ReadonlyArray<
  readonly [string, ReadonlyArray<{ symbol: string; stock?: { issuer: string } }>]
> = [...Object.entries(TOKEN_REGISTRY), [String(SOLANA), SVM_TOKEN_REGISTRY["mainnet-beta"]]];

/** `TOKEN_REGISTRY` maps a chain id to a LIST of rows, not a symbol-keyed object. */
const symbolsOf = (rows: (typeof TOKEN_REGISTRY)[number]): string[] =>
  rows.map((row) => row.symbol);

const COVERAGE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/api/coverage.md"),
  "utf8",
);

/** The number the page states, found by a pattern that names the row rather than its position. */
function stated(pattern: RegExp): number {
  const match = pattern.exec(COVERAGE);
  if (match === null) throw new Error(`coverage.md no longer contains ${pattern}`);

  return Number(match[1]);
}

describe("docs/api/coverage.md still states the registry sizes it has", () => {
  it.each([
    ["protocols", /(\d+) protocols with metadata/, () => listProtocols().length],
    ["contract descriptors", /(\d+) descriptors across/, () => listDescriptors().length],
    [
      "protocol namespaces",
      /\d+ descriptors across (\d+) protocol namespaces/,
      () => new Set(listDescriptors().map((d) => d.protocol)).size,
    ],
    [
      "deployed contracts",
      /\| Deployed contract \| (\d+)/,
      () => listDescriptors().filter((d) => d.kind === "singleton").length,
    ],
    [
      "address-only contracts",
      /\| Address only \s*\| (\d+)/,
      () => listDescriptors().filter((d) => d.kind === "address-only").length,
    ],
    [
      "interfaces",
      /\| Interface \s*\| (\d+)/,
      () => listDescriptors().filter((d) => d.kind === "interface").length,
    ],
    ["canonical chains", /(\d+) chains: \d+ EVM and Solana/, () => CANONICAL_CHAINS.length],
    [
      "canonical EVM chains",
      /\d+ chains: (\d+) EVM and Solana/,
      () => CANONICAL_CHAINS.filter((c) => c.kind === "evm").length,
    ],
    [
      "EVM chain metadata records",
      /(\d+) records with native-currency/,
      () => getAllChainIds().length,
    ],
    [
      "token registry chains",
      /\d+ symbols distributed across (\d+) EVM chains/,
      () => Object.keys(TOKEN_REGISTRY).length,
    ],
    [
      "distinct token symbols",
      /(\d+) symbols distributed across \d+ EVM chains/,
      () => new Set(Object.values(TOKEN_REGISTRY).flatMap(symbolsOf)).size,
    ],
    [
      "distinct stock symbols",
      /(\d+) of them tokenized stocks/,
      () =>
        new Set(
          Object.values(TOKEN_REGISTRY).flatMap((rows) =>
            symbolsOf(rows.filter((row) => row.stock !== undefined)),
          ),
        ).size,
    ],
    [
      "Solana mints",
      /(\d+) mints on mainnet-beta/,
      () => SVM_TOKEN_REGISTRY["mainnet-beta"].length,
    ],
    [
      "Solana stock mints",
      /mints on mainnet-beta, (\d+) of them tokenized stocks/,
      () => SVM_TOKEN_REGISTRY["mainnet-beta"].filter((row) => row.stock !== undefined).length,
    ],
  ])("%s", (_name, pattern, actual) => {
    expect(stated(pattern)).toBe(actual());
  });

  it("lists every token-registry chain in its per-chain table", () => {
    for (const [chainId, rows] of Object.entries(TOKEN_REGISTRY)) {
      const chain = CANONICAL_CHAINS.find((c) => String(c.id) === chainId);
      expect(chain).toBeDefined();
      // The row is `| Ethereum | 1 | `USDC`, `USDT`, `WETH` |` -- match the id cell and the symbols
      // after it, so the chain's display name can change without failing.
      const row = new RegExp(`\\|\\s*${chainId}\\s*\\|([^|]*)\\|`).exec(COVERAGE);
      expect(row).not.toBeNull();
      // Its tokenized stocks are counted per issuer in the next table instead.
      for (const symbol of symbolsOf(rows.filter((r) => r.stock === undefined))) {
        expect(row![1]).toContain(symbol);
      }
    }
  });

  it("counts every chain's tokenized stocks per issuer, with examples it registers", () => {
    for (const [chainId, rows] of ROWS_BY_CHAIN) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        if (row.stock !== undefined) {
          counts.set(row.stock.issuer, (counts.get(row.stock.issuer) ?? 0) + 1);
        }
      }
      for (const [issuer, count] of counts) {
        // `| Base | 8453 | Coinbase | 58 | `TSLAc`, `SPCXc`, `NVDAc` |`
        const name = STOCK_ISSUERS[issuer as keyof typeof STOCK_ISSUERS].name;
        const row = new RegExp(
          `\\|\\s*${chainId}\\s*\\|\\s*${name}[^|]*\\|\\s*(\\d+)\\s*\\|([^|]*)\\|`,
        ).exec(COVERAGE);
        expect(row).not.toBeNull();
        expect(Number(row![1])).toBe(count);
        for (const [, symbol] of row![2]!.matchAll(/`([^`]+)`/g)) {
          expect(rows.find((r) => r.symbol === symbol)?.stock?.issuer).toBe(issuer);
        }
      }
    }
  });

  it("names exactly the canonical EVM chains that have no metadata record", () => {
    const metadata = new Set(getAllChainIds().map(String));
    const missing = CANONICAL_CHAINS.filter(
      (c) => c.kind === "evm" && !metadata.has(String(c.id)),
    ).map((c) => c.slug);

    expect(missing.length).toBeGreaterThan(0);
    // One sentence: "`getChain` is a separate metadata lookup ...: <list> are canonical chains with
    // no metadata record." Anchored on both ends, so it cannot run on into the next paragraph, and
    // any run of whitespace matches a space, so reflowing the prose does not break it.
    const words = (text: string) => text.split(" ").join("\\s+");
    const sentence = new RegExp(
      `${words("`getChain` is a separate metadata lookup")}[^.]*?:([^.]*?)\\s+` +
        `${words("are canonical chains with no metadata record")}\\.`,
    ).exec(COVERAGE);
    if (sentence === null) {
      throw new Error(
        "coverage.md no longer has the sentence listing canonical chains with no metadata record " +
          `(\`getChain\` is a separate metadata lookup ...: <chains> are canonical chains with no metadata record.); expected it to name ${missing.join(", ")}`,
      );
    }
    // Each chain the sentence should name and does not, by slug.
    const listed = sentence[1]!.toLowerCase();
    expect(missing.filter((slug) => !listed.includes(slug.toLowerCase()))).toEqual([]);
  });
});
