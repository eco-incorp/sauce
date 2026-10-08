// Writes the swap instructions eco-incorp/sauce-recipes builds for the Solana venue fixture's pools
// (`test/svm/venue-fixture.ts`) to `test/std/router/fixtures/recipes-swap-templates.json`, which
// `std/router/svm-at-limit.e2e.test.ts` holds `@sauce/router`'s `…Cpi` functions to byte for byte:
// the instruction data and the accounts, in order, of each venue's `buildSwapV2` and, where it has
// one, the window-bounded `buildBakedCpiSwap` the recipes serve, both ways, for every pool of the
// twelve venues the arm swaps at a limit.
//
//   pnpm --filter './sdk' exec tsx scripts/recipes-swap-templates.mjs --recipes <sauce-recipes>
//
// `--recipes` is a sauce-recipes checkout with its dependencies installed. Its ladder modules are
// TypeScript, hence `tsx`; each pool's config comes from the fetch the recipes themselves use, out of
// that checkout's own `@eco-incorp/sauce`, over the fixture's account bytes: no RPC. The output names
// the checkout's commit and package versions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const { values } = parseArgs({ options: { recipes: { type: "string" } } });
if (values.recipes === undefined) {
  console.error("usage: tsx scripts/recipes-swap-templates.mjs --recipes <sauce-recipes checkout>");
  process.exit(1);
}
const RECIPES = resolve(values.recipes);
const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SDK, "test", "std", "router", "fixtures", "recipes-swap-templates.json");

const fromRecipes = (path) => import(pathToFileURL(join(RECIPES, path)).href);
const sauceSvm = await import(
  pathToFileURL(createRequire(join(RECIPES, "package.json")).resolve("@eco-incorp/sauce/svm")).href
);
const ladders = await fromRecipes("ecoswap/svm/ladders/index.ts");
const { stopAtLastBoundary } = await fromRecipes("ecoswap/svm/raydium-lineage-window.ts");
const { withCremaSwapArrays } = await fromRecipes("ecoswap/svm/ladders/crema.ts");
const { fetchOrcaWhirlpoolConfigT22Aware } = await fromRecipes(
  "ecoswap/svm/orca-whirlpool-t22-fetch.ts",
);
const { fetchManifestConfigT22Aware } = await fromRecipes("ecoswap/svm/manifest-t22-fetch.ts");

const fixture = JSON.parse(
  readFileSync(join(SDK, "test", "fixtures", "svm-venue-programs", "manifest.json"), "utf8"),
);
const bytes = new Map(
  fixture.accounts.map(({ address, file }) => {
    const raw = readFileSync(join(SDK, "test", "svm", "fixtures", file));
    const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
    return [address, new Uint8Array(Buffer.from(json.base64Data, "base64"))];
  }),
);
const load = async (at) => bytes.get(at) ?? null;

// The fetch each venue's own registry entry in the recipes uses (`ecoswap/svm/index.ts`'s FAMILIES),
// each pool's two directions, and the venues whose patched amount is in lots.
const raydiumLike = (adapter) => async (pool) =>
  stopAtLastBoundary(await adapter.fetchPoolConfig(load, pool));
