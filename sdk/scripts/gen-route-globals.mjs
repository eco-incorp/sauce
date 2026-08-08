#!/usr/bin/env node
// Generates sdk/src/routes/globals.generated.ts from src/chains/canonical.ts's
// CANONICAL_CHAINS — the ambient `declare global { const Base: ...; ... }`
// block that lets a consumer write `Base.route(...)` with zero import (see
// sdk/src/routes/globals.ts for the matching runtime install).
//
// WHY A REAL .ts FILE, NOT A .d.ts. tsc treats a `.d.ts` sitting under `src/`
// (picked up by tsconfig's `include`) as a DECLARATION INPUT, not build
// output — it is never copied to `outDir`. A hand-written
// `src/routes/globals.generated.d.ts` would typecheck fine inside this repo
// and then ship NOTHING to a consumer of the built package (dist has no
// build step that copies loose .d.ts files). So this generates an ordinary
// module: `declare global { ... }` followed by `export {}` (making it a
// module, not a script) — tsc compiles that into BOTH
// dist/routes/globals.generated.js (empty at runtime) and
// dist/routes/globals.generated.d.ts (carrying the ambient block), and the
// ambient block reaches a consumer via the bare `import "./globals.generated.js"`
// in globals.ts, which tsc preserves through declaration emit (verified by
// hand against a scratch package + consumer project — a *named* value-only
// import is elided from .d.ts; a *bare* one is not).
//
// WHY canonical.ts IS EXECUTED, NOT REGEXED. `src/chains/canonical.ts` has
// zero imports (checked below) -- this script transpiles it with the
// `typescript` package (already a devDependency) and evaluates the output
// directly, so the generator reads the SAME `CANONICAL_CHAINS` array the SDK
// itself ships, not a hand-parsed approximation that could drift from a
// syntax change. If canonical.ts ever gains an import, this script starts
// throwing (loud, not a silent wrong-answer) -- fix by widening the loader,
// not by regexing instead.
//
// Regenerate: `node scripts/gen-route-globals.mjs` (writes the file) or
// `node scripts/gen-route-globals.mjs --stdout` (prints, used by the jest
// drift test) or `--check` (exit 1 on drift, for a future CI wire-up).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, '..');
const CANONICAL_PATH = resolve(SDK_DIR, 'src', 'chains', 'canonical.ts');
const OUT_PATH = resolve(SDK_DIR, 'src', 'routes', 'globals.generated.ts');

/** Runtime mirror of `PascalOf`/`pascalOfSlug` (builder.ts) -- duplicated
 * here for the same reason `createChainAccessors` throws on a duplicate
 * key: this generator must independently notice a collision, not trust the
 * SDK's own copy to have caught it. */
function pascalOfSlug(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function loadCanonicalChains() {
  const source = readFileSync(CANONICAL_PATH, 'utf8');
  if (/^\s*import\b/m.test(source) || /\brequire\(/.test(source)) {
    throw new Error(
      `${CANONICAL_PATH} now has an import -- gen-route-globals.mjs's execute-it-directly ` +
        `loader assumes zero imports (see this script's header comment). Widen the loader.`,
    );
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('exports', 'module', outputText)(mod.exports, mod);
  const chains = mod.exports.CANONICAL_CHAINS;
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error(`CANONICAL_CHAINS in ${CANONICAL_PATH} is missing or empty.`);
  }
  return chains;
}

/** The one fixed, non-chain global this generator also emits -- see gen-route-globals.mjs's
 * caller in globals.ts for the matching runtime install (`Token`). Not derived from
 * CANONICAL_CHAINS, but still collision-checked against it below. */
const TOKEN_GLOBAL_NAME = 'Token';

function render(chains) {
  const seen = new Map();
  const lines = [];
  for (const c of chains) {
    const name = pascalOfSlug(c.slug);
    const prior = seen.get(name);
    if (prior !== undefined) {
      throw new Error(
        `duplicate chain global '${name}' (from slugs '${prior}' and '${c.slug}')`,
      );
    }
    if (name === TOKEN_GLOBAL_NAME) {
      throw new Error(
        `chain global '${name}' (slug '${c.slug}') collides with the fixed '${TOKEN_GLOBAL_NAME}' global`,
      );
    }
    seen.set(name, c.slug);
    // svm chains additionally carry the svm venue accessor tree
    // (`Solana.RaydiumCpSwap`, ...) -- see routes/globals.ts's matching
    // runtime `origin.chain.kind === "svm"` branch. Derived from `c.kind`,
    // not a hardcoded slug, so a second svm chain gets this for free.
    const svm = c.kind === 'svm' ? ' & SvmVenueAccessors' : '';
    lines.push(`  /** eco-routes origin accessor for ${c.name} (chain id ${c.id}). */`);
    lines.push(`  const ${name}: Accessors["${name}"] & ChainContracts${svm};`);
  }

  return `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-route-globals.mjs from src/chains/canonical.ts's
// CANONICAL_CHAINS. Regenerate with \`node scripts/gen-route-globals.mjs\` after
// a registry change; sdk/test/routes-globals-drift.test.ts fails CI on drift.
//
// Ambient only -- carries no runtime code (the runtime install lives in
// ./globals.ts, generated separately by enumerating \`chainAccessors\`). Typing
// each entry as \`Accessors["<Name>"]\` rather than spelling out
// \`ChainOrigin<RouteInput, RewardInput>\` buys a free structural cross-check:
// \`ChainAccessors\` is keyed by \`PascalOf<ChainSlug>\`, so a name that no longer
// exists in the registry fails \`tsc\` here before the drift test even runs.
import type { ChainAccessors } from "./builder.js";
import type { RewardInput, RouteInput } from "./types.js";
import type { ChainContracts } from "../descriptors/accessors.js";
import type { SvmVenueAccessors } from "../svm/accessors.js";
import type { TokenApi } from "../token/api.js";

type Accessors = ChainAccessors<RouteInput, RewardInput>;

declare global {
${lines.join('\n')}
  /** Runtime-resolved origin: \`chain('eth')\`, \`chain(8453)\`. */
  const chain: typeof import("./accessors.js").chain;
  /** Universal token interface — ERC20 on EVM targets, SPL Token on svm. */
  const Token: TokenApi;
}

export {};
`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const chains = loadCanonicalChains();
  const text = render(chains);

  if (args.has('--stdout')) {
    process.stdout.write(text);
    return;
  }
  if (args.has('--check')) {
    const current = readFileSync(OUT_PATH, 'utf8');
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
