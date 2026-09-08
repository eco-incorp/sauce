#!/usr/bin/env node
// Produce the Sauce engine artifacts the SDK ships and its tests read, from sources that live
// OUTSIDE `compiler/`. Two provenances, deliberately different:
//
//   1. The v12 EVM runtime — from the eco-incorp/v12 GitHub RELEASE, pinned to an immutable tag
//      and checked against a digest committed here. No Huff toolchain, no submodule fetch, no
//      compile step: the release publishes the exact bytes.
//   2. The 8 Solidity forge artifacts + the deploy record — from the `sauce` git dep, pinned to an
//      immutable COMMIT (not a branch) and declared in the ROOT package.json, so it resolves at
//      `<repo>/node_modules/sauce`. It used to be a devDep of `compiler/`, which made `rm -rf
//      compiler/` break the sdk build and ~13 test suites. The releases cannot replace it: they
//      publish only `Router`/`IRouter`/`Pot`/`Kitchen`, and `IERC20`, `IUniswapV3Pool`, `IStateView`
//      and `SauceRouter` appear in no release asset.
//
// The artifacts land in sdk/dist/artifacts (shipped to git-URL/tarball consumers) and sdk/src/artifacts
// (gitignored, read by the drift tests). Neither is committed; CI re-runs this script and asserts all
// nine files exist, so a broken generation fails there instead of shipping an empty dir.
//
// Why the v12 runtime comes from the release rather than from the pin. The engine dropped its
// committed snapshot (`chore(v12): compile the runtime at deploy time` — a second source of truth
// that rotted: a change to six .huff handlers shipped with a snapshot built from the pre-change
// source). This script then compiled `v12/Runtime.huff` with `hnc` itself, which needed the huff-neo
// toolchain, three cloned harness submodules and a forge script run — and still produced the
// `release/beta` LINEAGE, whose opcode table has diverged from the one the published compiler emits
// for (see sdk/test/std/token/evm.e2e.test.ts's header). The release asset is the same bytes the
// engine's own deploy uses, from the commit the published compiler's tag is cut from, so it is both
// cheaper to obtain and the correct lineage.
//
// Run: `pnpm --filter './sdk' sync-engine-artifacts` (after `pnpm install`).
// `--fetch-v12-engines` additionally downloads the SVM engine binary and prints every cached path as
// `NAME=<path>` lines — how CI gets SAUCE_RUST_ENGINE_SO / the runtime creation code.
// NOTE: a `rm -rf sdk/dist` clean build drops these (tsc emits no JSON) — re-run this after such a
// build. The normal `tsc` build leaves them in place.
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { generateEngineAbi } from "./gen-engine-abi.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SDK_DIR, "..");

// ---------------------------------------------------------------------------
// Release-sourced v12 engine assets.
//
// IMMUTABLE TAGS. A git tag is movable on GitHub, so the tag alone is not a pin — every asset is
// checked against a digest committed HERE, not only against the manifest downloaded beside it. Both
// releases are built from sauce fcedc167adf762347986feba6e53ed48800a6bfd, the commit the published
// `@eco-incorp/sauce-compiler` 0.5.0 (`compiler-v0.5.0`) is cut from: compiler and engines are one
// lineage by construction. To bump: change the tag, run this script, and paste the digest it reports.
const RELEASE_COMMIT = "fcedc167adf762347986feba6e53ed48800a6bfd";

const V12_EVM = {
  tag: "v12-evm-v0.3.0",
  asset: "runtime.creation.hex",
  // keccak256 of the creation code, cross-checked against the release manifest's `creationCodeKeccak`.
  digest: "0x1102d0061f378fe2a8e3f6644c37a2050c351224a382d3f18be6253d68831ff2",
  manifestKey: "creationCodeKeccak",
  // The manifest hashes the DECODED creation bytecode, not the hex file's bytes.
  hash: (buf) => keccak256(toBytes(buf.toString("utf8").trim())),
};

