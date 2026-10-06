#!/usr/bin/env node
// Produce the Sauce engine artifacts the SDK ships and its tests read, from sources that live
// OUTSIDE `compiler/`. Two provenances, deliberately different:
//
//   1. The v12 EVM runtime — from the eco-incorp/v12 GitHub RELEASE, pinned by version and checked
//      against a digest committed in `src/deployments/releases.json`. No Huff toolchain, no
//      submodule fetch, no compile step: the release publishes the exact bytes.
//   2. The contract ABIs — five from the `kitchen-evm` release's `abis.json` (`Router`/`IRouter`/
//      `Pot`/`Kitchen`/`KitchenProxy`), a DIFFERENT component from item 1, plus `IERC20` declared
//      below (the ERC-20 standard is OpenZeppelin's, never v12's) and `IUniswapV3Pool` read from
//      `@uniswap/v3-core`. `SauceRouter` and `IStateView` are NOT produced: they came from the engine
//      repo's Solidity tree, which no release ships, so anything that wanted them had to stop (see
//      dev-tools/scripts/deploy.ts).
//
// The artifacts land in sdk/dist/artifacts (shipped to git-URL/tarball consumers) and sdk/src/artifacts
// (gitignored, read by the drift tests). Neither is committed; CI re-runs this script and asserts
// every file exists, so a broken generation fails there instead of shipping an empty dir.
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
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SDK_DIR, "..");

// ---------------------------------------------------------------------------
// Release-sourced v12 assets, from FOUR independently-released components:
//
//   v12-svm      the engine program and its wire artifact
//   v12-evm      the EVM runtime creation code
//   kitchen-svm  the kitchen program and its Anchor IDL
//   kitchen-evm  the Solidity ABIs
//
// The kitchen used to ship INSIDE the v12-svm and v12-evm releases. It is its own component now, so
// `kitchen.so`, `kitchen-idl.json` and `abis.json` come from the kitchen-* tags while the v12-* tags
// carry only the engine. A pin left on a v12-* tag for one of those three does not resolve at all.
//
// PINNED BY TAG + DIGEST, and both live in `src/deployments/releases.json` — the one place every
// release-dependent value is written. A git tag is movable on GitHub, so the tag alone is not a pin:
// every asset is checked against a digest committed THERE, not only against the manifest downloaded
// beside it. That digest is the whole guarantee: bytes that match it ARE the pinned artifact,
// whichever commit produced them.
//
// ONE ROW PER COMPILER. Compiler output and engines pair by exact package version in both
// directions as recorded (several compilers may share an engine). This syncs the row of the installed
// compiler. `deployments/releases.ts` refuses an engine unless a row explicitly pairs it with that
// compiler; historical rows preserve the compatibility checks for older releases.
//
// There is deliberately no commit pin. The components release INDEPENDENTLY, so a shared commit is
// not a property this can rely on. Requiring one shared commit made a
// routine per-component bump fail as "the tag moved".
//
// To bump: edit the row's versions, run this script, and paste the digests and engine ids it
// reports. A row with a `null` digest or engine id is a release that is not out yet: this script
// downloads it, reports what to paste, and writes NOTHING, because an unpinned engine is not one to
// run. `--report <compiler>` reports any row the same way without the compiler installed — the
// engines release before the compiler that pairs with them does.

const RELEASES_JSON = resolve(SDK_DIR, "src", "deployments", "releases.json");
const RELEASE_TABLE = JSON.parse(readFileSync(RELEASES_JSON, "utf8"));
const RELEASE_SETS = RELEASE_TABLE.releases;

/** The installed `sauce-compiler`'s version. Its `./package.json` is not in the package's
 *  `exports`, so resolve the entry and walk up to the manifest that NAMES the package — the package
 *  also ships a `web/package.json` that is only `{"type":"module"}`. */
