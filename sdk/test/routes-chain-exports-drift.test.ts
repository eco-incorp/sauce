/**
 * DRIFT GUARD for the generated chain-accessor exports.
 *
 * Two independent assertions, deliberately not one:
 *  1. Generator-vs-committed: what `gen-route-globals.mjs --stdout` produces
 *     RIGHT NOW, string-equal to the committed `chain-exports.generated.ts`.
 *     Spawned as a child process (not imported) both because jest's transform
 *     here only matches `.ts`/`.js` (a `.mjs` isn't importable under this
 *     config) and because spawning is the more faithful "what would the
 *     generator actually produce" check.
 *  2. Registry-vs-committed, generator-INDEPENDENT: every canonical chain's
 *     PascalCase name appears exactly once as an `export const <Name>` in the
 *     committed file. This is what stops a BROKEN generator from making
 *     assertion 1 vacuously pass (the same gap
 *     `test/svm/engine-abi-drift.test.ts` calls out: "a NEW artifact key the
 *     generator silently dropped").
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalChains } from "../src/chains/canonical.js";
import { TOKEN_REGISTRY, svmClusterOf, svmTokenRows } from "../src/routes/token-registry.js";
import { pascalOfSlug } from "../src/routes/index.js";

const SDK_DIR = resolve(process.cwd());
const SCRIPT_PATH = resolve(SDK_DIR, "scripts", "gen-route-globals.mjs");
const GENERATED_PATH = resolve(SDK_DIR, "src", "routes", "chain-exports.generated.ts");

describe("chain-accessor exports drift guard", () => {
  const committed = readFileSync(GENERATED_PATH, "utf8");

  it("the committed file matches what the generator produces from the current registry right now", () => {
    const fresh = execFileSync(process.execPath, [SCRIPT_PATH, "--stdout"], {
      cwd: SDK_DIR,
      encoding: "utf8",
    });
    expect(committed).toBe(fresh);
  });

  it("every canonical chain's PascalCase name has exactly one export (generator-independent)", () => {
    for (const c of canonicalChains) {
      const name = pascalOfSlug(c.slug);
      const matches =
        committed.match(new RegExp(`^export const ${name} = composedChainGlobal\\(`, "gm")) ?? [];
      expect(matches).toHaveLength(1);
    }
  });

  it("the chain export count is exactly canonicalChains.length -- no extra, no missing", () => {
    const decls = committed.match(/^export const \w+ = composedChainGlobal\(/gm) ?? [];
    expect(decls).toHaveLength(canonicalChains.length);
  });

  it("`chain` and the universal `Token` are exported alongside the chains, each exactly once", () => {
    // Both halves of `Token` are load-bearing and pinned together: `TokenApi` is the object API
    // (and the reason this is not `any`), `TokenFactory` is the call signature that makes
    // `Token(addr)` typecheck in a typed closure body. Dropping either silently removes a
    // capability — `routes-chain-exports-types.test.ts` is what proves each one actually works.
    expect(committed.match(/^export \{ chain \} from "\.\/accessors\.js";$/gm) ?? []).toHaveLength(
      1,
    );
    expect(committed.match(/^export const Token: TokenApi & TokenFactory = /gm) ?? []).toHaveLength(
      1,
    );
  });

  it("`--check` exits 0 against the committed file (no drift)", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT_PATH, "--check"], { cwd: SDK_DIR, encoding: "utf8" }),
    ).not.toThrow();
  });

  it("every chain export is typed through `Composed<...>`, so a generator that dropped the contract tree can't pass vacuously", () => {
    for (const c of canonicalChains) {
      const name = pascalOfSlug(c.slug);
      // Solana's mainnet ALSO carries `& SvmVenueAccessors` -- see the dedicated assertion below,
      // which pins that suffix to exactly that chain: devnet has none of the venues' pools.
      const svm = svmClusterOf(c) === "mainnet-beta" ? " & SvmVenueAccessors" : "";
      // ...and a chain with registry tokens `& Tokens<"USDC" | ...>`, pinned below: an EVM
      // chain's tokens, a Solana chain's registered mints.
      const rows = c.kind === "svm" ? svmTokenRows(c) : (TOKEN_REGISTRY[c.id] ?? []);
      const symbols = rows.map((row) => JSON.stringify(row.symbol));
      const tokens = symbols.length > 0 ? ` & Tokens<${symbols.join(" | ")}>` : "";
      expect(committed).toContain(
        `export const ${name} = composedChainGlobal("${name}") as Composed<"${name}">${svm}${tokens};`,
      );
    }
    // `Composed` itself is what carries `ChainContracts` onto every one of them.
    expect(committed).toContain(
      `type Composed<N extends keyof ChainGlobals> = ChainGlobals[N] & ChainContracts;`,
    );
  });

  it("the `& SvmVenueAccessors` intersection appears exactly once, on Solana's mainnet, and on no other", () => {
    const venueChains = canonicalChains.filter((c) => svmClusterOf(c) === "mainnet-beta");
    expect(venueChains.map((c) => c.slug)).toEqual(["solana"]);
    const matches = committed.match(/& SvmVenueAccessors[; ]/g) ?? [];
    expect(matches).toHaveLength(venueChains.length);
  });

  it("the generated module declares no ambient globals -- the whole surface is exports", () => {
    expect(committed).not.toContain("declare global");
  });

  it("the generator source itself carries the Token name-collision guard (statically present, not just asserted by this suite)", () => {
    const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
    expect(scriptSrc).toContain("TOKEN_GLOBAL_NAME");
    expect(scriptSrc).toMatch(/collides with the fixed .* export/);
  });
});