const V12_SVM = {
  tag: "v12-svm-v0.4.0",
  asset: "engine.so",
  digest: "983ff01645885eecc55c3437339e57de270a367fe18814111be5a26c74440a54",
  manifestKey: "soSha256",
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// Inside node_modules so it needs no .gitignore entry and is wiped with the install it belongs to.
// Keyed by tag: a bump downloads afresh rather than silently reusing the old bytes.
const CACHE_ROOT = resolve(REPO_ROOT, "node_modules", ".cache", "sauce-engine-releases");

const REPO = "eco-incorp/v12";

const onPath = (bin) => {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
};

/**
 * Download one release asset to `dest`. `gh` first (it carries the user's own credentials for this
 * PRIVATE repo); otherwise the REST API with a token. Throws with both remedies named — an absent
 * credential must not read as a mysterious 404.
 */
function download(tag, asset, dest) {
  const tmp = `${dest}.partial`;
  rmSync(tmp, { force: true });

  if (onPath("gh")) {
    execFileSync(
      "gh",
      [
        "release",
        "download",
        tag,
        "--repo",
        REPO,
        "--pattern",
        asset,
        "--output",
        tmp,
        "--clobber",
      ],
      {
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    renameSync(tmp, dest);

    return;
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.ECO_INCORP_TOKEN;
  if (!token) {
    throw new Error(
      `cannot download ${tag}/${asset}: eco-incorp/v12 is a PRIVATE repo, and neither the \`gh\` CLI ` +
        "nor a token was found. Install + `gh auth login`, or export GITHUB_TOKEN / GH_TOKEN with read " +
        "access on eco-incorp/v12.",
    );
  }

  const id = execFileSync(
    "curl",
    [
      "-sSfL",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Accept: application/vnd.github+json",
      `https://api.github.com/repos/${REPO}/releases/tags/${tag}`,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const found = JSON.parse(id).assets.find((a) => a.name === asset);
  if (!found) throw new Error(`release ${tag} has no asset named ${asset}`);

  execFileSync("curl", [
    "-sSfL",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Accept: application/octet-stream",
    "-o",
    tmp,
    found.url,
  ]);
  renameSync(tmp, dest);
}

/**
 * Cached, integrity-checked fetch of one release asset. Returns its path.
 *
 * A cached file is re-hashed on every run, so a truncated or tampered cache entry is replaced rather
 * than trusted; a verifying cache entry means zero network. The asset's own digest is the gate — the
 * manifest is fetched too and cross-checked, but it is downloaded from the same place as the asset,
 * so it can only corroborate, never authenticate.
 */
function fetchReleaseAsset({ tag, asset, digest, manifestKey, hash }) {
  const dir = resolve(CACHE_ROOT, tag);
  mkdirSync(dir, { recursive: true });
  const dest = resolve(dir, asset);

  const digestOf = () => hash(readFileSync(dest));
  if (!existsSync(dest) || digestOf() !== digest) {
    if (existsSync(dest))
      console.warn(`[sync-engine-artifacts] cached ${tag}/${asset} failed its digest — refetching`);
    download(tag, asset, dest);
    const actual = digestOf();
    if (actual !== digest) {
      rmSync(dest, { force: true });
      throw new Error(
        `${tag}/${asset} digest ${actual} != the pinned ${digest}. Either the download is corrupt or the ` +
          "tag was moved; do not proceed on an unverified engine.",
      );
    }
  }

  const manifest = resolve(dir, "manifest.json");
  if (!existsSync(manifest)) download(tag, "manifest.json", manifest);
  const record = JSON.parse(readFileSync(manifest, "utf8"));
  const claimed = manifestKey.split(".").reduce((o, k) => o?.[k], record);
  if (claimed !== digest) {
    throw new Error(
      `${tag} manifest ${manifestKey} is ${claimed}, not the pinned ${digest} — the tag moved.`,
    );
  }
  if (record.commit !== RELEASE_COMMIT) {
    throw new Error(
      `${tag} was built from ${record.commit}, not the pinned ${RELEASE_COMMIT} — the tag moved.`,
    );
  }

  return dest;
}

// ---------------------------------------------------------------------------
// The `sauce` git dep. Declared in the ROOT package.json (see the header), so `<repo>/node_modules/sauce`
// is the only place it can be. The old candidate list also looked in `compiler/node_modules/sauce`,
// which is what tied the sdk build to `compiler/` existing.
const SAUCE = resolve(REPO_ROOT, "node_modules", "sauce");

/**
 * `engine/out` is forge BUILD OUTPUT — the dep arrives without it, and pnpm does not recurse git
 * submodules, so the OpenZeppelin sources `engine/src` imports are missing too. Fetch them at the
 * SHA the engine's own submodule pins and build. Previously done by `compiler`'s postinstall
 * (integration-test/fetch-engine-libs.js), which is the other half of what made the sdk build depend
 * on `compiler/`.
 *
 * Non-fatal without Foundry: the caller reports the missing artifacts, and SYNC_OPTIONAL_FORGE=1
 * downgrades that to a warning for local dev.
 */
const OPENZEPPELIN_SHA = "33abe27ddb835a49d4b0ecc4717eeff03535a4cd";

function prepareEngineBuild() {
  const engine = resolve(SAUCE, "engine");
  if (existsSync(resolve(engine, "out", "Router.sol", "Router.json"))) return;

  const oz = resolve(engine, "lib", "openzeppelin-contracts");
  if (!existsSync(resolve(oz, "contracts"))) {
    console.log(
      `[sync-engine-artifacts] fetching engine lib openzeppelin-contracts@${OPENZEPPELIN_SHA.slice(0, 7)}`,
    );
    mkdirSync(oz, { recursive: true });
    execSync(`git init -q ${JSON.stringify(oz)}`, { stdio: "inherit" });
    execSync(
      `git -C ${JSON.stringify(oz)} fetch -q --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts.git ${OPENZEPPELIN_SHA}`,
      { stdio: "inherit" },
    );
    execSync(`git -C ${JSON.stringify(oz)} checkout -q FETCH_HEAD`, { stdio: "inherit" });
  }

  if (!onPath("forge")) {
    console.warn(
      "[sync-engine-artifacts] forge not on PATH — cannot build the engine (install Foundry).",
    );

    return;
  }

  // --skip test --skip script keeps the build off forge-std / huff-neo, which are submodules of the
  // harness rather than of the contracts this reads.
  console.log("[sync-engine-artifacts] forge build engine/src …");
  execSync("forge build --skip test --skip script", { cwd: engine, stdio: "inherit" });
}

if (!existsSync(SAUCE)) {
  console.error(
    "[sync-engine-artifacts] the `sauce` dep is not installed at node_modules/sauce. Run `pnpm install` " +
      "first (it is a devDependency of the ROOT package.json).",
  );
  process.exit(1);
}

prepareEngineBuild();

// name -> path within the sauce dep. Order/set matches the shipped sdk/dist/artifacts exactly.
const SOURCES = {
  Router: "engine/out/Router.sol/Router.json",
  SauceRouter: "engine/out/SauceRouter.sol/SauceRouter.json",
  ISauceRouter: "engine/out/ISauceRouter.sol/ISauceRouter.json",
  V12Pot: "engine/out/V12Pot.sol/V12Pot.json",
  V12Kitchen: "engine/out/V12Kitchen.sol/V12Kitchen.json",
  IERC20: "engine/out/IERC20.sol/IERC20.json",
  IUniswapV3Pool: "engine/out/IUniswapV3Pool.sol/IUniswapV3Pool.json",
  IStateView: "engine/out/IUniswapV4.sol/IStateView.json",
};

// Committed + shipped location first; the gitignored src copy is kept coherent for local dev (the
// drift tests read it).
const DESTS = [resolve(SDK_DIR, "dist", "artifacts"), resolve(SDK_DIR, "src", "artifacts")];
for (const d of DESTS) mkdirSync(d, { recursive: true });

const missing = [];
for (const [name, rel] of Object.entries(SOURCES)) {
  const src = resolve(SAUCE, rel);

  if (!existsSync(src)) {
    missing.push(`${name} (${rel})`);
    continue;
  }

  for (const dest of DESTS) copyFileSync(src, resolve(dest, `${name}.json`));
}

if (missing.length) {
  const message =
    `[sync-engine-artifacts] missing from the pinned engine build: ${missing.join(", ")}. ` +
    "Ensure Foundry is installed so the engine forge build can run.";
  // Wired into the sdk build, so a local build without Foundry must not hard-fail: SYNC_OPTIONAL_FORGE=1
  // downgrades to a warning (dist/artifacts is then incomplete locally). CI/publish install Foundry, so
  // they still produce every artifact; the existence check fails there on any gap.
  if (process.env.SYNC_OPTIONAL_FORGE === "1") {
    console.warn(
      `${message} (SYNC_OPTIONAL_FORGE=1 → continuing; dist/artifacts will be incomplete)`,
    );
  } else {
    console.error(message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// V12RuntimeBytecode — the release's creation code, wrapped in the JSON shape consumers already read.
//
// CREATION code, not the deployed runtime: `Runtime.huff`'s CONSTRUCTOR appends the runtime's own
// address as a trailing code word, so the deployed bytes are not known until the contract has one. A
// harness that wants to `setCode` a runtime must deploy this once and read the code back (CI's
// "Derive the deployed v12 runtime bytecode" step does exactly that).
//
// Non-fatal: a developer with no credentials and no cache keeps whatever copy is already there and
// gets a warning, the same latitude the previous hnc-based generation had.
const RUNTIME_DEST = "V12RuntimeBytecode.json";
let runtimeCreationPath;

try {
  runtimeCreationPath = fetchReleaseAsset(V12_EVM);
  const creationCode = readFileSync(runtimeCreationPath, "utf8").trim();
  const json = `${JSON.stringify({ runtimeCreationCode: creationCode }, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, RUNTIME_DEST), json);
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, RUNTIME_DEST)));
  console.warn(
    `[sync-engine-artifacts] V12RuntimeBytecode: ${e.message} — ` +
      (present ? "kept the copy already on disk." : "NOT produced."),
  );
}

// ---------------------------------------------------------------------------
// Deployed-address record -> a typed TS module.
//
// The engine records where its stack actually lives in `deployments/v12.json` (written by its own
// dev-tools/scripts/deploy-v12.ts). Without this, the package shipped ABIs and runtime creation code
// but no way to discover the ADDRESSES of the deployed router/kitchen/runtime, or the SVM engine's
// program id — consumers had to hardcode them out of band. `createSauceSvmClient` in particular takes
// a required `programId` with no default.
//
// Generated as TypeScript rather than copied as JSON on purpose: a runtime JSON import needs ESM
// import attributes (`with { type: 'json' }`) to work in Node, which is a portability trap for
// consumers. Emitting literals sidesteps it and keeps the values typed and tree-shakeable.
//
// Generated, not hand-written, so it cannot drift from the pinned engine across a repin. CI re-runs
// this and fails on drift.
const DEPLOYMENTS_SRC = resolve(SAUCE, "deployments", "v12.json");
const GENERATED = resolve(SDK_DIR, "src", "deployments", "v12.generated.ts");

if (!existsSync(DEPLOYMENTS_SRC)) {
  console.error(
    "[sync-engine-artifacts] deployments/v12.json missing from the pinned engine. Pin a commit that " +
      "records a deploy; the v12 release lineage carries no deployments/ directory.",
  );
  process.exit(1);
}

const dep = JSON.parse(readFileSync(DEPLOYMENTS_SRC, "utf8"));
const q = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
// Numeric chain-id order, so regeneration is byte-stable regardless of JSON key order.
const chainIds = Object.keys(dep.evm?.chains ?? {}).sort((a, b) => Number(a) - Number(b));
const clusters = Object.keys(dep.svm?.clusters ?? {}).sort();

const generated = `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/sync-engine-artifacts.mjs from the pinned \`sauce\` dep's
// deployments/v12.json (produced there by dev-tools/scripts/deploy-v12.ts). Run
// \`pnpm --filter './sdk' sync-engine-artifacts\` after a repin; CI fails on drift.
//
// The EVM addresses are CREATE2-deterministic (factory + salt + initcode only),
// so they are the SAME on every chain — hence one flat address set plus per-chain
// liveness, rather than the same three addresses repeated per chain.

/** CREATE2 salt the stack was deployed with. */
export const V12_SALT = ${q(dep.salt)} as const;

/** Which tool in the engine repo produced the underlying record. */
export const V12_GENERATED_BY = ${q(dep.generatedBy)} as const;

/** Chain-invariant EVM addresses (identical on every chain — see the note above). */
export const V12_EVM_CONTRACTS = {
  router: ${q(dep.evm.contracts.router)},
  v12Runtime: ${q(dep.evm.contracts.v12Runtime)},
  v12Kitchen: ${q(dep.evm.contracts.v12Kitchen)},
} as const;

/** Per-chain deploy outcome. \`live\` is the only field callers should gate on. */
export const V12_EVM_CHAINS = {
${chainIds
  .map((id) => {
    const c = dep.evm.chains[id];
    const err = c.error === undefined ? "" : `, error: ${q(c.error)}`;
    return `  ${id}: { name: ${q(c.name)}, live: ${c.live === true}, status: ${q(c.status)}${err} },`;
  })
  .join("\n")}
} as const;

/** The SVM engine program (non-upgradeable when \`upgradeable\` is false). */
export const V12_SVM = {
  programId: ${q(dep.svm.programId)},
  upgradeable: ${dep.svm.upgradeable === true},
  clusters: {
${clusters.map((k) => `    ${q(k)}: { cluster: ${q(dep.svm.clusters[k].cluster)}, status: ${q(dep.svm.clusters[k].status)} },`).join("\n")}
  },
} as const;
`;

mkdirSync(dirname(GENERATED), { recursive: true });
writeFileSync(GENERATED, generated);

// SVM wire ABI -> a generated TS module of the wire constants (discriminators, header
// offsets/sizes, payload flags, seed scheme). Same rationale as the deployments module above:
// generated so it cannot drift from the pinned engine, CI git-diffs the result. OPTIONAL — older
// pins predate svm/abi/engine-abi.json, so its absence keeps the committed copy, never fatal.
const abiResult = generateEngineAbi();

const liveCount = chainIds.filter((id) => dep.evm.chains[id].live === true).length;

console.log(
  `[sync-engine-artifacts] synced ${Object.keys(SOURCES).length} forge artifacts from ${SAUCE}`,
);
console.log(
  abiResult.generated
    ? "[sync-engine-artifacts] generated src/svm/engine-abi.generated.ts from svm/abi/engine-abi.json"
    : "[sync-engine-artifacts] svm/abi/engine-abi.json absent from this pin — kept the committed engine-abi.generated.ts",
);
console.log(
  `[sync-engine-artifacts] generated src/deployments/v12.generated.ts — ${liveCount} live of ` +
    `${chainIds.length} EVM chains, svm programId ${dep.svm.programId}`,
);

// `--fetch-v12-engines`: also place the SVM engine binary in the cache, and print every cached path
// as `NAME=<path>`. CI appends these to $GITHUB_ENV so SAUCE_RUST_ENGINE_SO and the runtime-derivation
// step read the same verified, cached bytes this script already fetched — one download, one digest
// check, no second implementation in YAML.
if (process.argv.includes("--fetch-v12-engines")) {
  const enginePath = fetchReleaseAsset(V12_SVM);
  if (!runtimeCreationPath)
    throw new Error("--fetch-v12-engines: the v12 EVM runtime creation code was not fetched");
  console.log(`SAUCE_RUST_ENGINE_SO=${enginePath}`);
  console.log(`SAUCE_V12_RUNTIME_CREATION_HEX=${runtimeCreationPath}`);
}

// `--fetch-v12-harness`: clone the two harness libs `engine-v12`'s exec-parity suite imports. The
// v12 runtime comes from a release asset now, so nothing else fetches them -- and
// compiler/integration-test/{v12-execution,v12-solidity-parity}.test.ts `describe.skip` when they
// are absent, which is 63 tests reading as green. Their versions do not affect any bytecode: they
// are the forge Script harness, not the compiler.
if (process.argv.includes("--fetch-v12-harness")) {
  const engineV12 = resolve(SAUCE, "engine-v12");
  if (!existsSync(engineV12)) {
    throw new Error(`--fetch-v12-harness: ${engineV12} is absent from this pin`);
  }
  // Three, and the third is easy to miss: `engine-v12/lib/openzeppelin-contracts` is a DIFFERENT
  // path from the `engine/lib/openzeppelin-contracts` the artifact sync already fetches, and the
  // exec-parity harness imports IERC20/SafeERC20/SafeCast/Create2 from it.
  const HARNESS_LIBS = {
    "forge-std": "https://github.com/foundry-rs/forge-std",
    "foundry-huff-neo": "https://github.com/cakevm/foundry-huff-neo",
    "openzeppelin-contracts": "https://github.com/OpenZeppelin/openzeppelin-contracts",
  };
  for (const [name, url] of Object.entries(HARNESS_LIBS)) {
    const dir = resolve(engineV12, "lib", name);
    if (existsSync(dir)) continue;
    console.log(`[sync-engine-artifacts] fetching engine-v12 harness lib: ${name}`);
    execSync(`git clone --depth 1 -q ${url} ${JSON.stringify(dir)}`, { stdio: "inherit" });
  }
}
