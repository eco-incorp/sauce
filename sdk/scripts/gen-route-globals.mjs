#!/usr/bin/env node
// Generates sdk/src/routes/chain-exports.generated.ts from src/chains/canonical.ts's
// CANONICAL_CHAINS — one NAMED EXPORT per canonical chain, so a consumer writes
// `import { Base, Solana } from "@eco-incorp/sauce"`.
//
// NOT A `declare global` BLOCK ANY MORE. This used to emit ambient
// `declare global { const Base: ...; ... }` to match a runtime install-on-import.
// Both halves are gone: the TypeScript surface is imports only, and globals are a
// SauceScript concept (compile-time, chain-scoped names inside a route body —
// `USDC`, `Uniswap`, generated separately into ./source-globals.generated.ts).
// `installRouteGlobals()` still exists for a host that deliberately wants the bare
// spelling at run time, but it installs no types and nothing calls it by default.
//
// Each export is typed with the chain's registry tokens too (`Base.USDC`, from
// src/routes/token-registry.ts's TOKEN_REGISTRY), so a symbol the chain has no
// row for is a type error rather than an `undefined` at run time.
//
// WHY THE REGISTRY IS EXECUTED, NOT REGEXED. `scripts/lib/load-ts.mjs` transpiles
// canonical.ts and token-registry.ts with the `typescript` package and evaluates
// them, so the generator reads the SAME `CANONICAL_CHAINS` and `TOKEN_REGISTRY`
// the SDK itself ships, not a hand-parsed approximation that could drift from a
// syntax change.
//
// Regenerate: `node scripts/gen-route-globals.mjs` (writes the file) or
// `node scripts/gen-route-globals.mjs --stdout` (prints, used by the jest
// drift test) or `--check` (exit 1 on drift, for a future CI wire-up).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createTsLoader } from "./lib/load-ts.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");
const OUT_PATH = resolve(SDK_DIR, "src", "routes", "chain-exports.generated.ts");

/** Runtime mirror of `PascalOf`/`pascalOfSlug` (builder.ts) -- duplicated
 * here for the same reason `createChainAccessors` throws on a duplicate
 * key: this generator must independently notice a collision, not trust the
 * SDK's own copy to have caught it. */
function pascalOfSlug(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const load = createTsLoader(SDK_DIR);

function loadCanonicalChains() {
  const chains = load("src/chains/canonical.ts").CANONICAL_CHAINS;
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error("CANONICAL_CHAINS in src/chains/canonical.ts is missing or empty.");
  }
  return chains;
}

/** chain id -> the registry's token symbols there, in registry order: an EVM chain's tokens, and
 *  a Solana chain's registered mints (what `registryTokens` puts on its export). */
function loadTokenSymbols(chains) {
  const { TOKEN_REGISTRY, svmTokenRows } = load("src/routes/token-registry.ts");
  const symbols = new Map(
    Object.entries(TOKEN_REGISTRY).map(([id, rows]) => [Number(id), rows.map((row) => row.symbol)]),
  );
  for (const chain of chains.filter((c) => c.kind === "svm")) {
    symbols.set(
      chain.id,
      svmTokenRows(chain).map((row) => row.symbol),
    );
  }
  return symbols;
}

/** The one fixed, non-chain global this generator also emits -- see gen-route-globals.mjs's
 * caller in globals.ts for the matching runtime install (`Token`). Not derived from
 * CANONICAL_CHAINS, but still collision-checked against it below. */
const TOKEN_GLOBAL_NAME = "Token";