function installedCompilerVersion() {
  let dir = dirname(createRequire(import.meta.url).resolve("sauce-compiler"));
  for (let up = 0; up < 10; up++) {
    const manifest = resolve(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed.name === "@eco-incorp/sauce-compiler" && parsed.version) return parsed.version;
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the installed @eco-incorp/sauce-compiler manifest");
}

/** `--report <compiler>`: only report that row's digests and engine ids (see below). */
const REPORT = process.argv.includes("--report")
  ? process.argv[process.argv.indexOf("--report") + 1]
  : undefined;
const COMPILER = REPORT ?? installedCompilerVersion();
const SET = RELEASE_SETS.find((row) => row.compiler === COMPILER);
if (!SET) {
  console.error(
    `[sync-engine-artifacts] the installed compiler is ${COMPILER}, and releases.json pairs no ` +
      `engines with it — it has rows for ${RELEASE_SETS.map((row) => row.compiler).join(", ")}. ` +
      "Add the row for this compiler rather than syncing engines it cannot run on.",
  );
  process.exit(1);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// How each asset is hashed and where its release manifest records that digest — the SHAPE of a
// release, which does not move with a version, unlike the digests themselves.
const ASSET_FORMATS = {
  // The manifest hashes the DECODED creation bytecode, not the hex file's bytes.
  "runtime.creation.hex": {
    manifestKey: "creationCodeKeccak",
    hash: (buf) => keccak256(toBytes(buf.toString("utf8").trim())),
  },
  "abis.json": { manifestKey: "abis.sha256", hash: sha256 },
};
// `manifestKey: null` means the manifest lists its artifacts as `[{ name, sha256 }]` and the digest
// is found by asset name — the shape v12-svm and kitchen-svm moved to once they shipped several.
const DEFAULT_FORMAT = { manifestKey: null, hash: sha256 };

/** The pin for one asset of this row's release of `component`. */
const pin = (component, asset) => ({
  tag: `${component}-v${SET[component].version}`,
  asset,
  digest: SET[component].assets[asset],
  ...(ASSET_FORMATS[asset] ?? DEFAULT_FORMAT),
});

// The EVM runtime's CREATION code.
const V12_EVM = pin("v12-evm", "runtime.creation.hex");

// The engine is built PER CLUSTER — `CHAIN_ID` is compiled in, because Solana exposes no chain
// identifier a program can read — so there is no longer one `engine.so`. Devnet is what the test
// harnesses load; a mainnet consumer takes `engine-mainnet.so` from the same release. Both clusters
// ship from one release, and they are genuinely different binaries, so a suite that asserts the
// cluster id has to run each one rather than assume they differ.
const V12_SVM = pin("v12-svm", "engine-devnet.so");
const V12_SVM_MAINNET = pin("v12-svm", "engine-mainnet.so");
const V12_ENGINE_WIRE_MAINNET = pin("v12-svm", "engine-wire-mainnet.json");

// The contracts the kitchen component OWNS, as one asset. What the SDK ships under its own names is
// a superset: `IERC20` is the ERC-20 standard (OpenZeppelin's, never v12's) and `IUniswapV3Pool` is
// Uniswap's, so neither appears here and neither should — see ARTIFACTS below.
const V12_EVM_ABIS = pin("kitchen-evm", "abis.json");
// Generation 4 only swaps; generation 3 remains the token-free quote service.
const QUOTE_ROUTER_ABIS = {
  tag: `kitchen-evm-v${RELEASE_TABLE.quoteRouter.version}`,
  asset: "abis.json",
  digest: RELEASE_TABLE.quoteRouter.assets["abis.json"],
  ...ASSET_FORMATS["abis.json"],
};

// The kitchen — the Anchor loader that stages bytecode and owns Pots. Fetched rather than vendored:
// a released binary is already pinned by tag + digest, so a second copy in the tree would be a
// second thing to keep in step.
const V12_KITCHEN = pin("kitchen-svm", "kitchen.so");

// The engine's own description of its wire — discriminators, fault codes, memory limits — generated
// from its Rust constants by the same build. It is the ground truth `engine-wire-drift.test.ts`
// checks the SDK's released-engine constants against, so it is pinned exactly like the binary: an
// engine whose wire moved must fail the digest here, not surprise a caller at run time.
const V12_ENGINE_WIRE = pin("v12-svm", "engine-wire-devnet.json");

// The kitchen's Anchor IDL — discriminators, PDA seeds, and account layouts. `svm/kitchen.ts`
// transcribes these by hand (Anchor emits no TypeScript the SDK can vendor), which is precisely the
// hand-copying that let BYTECODE_FORMAT_EPOCH rot. Pinned so the drift test can compare against it.
const V12_KITCHEN_IDL = pin("kitchen-svm", "kitchen-idl.json");

const PINS = [
  V12_EVM,
  V12_EVM_ABIS,
  V12_SVM,
  V12_SVM_MAINNET,
  V12_ENGINE_WIRE,
  V12_ENGINE_WIRE_MAINNET,
  V12_KITCHEN,
  V12_KITCHEN_IDL,
];

// Every asset the row names must be one this script fetches, and the other way round: a digest
// nothing checks is not a pin, and an asset fetched with no row entry would be pinned to `undefined`.
for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"]) {
  const listed = Object.keys(SET[component]?.assets ?? {}).sort();
  const fetched = PINS.filter((p) => p.tag.startsWith(`${component}-v`))
    .map((p) => p.asset)
    .sort();
  if (listed.join() !== fetched.join()) {
    console.error(
      `[sync-engine-artifacts] releases.json's ${COMPILER} row lists ${component} assets ` +
        `[${listed.join(", ")}], but this script fetches [${fetched.join(", ")}].`,
    );
    process.exit(1);
  }
}

// Inside node_modules so it needs no .gitignore entry and is wiped with the install it belongs to.
// Keyed by tag: a bump downloads afresh rather than silently reusing the old bytes.
const CACHE_ROOT = resolve(REPO_ROOT, "node_modules", ".cache", "sauce-engine-releases");

// The same artifacts, published by each release as a PRIVATE npm package on GitHub Packages. The
// point is the credential: read access is granted per package to the CONSUMING REPOSITORY, so CI
// authenticates with the `GITHUB_TOKEN` every workflow already has, and a developer with whatever
// `gh` is already logged in as. No personal access token is minted, and nothing is published
// publicly. The bytes are identical to the release assets, and the digest releases.json pins still
// decides whether they are the pinned artifact — this changes the TRANSPORT, not the trust model.
//
// Fetched straight from the registry rather than declared as a dependency, DELIBERATELY. Installing
// it would need an `@eco-incorp` scope mapping in `.npmrc`, and a scope registry governs PUBLISHING
// as well as resolution — which is how this repo's own package once came within a `publishConfig`
// pin of publishing to GitHub Packages instead of npmjs.com. Nothing here needs resolving anyway:
// these are data files, not code this package imports.
const NPM_REGISTRY = "https://npm.pkg.github.com";
const NPM_SCOPE = "@eco-incorp";

// `v12-svm-v1.3.0` -> package `@eco-incorp/v12-svm`, version `1.3.0`. The four components release
// independently under their own tag namespaces, so each gets its own package; there is deliberately
// no single version spanning them.
const RELEASE_TAG = /^(?<pkg>v12-evm|v12-svm|kitchen-evm|kitchen-svm)-v(?<version>.+)$/;

// NEVER interpolate a failed child process's own message. `execFileSync` puts the whole command line
// into it, and these commands carry the credential as `Authorization: Bearer <token>`. Surfacing it
// prints a live GitHub token into local output and CI logs, where it is retained and readable.
// Report the exit status instead: it distinguishes the failures anyone acts on and cannot leak.
const curlFailure = (err) => `curl exited ${err.status ?? "abnormally"}`;

/** The credential every caller already has: CI's own `GITHUB_TOKEN`, or whatever `gh` is logged in
 *  as. Neither is minted for this. */
function githubCredential() {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Download one release asset to `dest` out of its published npm package.
 *
 * ONE TRANSPORT. There is deliberately no `gh release` or REST fallback: a fallback would let a
 * developer with `gh` logged in and CI with only its own token fetch by different routes, so the
 * route CI depends on could rot unseen. One path breaks for everyone at once.
 */
function download(tag, asset, dest) {
  const tmp = `${dest}.partial`;
  rmSync(tmp, { force: true });

  const parts = RELEASE_TAG.exec(tag)?.groups;
  if (!parts) {
    throw new Error(
      `cannot map release tag '${tag}' to a package: expected <package>-v<version> for one of ` +
        "v12-evm, v12-svm, kitchen-evm, kitchen-svm.",
    );
  }

  const name = `${NPM_SCOPE}/${parts.pkg}`;
  const credential = githubCredential();
  if (!credential) {
    throw new Error(
      `cannot download ${asset} from ${name}@${parts.version} — no GitHub credential found. These ` +
        "packages are private, so the read is authenticated: set GITHUB_TOKEN (CI supplies its own " +
        "automatically) or run `gh auth login`. No personal access token needs to be minted.",
    );
  }

  const authed = (url) =>
    execFileSync("curl", ["-sfL", "-H", `Authorization: Bearer ${credential}`, url], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });

  // The registry answers 404 both for a package that does not exist and for one this caller cannot
  // read, so the two causes are not distinguishable from here and both are named.
  const unreachable = (why) =>
    new Error(
      `cannot download ${asset} from ${name}@${parts.version} — ${why}. Either the ${tag} release ` +
        "has not published its package yet, or this repository has not been granted read access to " +
        "it: the package's settings -> Manage Actions access -> add eco-incorp/sauce (Read). The " +
        "package is private by design and stays that way; the grant is what makes the read work, " +
        "and no personal access token is involved.",
    );

  let packument;
  try {
    packument = JSON.parse(authed(`${NPM_REGISTRY}/${encodeURIComponent(name)}`).toString("utf8"));
  } catch (err) {
    throw unreachable(`its packument could not be read (${curlFailure(err)})`);
  }

  const release = packument.versions?.[parts.version];
  if (!release) {
    const have = Object.keys(packument.versions ?? {});
    throw new Error(
      `${name} has no version ${parts.version}` +
        (have.length ? ` — it has: ${have.join(", ")}` : " — it has no published versions"),
    );
  }
  const tarball = release.dist?.tarball;
  if (!tarball) throw unreachable("its version carries no tarball");

  let archive;
  try {
    archive = authed(tarball);
  } catch (err) {
    throw unreachable(`its tarball could not be downloaded (${curlFailure(err)})`);
  }

  // The registry's own integrity field, checked before the bytes are handed on. A TRANSPORT check,
  // NOT the guarantee — the digest releases.json pins remains that — but a tarball that is not what its
  // own packument described should fail here rather than be reported as a bad pin.
  const integrity = release.dist.integrity ?? "";
  const [algorithm, expected] = integrity.split("-");
  if (algorithm && expected) {
    const got = createHash(algorithm).update(archive).digest("base64");
    if (got !== expected) {
      throw new Error(
        `${name}@${parts.version} served a tarball hashing to ${algorithm}-${got}, but its ` +
          `packument describes ${integrity}`,
      );
    }
  }

  // npm tarballs root every file under `package/`.
  const archivePath = `${tmp}.tgz`;
  writeFileSync(archivePath, archive);
  try {
    const file = execFileSync("tar", ["-xzOf", archivePath, `package/${asset}`], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!file.length) throw new Error("empty");
    writeFileSync(tmp, file);
  } catch {
    throw new Error(`${name}@${parts.version} carries no file named ${asset}`);
  } finally {
    rmSync(archivePath, { force: true });
  }

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
  // `manifestKey: null` means the manifest lists its artifacts as `[{ name, sha256 }]` and the
  // digest is found by asset name — the shape v12-svm moved to once it shipped more than one binary.
  const claimed =
    manifestKey === null
      ? record.artifacts?.find((a) => a.name === asset)?.sha256
      : manifestKey.split(".").reduce((o, k) => o?.[k], record);
  if (claimed !== digest) {
    throw new Error(
      `${tag} manifest ${manifestKey ?? `artifacts[${asset}]`} is ${claimed}, not the pinned ` +
        `${digest} — the tag moved.`,
    );
  }

  return dest;
}

/** A release's `addresses.json`, cached beside its assets. */
function releaseAddresses(tag) {
  const dir = resolve(CACHE_ROOT, tag);
  const path = resolve(dir, "addresses.json");
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    download(tag, "addresses.json", path);
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

/** Each engine's own identity as its release records it: the EVM address, the SVM program id. */
const ENGINE_IDENTITY = {
  "v12-evm": (addresses) => addresses.contracts?.engine?.address,
  "v12-svm": (addresses) => addresses.programs?.engine?.programId,
};

// ---------------------------------------------------------------------------
// A ROW THAT IS NOT RELEASED YET: report what to paste, and write nothing. An unpinned engine is not
// one to run, and keeping the previous row's artifacts on disk would pair them with a compiler they
// were never synced for.
//
// `--report <compiler>` does the same for any row, whatever compiler is installed, and reads every
// asset fresh from the registry rather than from the cache: how a row is filled in when its
// releases are out but the compiler that pairs with them is not installed yet. It writes nothing.
{
  const report = REPORT !== undefined;
  const unpinned = report ? PINS : PINS.filter((p) => p.digest === null);
  const unnamed = Object.keys(ENGINE_IDENTITY).filter((c) => report || SET[c].engine === null);
  if (unpinned.length > 0 || unnamed.length > 0) {
    console.error(
      report
        ? `[sync-engine-artifacts] releases.json's row for compiler ${COMPILER}, read from its releases:`
        : `[sync-engine-artifacts] releases.json's row for compiler ${COMPILER} is not pinned yet. From ` +
            "the releases it names — paste these into that row, then run this again:",
    );
    for (const p of unpinned) {
      const dir = resolve(CACHE_ROOT, p.tag, ...(report ? [".report"] : []));
      mkdirSync(dir, { recursive: true });
      const dest = resolve(dir, p.asset);
      try {
        if (report) rmSync(dest, { force: true });
        if (!existsSync(dest)) download(p.tag, p.asset, dest);
        console.error(`  ${p.tag} ${p.asset}: "${p.hash(readFileSync(dest))}"`);
      } catch (e) {
        console.error(`  ${p.tag} ${p.asset}: not available — ${e.message}`);
      }
    }
    for (const component of unnamed) {
      const tag = `${component}-v${SET[component].version}`;
      try {
        let addresses;
        if (report) {
          const fresh = resolve(CACHE_ROOT, tag, ".report", "addresses.json");
          mkdirSync(dirname(fresh), { recursive: true });
          rmSync(fresh, { force: true });
          download(tag, "addresses.json", fresh);
          addresses = JSON.parse(readFileSync(fresh, "utf8"));
        } else {
          addresses = releaseAddresses(tag);
        }
        console.error(`  ${tag} engine: "${ENGINE_IDENTITY[component](addresses)}"`);
      } catch (e) {
        console.error(`  ${tag} engine: not available — ${e.message}`);
      }
    }
    process.exit(report ? 0 : 1);
  }
}

// Whether artifacts a previous sync left on disk may stand in for a fetch that failed here. Only
// when that sync was for THIS compiler: `V12Deployments.json` records which one, and artifacts from
// another row pair with a compiler that is not the one installed.
const onDiskIsThisRow = () =>
  DESTS.every((d) => {
    const path = resolve(d, "V12Deployments.json");
    if (!existsSync(path)) return false;
    try {
      return JSON.parse(readFileSync(path, "utf8")).compiler === COMPILER;
    } catch {
      return false;
    }
  });

// SDK artifact name -> where its ABI comes from.
//
// The names on the LEFT are the SDK's own and are shipped to consumers, so they do not move; v12
// renamed three of the four (`ISauceRouter` -> `IRouter`, `V12Pot` -> `Pot`, `V12Kitchen` ->
// `Kitchen`; `Router` is unchanged) and that is a remap here rather than a rename downstream.
// `V12KitchenProxy` is the UUPS proxy every Kitchen address is: shipped so a local stack can be
// deployed from creation code exactly as a release deploys it, proxy and initializer included.
//
// Two artifacts left the set entirely. `SauceRouter` was the v1 router and no release publishes it;
// `IStateView` is Uniswap V4's. Nothing in `sdk/src` reads either — but `dev-tools` DID read
// `SauceRouter.json` for its local deploy flow, which is blocked until that flow moves to the
// Pot/Kitchen model (see `dev-tools/scripts/deploy.ts`).
const RELEASE_ABIS = {
  Router: "Router",
  ISauceRouter: "IRouter",
  V12Pot: "Pot",
  V12Kitchen: "Kitchen",
  V12KitchenProxy: "KitchenProxy",
};

/**
 * ERC-20, declared here rather than fetched.
 *
 * It was only ever in the engine's forge output because the engine happens to compile
 * OpenZeppelin's copy; the interface is the frozen standard and is not v12's to publish, so it
 * appears in no release asset. OpenZeppelin's npm package ships Solidity sources, not ABIs, so
 * there is nothing to read from `node_modules` either. These are the six functions the SDK's
 * generated SauceScript calls — byte-identical to the ABI the forge artifact carried.
 */
const IERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

/** Uniswap's, from its own npm package — likewise never v12's to publish. */
const IUNISWAP_V3_POOL = resolve(
  REPO_ROOT,
  "node_modules",
  "@uniswap",
  "v3-core",
  "artifacts",
  "contracts",
  "interfaces",
  "IUniswapV3Pool.sol",
  "IUniswapV3Pool.json",
);

// Committed + shipped location first; the gitignored src copy is kept coherent for local dev (the
// drift tests read it).
const DESTS = [resolve(SDK_DIR, "dist", "artifacts"), resolve(SDK_DIR, "src", "artifacts")];
for (const d of DESTS) mkdirSync(d, { recursive: true });

// The SVM engine binaries the SDK SHIPS. Unlike the JSON above (rewritten every build), the `.so`
// are large release binaries and land here only under `--fetch-v12-engines` (see the tail): the
// release build fetches them, this copies them into `dist/artifacts/svm`, and `files: ["sdk/dist"]`
// carries them into the tarball. That is the ONLY way a consumer gets the engine — `eco-incorp/v12`
// is private, so the fetch path is closed to them; the packaged binary + `svm/engine-artifacts.ts`
// resolver is what lets them run programs locally (LiteSVM) with no credentials. Mirrored into
// `src/artifacts/svm` so a from-source dev tree resolves the same paths the built package does.
const SVM_DESTS = DESTS.map((d) => resolve(d, "svm"));

// Copy one fetched binary into every shipped SVM dir under `name`.
const shipSvmBinary = (srcPath, name) => {
  for (const d of SVM_DESTS) {
    mkdirSync(d, { recursive: true });
    copyFileSync(srcPath, resolve(d, name));
  }
};

const write = (name, artifact) => {
  const json = JSON.stringify(artifact);
  for (const dest of DESTS) writeFileSync(resolve(dest, `${name}.json`), json);
};

// The release-derived ABIs, with the same latitude V12RuntimeBytecode gets below: a developer who is
// offline or unauthenticated keeps whatever a previous sync left and gets a warning. It is only
// latitude when there IS something to keep — with nothing on disk this stops, because continuing
// would write a partial artifact set, which is how 0.7.0 shipped broken. Either way CI is unaffected:
// it has credentials, and asserts all seven files afterwards.
let releaseAbis;
let fetched = false;
try {
  const parsed = JSON.parse(readFileSync(fetchReleaseAsset(V12_EVM_ABIS), "utf8"));
  // A parse that yields no `.contracts` is a SCHEMA CHANGE, not a fetch failure, and the two must
  // not share a sentinel: `undefined` from a successful parse would otherwise take the
  // keep-what-is-on-disk path below and skip all four ABIs behind a success log.
  if (parsed?.contracts === undefined) {
    console.error(
      `[sync-engine-artifacts] ${V12_EVM_ABIS.tag}/abis.json has no 'contracts' object — it carries: ` +
        `${Object.keys(parsed ?? {}).join(", ") || "(nothing)"}. The release schema changed; this ` +
        "script needs updating rather than working around it.",
    );
    process.exit(1);
  }
  releaseAbis = parsed.contracts;
  fetched = true;
} catch (e) {
  const present = Object.keys(RELEASE_ABIS).every((name) =>
    DESTS.every((d) => existsSync(resolve(d, `${name}.json`))),
  );
  if (!present || !onDiskIsThisRow()) {
    console.error(
      `[sync-engine-artifacts] ${e.message}` +
        (present
          ? ` — and the ABIs on disk were synced for another compiler than ${COMPILER}.`
          : ""),
    );
    process.exit(1);
  }
  console.warn(
    `[sync-engine-artifacts] ${e.message} — kept the ${Object.keys(RELEASE_ABIS).length} ABIs ` +
      "already on disk.",
  );
}

if (fetched) {
  for (const [name, contract] of Object.entries(RELEASE_ABIS)) {
    const found = releaseAbis[contract];
    if (found === undefined) {
      console.error(
        `[sync-engine-artifacts] ${V12_EVM_ABIS.tag}/abis.json has no contract '${contract}' (for ` +
          `${name}.json). It carries: ${Object.keys(releaseAbis).join(", ")}.`,
      );
      process.exit(1);
    }
    write(name, { abi: found.abi, bytecode: found.bytecode });
  }
}

write("IERC20", { abi: IERC20_ABI, bytecode: { object: "0x" } });

if (!existsSync(IUNISWAP_V3_POOL)) {
  console.error(
    `[sync-engine-artifacts] ${IUNISWAP_V3_POOL} is missing — run \`pnpm install\` (@uniswap/v3-core ` +
      "is a devDependency of the ROOT package.json).",
  );
  process.exit(1);
}
{
  const pool = JSON.parse(readFileSync(IUNISWAP_V3_POOL, "utf8"));
  write("IUniswapV3Pool", { abi: pool.abi, bytecode: { object: "0x" } });
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
const GATE_DEST = "V12EngineGate.json";
let runtimeCreationPath;

/** A copy kept on disk after a failed fetch must be from this compiler's row; anything else stops. */
const refuseAnotherRow = (present, name, e) => {
  if (!present || onDiskIsThisRow()) return;
  console.error(
    `[sync-engine-artifacts] ${name}: ${e.message} — and the copy on disk was synced for another ` +
      `compiler than ${COMPILER}, so it cannot stand in.`,
  );
  process.exit(1);
};

try {
  runtimeCreationPath = fetchReleaseAsset(V12_EVM);
  const creationCode = readFileSync(runtimeCreationPath, "utf8").trim();
  const json = `${JSON.stringify({ runtimeCreationCode: creationCode }, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, RUNTIME_DEST), json);
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, RUNTIME_DEST)));
  refuseAnotherRow(present, RUNTIME_DEST, e);
  console.warn(
    `[sync-engine-artifacts] V12RuntimeBytecode: ${e.message} — ` +
      (present ? "kept the copy already on disk." : "NOT produced."),
  );
}

// ---------------------------------------------------------------------------
// The GATE ANCHORS, which a test harness cannot work without.
//
// The released engine runs only when `CREATE2(KITCHEN, gateSalt(potId), POT_INITCODEHASH)` lands on
// its caller, and both constants are baked into the artifact at release time. A harness therefore
// has to stand up a Kitchen at exactly that address, minting Pots whose init code hashes to exactly
// that hash — so it needs both of these, and neither can be guessed.
//
// Both come from the engine release's own manifest (`gate`), already fetched and cross-checked
// above. The Router is NOT an anchor: a Pot reads its Router from the Kitchen's storage, so no Pot
// hash and no gate derives from it (it lives in `V12Deployments.json` with the other addresses).
// The harness asserts the deployed Kitchen's live `potInitCodeHash()` against the pinned one.
try {
  const manifest = JSON.parse(
    readFileSync(resolve(CACHE_ROOT, V12_EVM.tag, "manifest.json"), "utf8"),
  );
  const gate = {
    kitchen: manifest.gate?.kitchen,
    potInitCodeHash: manifest.gate?.potInitCodeHash,
  };
  if (Object.values(gate).some((value) => value === undefined)) {
    throw new Error(`incomplete gate anchors: ${JSON.stringify(gate)}`);
  }
  const json = `${JSON.stringify(gate, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, GATE_DEST), json);
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, GATE_DEST)));
  refuseAnotherRow(present, GATE_DEST, e);
  console.warn(
    `[sync-engine-artifacts] V12EngineGate: ${e.message} — ` +
      (present ? "kept the copy already on disk." : "NOT produced."),
  );
}