const VENUES = {
  "raydium-clmm": [ladders.raydiumClmmLadder, raydiumLike(sauceSvm.raydiumClmm), ["0to1", "1to0"]],
  "pancakeswap-clmm": [
    ladders.pancakeswapClmmLadder,
    raydiumLike(sauceSvm.pancakeswapClmm),
    ["0to1", "1to0"],
  ],
  byreal: [ladders.byrealLadder, raydiumLike(sauceSvm.byreal), ["0to1", "1to0"]],
  "stabble-clmm": [ladders.stabbleClmmLadder, raydiumLike(sauceSvm.stabbleClmm), ["0to1", "1to0"]],
  "orca-whirlpool": [
    ladders.orcaWhirlpoolLadder,
    (pool) => fetchOrcaWhirlpoolConfigT22Aware(load, pool, BigInt(fixture.unixTimestamp)),
    ["aToB", "bToA"],
  ],
  cropper: [
    ladders.cropperLadder,
    (pool) => sauceSvm.cropper.fetchPoolConfig(load, pool),
    ["aToB", "bToA"],
  ],
  defituna: [
    ladders.defitunaLadder,
    (pool) => sauceSvm.defituna.fetchPoolConfig(load, pool),
    ["aToB", "bToA"],
  ],
  crema: [
    ladders.cremaLadder,
    async (pool) => withCremaSwapArrays(load, await sauceSvm.crema.fetchPoolConfig(load, pool)),
    ["aToB", "bToA"],
  ],
  phoenix: [
    ladders.phoenixLadder,
    (pool) => sauceSvm.fetchPhoenixConfig(load, pool),
    ["baseIn", "quoteIn"],
    ladders.phoenixPatchDivisor,
  ],
  invariant: [
    ladders.invariantLadder,
    (pool) => sauceSvm.fetchInvariantPoolConfig(load, pool),
    ["xToY", "yToX"],
  ],
  manifest: [
    ladders.manifestLadder,
    (pool) => fetchManifestConfigT22Aware(load, pool),
    ["baseIn", "quoteIn"],
  ],
  "openbook-v2": [
    ladders.openbookV2Ladder,
    (pool) => sauceSvm.fetchOpenBookV2Config(load, pool),
    ["baseIn", "quoteIn"],
    ladders.openbookV2PatchDivisor,
  ],
};

const user = { owner: "user:owner", inAta: "user:in", outAta: "user:out" };
const hex = (data) => Buffer.from(data).toString("hex");
const templates = [];
const skipped = [];
for (const spec of fixture.pools) {
  const venue = VENUES[spec.venue];
  if (venue === undefined) continue;
  const [ladder, fetch, directions, divisor] = venue;
  let base;
  try {
    base = await fetch(spec.pool);
  } catch (error) {
    skipped.push(`${spec.name}: ${error.message}`);
    continue;
  }
  for (const direction of directions) {
    const cfg = { ...base, direction };
    for (const builder of ["buildSwapV2", "buildBakedCpiSwap"]) {
      if (ladder[builder] === undefined) continue;
      let template;
      try {
        template = ladder[builder](cfg, 0, user);
      } catch (error) {
        skipped.push(`${spec.name} ${direction} ${builder}: ${error.message}`);
        continue;
      }
      templates.push({
        pool: spec.name,
        venue: spec.venue,
        direction,
        builder,
        programId: template.programId,
        prefix: hex(template.prefix),
        suffix: hex(template.suffix),
        ...(divisor === undefined ? {} : { divisor: String(divisor(cfg)) }),
        accounts: template.accounts.map((account) => ({
          ref: account.ref,
          address: account.address ?? null,
          writable: account.writable === true,
          signer: account.signer === true,
        })),
      });
    }
  }
}

const git = (...args) => execFileSync("git", ["-C", RECIPES, ...args], { encoding: "utf8" }).trim();
const pinned = JSON.parse(readFileSync(join(RECIPES, "package.json"), "utf8")).dependencies;
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      $comment:
        "The swap instructions eco-incorp/sauce-recipes builds for the venue fixture's pools, " +
        "written by scripts/recipes-swap-templates.mjs: a ladder's prefix, then the patched u64 " +
        "amount (in lots where `divisor` is given), then its suffix, and its accounts in order, " +
        "`user:owner`/`user:in`/`user:out` the trader's. Test data: nothing ships it.",
      recipes: {
        commit: git("rev-parse", "HEAD"),
        sauce: pinned["@eco-incorp/sauce"],
      },
      skipped,
      templates,
    },
    null,
    2,
  )}\n`,
);
console.log(`recipes-swap-templates: ${templates.length} templates, ${skipped.length} skipped`);