function render(chains, tokensByChain) {
  const seen = new Map();
  const lines = [];
  for (const c of chains) {
    const name = pascalOfSlug(c.slug);
    const prior = seen.get(name);
    if (prior !== undefined) {
      throw new Error(`duplicate chain export '${name}' (from slugs '${prior}' and '${c.slug}')`);
    }
    if (name === TOKEN_GLOBAL_NAME) {
      throw new Error(
        `chain export '${name}' (slug '${c.slug}') collides with the fixed '${TOKEN_GLOBAL_NAME}' export`,
      );
    }
    seen.set(name, c.slug);
    // svm chains additionally carry the svm venue accessor tree
    // (`Solana.RaydiumCpSwap`, ...) -- see routes/composed.ts's matching
    // runtime `origin.chain.kind === "svm"` branch. Derived from `c.kind`,
    // not a hardcoded slug, so a second svm chain gets this for free.
    const svm = c.kind === "svm" ? " & SvmVenueAccessors" : "";
    const symbols = tokensByChain.get(c.id) ?? [];
    const tokens =
      symbols.length > 0
        ? ` & Tokens<${symbols.map((symbol) => JSON.stringify(symbol)).join(" | ")}>`
        : "";
    lines.push(`/** eco-routes chain accessor for ${c.name} (chain id ${c.id}). */`);
    lines.push(
      `export const ${name} = composedChainGlobal("${name}") as Composed<"${name}">${svm}${tokens};`,
    );
  }

  return `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-route-globals.mjs from src/chains/canonical.ts's
// CANONICAL_CHAINS. Regenerate with \`node scripts/gen-route-globals.mjs\` after
// a registry change; sdk/test/routes-globals-drift.test.ts fails CI on drift.
//
// One NAMED EXPORT per canonical chain: \`import { Base, Solana } from "@eco-incorp/sauce"\`.
// Nothing here touches \`globalThis\` -- see ./globals.ts for the opt-in install, and
// ./source-globals.generated.ts for the separate, compile-time names a SauceScript
// route BODY sees (\`USDC\`, \`Uniswap\`), which are not a TypeScript runtime surface.
//
// Typing each entry as \`ChainGlobals["<Name>"]\` rather than spelling out
// \`ChainGlobal\` buys a free structural cross-check: \`ChainGlobals\` is keyed
// by \`PascalOf<ChainSlug>\`, so a name that no longer exists in the registry
// fails \`tsc\` here before the drift test even runs.
//
// Composition is EAGER at module eval -- measured at ~6ms warm (~20ms cold) for all 41
// chains and every registry namespace, against ~400ms just to load the modules involved --
// because every contract
// namespace underneath is a memoising getter, so composing only copies property
// descriptors and builds nothing under \`Base.Uniswap\` until it is touched. A
// lazily-evaluated named export is not expressible in ESM anyway.
//
// \`Token\` is re-exported here with \`TokenFactory\` intersected in, which is what makes
// \`Token(addr).approve(...)\` typecheck in a TYPED CLOSURE body and not only in one
// supplied as source text. It is intersected here rather than declared on \`TokenApi\`
// because the runtime \`Token\` value is a frozen object and is not callable -- the
// \`Token(x)\` spelling is rewritten before the compiler sees it (a write to
// \`@sauce/token\`'s SafeERC20 function, a read to \`IERC20.at(x)\`) and is never invoked
// by the host.
//
// Every chain export carries \`SauceIntentCall\` the same way: the SauceScript call that opens an
// intent in the deprecated form, \`Ethereum(() => { ... }, { tokens }).reward({ tokens })\`, ahead of the
// host signature, so a closure that still writes it typechecks with the chain imported. Its
// \`Portal\` is the host's (\`ChainPortal\`), which takes a SauceScript token value and amount as well
// as an address, so a closure's \`Ethereum.Portal.send({ token: USDC, amount })...\` typechecks too.
import type { ChainGlobals } from "./builder.js";
import type { ChainContracts } from "../descriptors/accessors.js";
import type { SvmVenueAccessors } from "../svm/accessors.js";
import type { TokenApi, TokenFactory } from "../token/api.js";
import { Token as tokenApi } from "../token/api.js";
import { composedChainGlobal } from "./composed.js";
import type { SauceIntentCall } from "./source-globals.generated.js";
import type { RegistryToken } from "./token-registry.js";

/** What every chain accessor is: the SauceScript intent a closure opens, then the eco-routes
 *  DSL for that chain (callable, plus \`.chain\`/\`.route\`/\`.Portal\`), intersected with the
 *  chain-independent native contract tree. Naming the chain through \`ChainGlobals\` is the
 *  structural cross-check above. */
type Composed<N extends keyof ChainGlobals> = SauceIntentCall & ChainGlobals[N] & ChainContracts;

/** The chain's registry tokens, by symbol: \`Base.USDC\` is \`{ address, decimals, symbol, chain }\`. */
type Tokens<S extends string> = { readonly [K in S]: RegistryToken };

${lines.join("\n")}

/** Runtime-resolved origin: \`chain('eth')\`, \`chain(8453)\`. */
export { chain } from "./accessors.js";

/** Universal token interface — ERC20 on EVM targets, SPL Token on svm. Callable as
 *  \`Token(addr)\` in a route body (the wrapper, rewritten to \`IERC20.at(addr)\`), and carries
 *  the runtime spec-object API for use outside one. */
export const Token: TokenApi & TokenFactory = tokenApi as TokenApi & TokenFactory;
`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const chains = loadCanonicalChains();
  const text = render(chains, loadTokenSymbols(chains));

  if (args.has("--stdout")) {
    process.stdout.write(text);
    return;
  }
  if (args.has("--check")) {
    const current = readFileSync(OUT_PATH, "utf8");
    if (current !== text) {
      process.stderr.write(
        `${OUT_PATH} is stale -- run \`node scripts/gen-route-globals.mjs\` to regenerate.\n`,
      );
      process.exitCode = 1;
      return;
    }
    return;
  }
  writeFileSync(OUT_PATH, text);
  process.stdout.write(`wrote ${OUT_PATH}\n`);
}

main();