// ---------------------------------------------------------------------------
// V12Deployments.json — the DEPLOYED addresses, assembled from the `addresses.json` each of the four
// releases publishes, down the same fetch path as the engine bytecode above. EVM addresses are CREATE3
// and the SVM programs are fixed/derived keypairs, so every one is `chainIndependent` /
// `clusterIndependent`: one address set, not a per-chain table. Shipped in the package (files:
// ["sdk/dist"]) and read at runtime by `src/deployments/v12-addresses.ts`.
//
// These are ADDRESSES (deterministic, always resolvable), NOT liveness: the deployed Kitchen does not
// have code on every chain yet. addresses.json carries no digest in the manifest (unlike the
// bytecode), so a moved tag is caught other ways: the version baked into each addresses.json must
// match its tag, the EVM Kitchen and Pot hash must equal the engine gate's own, and each engine's
// identity must be the one releases.json records.
//
// `compiler` records which row of releases.json this is — the compiler every program the SDK
// compiles comes from, and the one `deployments/releases.ts` checks engines against.
const DEPLOYMENTS_DEST = "V12Deployments.json";
const tagVersion = (tag) => tag.replace(/^.*-v(?=\d)/, "");

// The Router's GENERATION, read off its CREATE3 salt: a fixed-address salt is
// `deployer ‖ 00 ‖ "Router" NUL-padded to 8 bytes ‖ 00 00 G` (v12's `evm-create3-salt.mjs --fixed`),
// so G is the salt's last byte. Recorded because a swap on a Synthra/UnitFlow pool needs generation 3
// and a Pot on an older Router cannot pay one; the SDK names the generation, never a Router address.
const ROUTER_SALT = /^0x[0-9a-f]{40}00526f7574657200000000(?<generation>[0-9a-f]{2})$/;
const routerGeneration = (router) => {
  const match = ROUTER_SALT.exec(String(router?.rawSalt).toLowerCase());
  const generation = match ? Number.parseInt(match.groups.generation, 16) : 0;
  if (router?.saltName !== "Router" || generation < 1) {
    throw new Error(`the Router's salt ${router?.rawSalt} is not a fixed-generation Router salt`);
  }

  return generation;
};
const addressesFor = (tag) => {
  const parsed = releaseAddresses(tag);
  if (parsed.version !== tagVersion(tag)) {
    throw new Error(
      `${tag}/addresses.json version ${parsed.version} != tag version ${tagVersion(tag)} — the tag moved`,
    );
  }
  return parsed;
};
const quoteRouter = addressesFor(QUOTE_ROUTER_ABIS.tag).contracts.router;
{
  const released = JSON.parse(readFileSync(fetchReleaseAsset(QUOTE_ROUTER_ABIS), "utf8"));
  const { abi, bytecode } = released.contracts.Router;
  if (routerGeneration(quoteRouter) !== 3 || !abi.some((item) => item.name === "quote")) {
    throw new Error("the quote service must be the generation-3 Router with quote(QuoteParams)");
  }
  write("V12QuoteRouter", { abi, bytecode, address: quoteRouter.address });
}
try {
  const evm = addressesFor(V12_EVM.tag); // engine
  const kitchenEvm = addressesFor(V12_EVM_ABIS.tag); // router + kitchen + kitchenImplementation + pot
  const svm = addressesFor(V12_SVM.tag); // engine program
  const kitchenSvm = addressesFor(V12_KITCHEN.tag); // kitchen program
  const deployments = {
    compiler: COMPILER,
    version: kitchenEvm.version,
    commit: kitchenEvm.commit,
    releases: Object.fromEntries(
      Object.entries({
        "v12-evm": evm,
        "kitchen-evm": kitchenEvm,
        "v12-svm": svm,
        "kitchen-svm": kitchenSvm,
      }).map(([component, { version, commit }]) => [component, { version, commit }]),
    ),
    evm: {
      chainIndependent: true,
      factory: kitchenEvm.factory,
      deployer: kitchenEvm.deployer,
      contracts: {
        engine: evm.contracts.engine,
        router: {
          ...kitchenEvm.contracts.router,
          generation: routerGeneration(kitchenEvm.contracts.router),
        },
        quoteRouter: { ...quoteRouter, generation: routerGeneration(quoteRouter) },
        kitchen: kitchenEvm.contracts.kitchen,
        kitchenImplementation: kitchenEvm.contracts.kitchenImplementation,
      },
      pot: kitchenEvm.pot,
    },
    svm: {
      clusterIndependent: true,
      programs: { engine: svm.programs.engine, kitchen: kitchenSvm.programs.kitchen },
    },
  };
  // A partial address set is the 0.7.0 failure shape — refuse to write one.
  const required = {
    "evm.contracts.engine": deployments.evm.contracts.engine?.address,
    "evm.contracts.router": deployments.evm.contracts.router?.address,
    "evm.contracts.kitchen": deployments.evm.contracts.kitchen?.address,
    "evm.contracts.kitchenImplementation": deployments.evm.contracts.kitchenImplementation?.address,
    "evm.pot.initCodeHash": deployments.evm.pot?.initCodeHash,
    "svm.programs.engine": deployments.svm.programs.engine?.programId,
    "svm.programs.kitchen": deployments.svm.programs.kitchen?.programId,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`addresses.json missing ${missing.join(", ")}`);
  // Corroborate against the engine's own gate: the Kitchen these addresses name must be the Kitchen
  // the released engine gates every cook to, or they describe a different stack than the engine ships.
  const engineManifest = JSON.parse(
    readFileSync(resolve(CACHE_ROOT, V12_EVM.tag, "manifest.json"), "utf8"),
  );
  const gateKitchen = engineManifest.gate?.kitchen;
  if (gateKitchen && deployments.evm.contracts.kitchen.address !== gateKitchen) {
    throw new Error(
      `kitchen-evm Kitchen ${deployments.evm.contracts.kitchen.address} != engine gate Kitchen ${gateKitchen}`,
    );
  }
  // …and the Pot init-code hash the kitchen release mints under must be the one the engine gates on:
  // a Kitchen upgrade that moves it orphans every Pot it mints from this engine.
  const gateHash = engineManifest.gate?.potInitCodeHash;
  if (gateHash && deployments.evm.pot.initCodeHash !== gateHash) {
    throw new Error(
      `kitchen-evm Pot initCodeHash ${deployments.evm.pot.initCodeHash} != engine gate hash ${gateHash}`,
    );
  }
  // The engine identities releases.json records are what `deployments/releases.ts` refuses other
  // compilers' programs on, so they must be the ones these releases actually publish.
  const identities = { "v12-evm": evm, "v12-svm": svm };
  for (const [component, addresses] of Object.entries(identities)) {
    const published = ENGINE_IDENTITY[component](addresses);
    const recorded = SET[component].engine;
    const same =
      component === "v12-evm"
        ? String(published).toLowerCase() === String(recorded).toLowerCase()
        : published === recorded;
    if (!same) {
      throw new Error(
        `releases.json records the ${component} ${SET[component].version} engine as ${recorded}, ` +
          `but its addresses.json publishes ${published}`,
      );
    }
  }
  const json = `${JSON.stringify(deployments, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, DEPLOYMENTS_DEST), json);
  console.log(
    `[sync-engine-artifacts] wrote ${DEPLOYMENTS_DEST} — compiler ${COMPILER}: engines ${evm.version}/${svm.version}, kitchens ${kitchenEvm.version}/${kitchenSvm.version}`,
  );
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, DEPLOYMENTS_DEST)));
  refuseAnotherRow(present, DEPLOYMENTS_DEST, e);
  console.warn(
    `[sync-engine-artifacts] V12Deployments: ${e.message} — ` +
      (present ? "kept the copy already on disk." : "NOT produced."),
  );
}

console.log(
  !fetched
    ? "[sync-engine-artifacts] wrote IERC20 (declared) and IUniswapV3Pool (@uniswap/v3-core); the " +
        "release ABIs were kept as they were"
    : `[sync-engine-artifacts] wrote ${Object.keys(RELEASE_ABIS).length} ABIs from ` +
        `${V12_EVM_ABIS.tag}/abis.json, plus IERC20 (declared) and IUniswapV3Pool (@uniswap/v3-core)`,
);

// `--fetch-v12-engines`: also place the SVM engine binary in the cache, and print every cached path
// as `NAME=<path>`. CI appends these to $GITHUB_ENV so SAUCE_RUST_ENGINE_SO and the runtime-derivation
// step read the same verified, cached bytes this script already fetched — one download, one digest
// check, no second implementation in YAML.
if (process.argv.includes("--fetch-v12-engines")) {
  const enginePath = fetchReleaseAsset(V12_SVM);
  const engineMainnetPath = fetchReleaseAsset(V12_SVM_MAINNET);
  const wireMainnetPath = fetchReleaseAsset(V12_ENGINE_WIRE_MAINNET);
  const kitchenPath = fetchReleaseAsset(V12_KITCHEN);
  const wirePath = fetchReleaseAsset(V12_ENGINE_WIRE);
  const kitchenIdlPath = fetchReleaseAsset(V12_KITCHEN_IDL);
  if (!runtimeCreationPath)
    throw new Error("--fetch-v12-engines: the v12 EVM runtime creation code was not fetched");

  // Ship the digest-verified binaries so they ride in the package (see SVM_DESTS above). Both
  // clusters plus the kitchen, plus the wire/IDL a local harness reads alongside them.
  shipSvmBinary(enginePath, "engine-devnet.so");
  shipSvmBinary(engineMainnetPath, "engine-mainnet.so");
  shipSvmBinary(kitchenPath, "kitchen.so");
  shipSvmBinary(wirePath, "engine-wire-devnet.json");
  shipSvmBinary(wireMainnetPath, "engine-wire-mainnet.json");
  shipSvmBinary(kitchenIdlPath, "kitchen-idl.json");
  console.log(`[sync-engine-artifacts] shipped SVM engine binaries into ${SVM_DESTS[0]}`);

  console.log(`SAUCE_RUST_ENGINE_SO=${enginePath}`);
  console.log(`SAUCE_RUST_ENGINE_MAINNET_SO=${engineMainnetPath}`);
  console.log(`SAUCE_ENGINE_WIRE_MAINNET_JSON=${wireMainnetPath}`);
  console.log(`SAUCE_KITCHEN_SO=${kitchenPath}`);
  console.log(`SAUCE_ENGINE_WIRE_JSON=${wirePath}`);
  console.log(`SAUCE_KITCHEN_IDL_JSON=${kitchenIdlPath}`);
  console.log(`SAUCE_V12_RUNTIME_CREATION_HEX=${runtimeCreationPath}`);
}
