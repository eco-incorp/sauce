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
// The installed row's raw assets also ship, under `dist/artifacts/releases/<first compiler naming
// them>/` (SDK 1.1.0's opt-in path, `releases/2.6.3/`, kept): they are the same release as the
// top-level artifacts, which are derived from them. SDK 1.1.0's documented `releases/2.6.3/` keeps
// shipping that release (`KEPT_ASSET_FOLDERS`), read from the public package that row pins.
//
// The engines the installed compiler's output also runs on (`alsoRunsOn` in its row) mint Pots the
// SDK still cooks, each on its own engine. Their artifacts do not ship: the suites that cook such a
// Pot read them from `src/artifacts/legacy/<compiler>/`, taken from the public package of the
// newest row pinning that engine (integrity-pinned in `releases.json`, no credential) and held to
// that row's digests (`readLegacyArtifacts`, below). A CREATE3 row's legacy files are derived from
// its raw assets, which the public package ships under `releases/<compiler>/`.
//
// A run reads and checks everything before it writes anything: the raw assets, what the default
// artifacts are made of and the earlier releases' artifacts. It then writes them all together
// (`flush`): the derived artifacts, the SVM binaries, the raw assets, the earlier releases'. A
// refusal, whichever check makes it, leaves sdk/{src,dist}/artifacts as it was.
//
// Run: `pnpm --filter './sdk' sync-engine-artifacts` (after `pnpm install`).
// `--fetch-v12-engines` additionally downloads the SVM engine binary and prints every cached path as
// `NAME=<path>` lines — how CI gets SAUCE_RUST_ENGINE_SO / the runtime creation code.
// `SAUCE_ARTIFACT_SOURCE=npm` takes the same artifacts, held to the same digests, from the PUBLIC
// `@eco-incorp/sauce` tarball the row names instead of the private release packages: for a fork, or
// anyone the packages' grant does not cover (see "THE PUBLIC SOURCE" below). Unset, the private
// packages are the only source, and a failure there never switches to the public one.
// NOTE: a `rm -rf sdk/dist` clean build drops these (tsc emits no JSON) — re-run this after such a
// build. The normal `tsc` build leaves them in place.
// `src/artifacts/legacy/` is written for the suites only; nothing copies it into `dist`.
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
import { isDeepStrictEqual } from "node:util";
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
// compiler; historical rows preserve the compatibility checks for older releases. The installed row
// is the SDK's defaults. A row's `alsoRunsOn` (an earlier engine its compiler's output runs on) is
// read by `deployments/releases.ts`; the suites that cook an earlier Pot read that release's
// artifacts from `src/artifacts/legacy/` (below).
//
// There is deliberately no commit pin. The components release INDEPENDENTLY, so a shared commit is
// not a property this can rely on. Requiring one shared commit made a
// routine per-component bump fail as "the tag moved".
//
// To bump: edit the row's versions, run this script, and paste the digests, engine ids and the
// kitchen-evm release's Kitchen and Pot init-code hash it reports. A row with a `null` digest,
// engine id, Kitchen or hash is a release that is not out yet: this script
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
const CURRENT = RELEASE_SETS.find((row) => row.compiler === COMPILER);
const SET = CURRENT;
if (!CURRENT) {
  console.error(
    `[sync-engine-artifacts] the installed compiler is ${COMPILER}, and releases.json pairs no ` +
      `engines with it — it has rows for ${RELEASE_SETS.map((row) => row.compiler).join(", ")}. ` +
      "Add the row for this compiler rather than syncing engines it cannot run on.",
  );
  process.exit(1);
}
if (CURRENT.deployedCompiler !== undefined) {
  console.error(
    `[sync-engine-artifacts] releases.json's ${COMPILER} row sets deployedCompiler, which nothing ` +
      "reads since SDK 1.2.0: remove it — a row's own releases are the defaults",
  );
  process.exit(1);
}

// WHERE THE ARTIFACTS COME FROM, chosen by the caller and never by a failure: the private release
// packages (the default), or `npm`, the public tarball of the `@eco-incorp/sauce` version this row
// names. Not "no credential": a fork's workflow HAS a GITHUB_TOKEN, it only lacks the grant.
const ARTIFACT_SOURCES = ["github-packages", "npm"];
const SOURCE = process.env.SAUCE_ARTIFACT_SOURCE || "github-packages";
if (!ARTIFACT_SOURCES.includes(SOURCE)) {
  console.error(
    `[sync-engine-artifacts] SAUCE_ARTIFACT_SOURCE is '${SOURCE}': expected one of ` +
      `${ARTIFACT_SOURCES.join(", ")} (unset means github-packages).`,
  );
  process.exit(1);
}

// What every failure to read the private packages says, so nobody has to find the public mode.
const PUBLIC_MODE_HINT =
  "Without read access to these packages (a fork, or a checkout the grant does not cover), set " +
  "SAUCE_ARTIFACT_SOURCE=npm: the same artifacts, held to the same digests, from the public " +
  "@eco-incorp/sauce package releases.json names for this compiler.";

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
  "pot-profile.json": { manifestKey: "potProfile.sha256", hash: sha256 },
  "addresses.json": { manifestKey: false, hash: sha256 },
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
// The current execution Router only swaps; generation 3 remains the token-free quote service.
const QUOTE_ROUTER_ABIS = {
  tag: `kitchen-evm-v${RELEASE_TABLE.quoteRouter.version}`,
  asset: "abis.json",
  digest: RELEASE_TABLE.quoteRouter.assets["abis.json"],
  ...ASSET_FORMATS["abis.json"],
};
// The quote Router's release addresses (`addresses.json`: its address and salt), pinned like every
// asset of the row's own releases, so a cached copy cannot stand in for it: `releases.json`'s
// `quoteRouter.assets` holds both digests.
const QUOTE_ROUTER_ADDRESSES = {
  tag: QUOTE_ROUTER_ABIS.tag,
  asset: "addresses.json",
  digest: RELEASE_TABLE.quoteRouter.assets["addresses.json"],
  ...ASSET_FORMATS["addresses.json"],
};
if (!/^[0-9a-f]{64}$/.test(QUOTE_ROUTER_ADDRESSES.digest ?? "")) {
  console.error(
    `[sync-engine-artifacts] releases.json's quoteRouter pins no sha256 for ` +
      `${QUOTE_ROUTER_ADDRESSES.tag}/addresses.json: a file nothing pins is not read.`,
  );
  process.exit(1);
}

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

// A row from kitchen-evm 1.4.0 on also pins each release's addresses.json and the Pot profile: the
// defaults' identities are read from them, so they are held to their digests like every asset.
const OPTIONAL_PINS = [
  ["v12-evm", "addresses.json"],
  ["kitchen-evm", "addresses.json"],
  ["v12-svm", "addresses.json"],
  ["kitchen-svm", "addresses.json"],
  ["v12-evm", "pot-profile.json"],
  ["kitchen-evm", "pot-profile.json"],
]
  .filter(([component, asset]) => SET[component].assets[asset] !== undefined)
  .map(([component, asset]) => pin(component, asset));

const PINS = [
  V12_EVM,
  V12_EVM_ABIS,
  V12_SVM,
  V12_SVM_MAINNET,
  V12_ENGINE_WIRE,
  V12_ENGINE_WIRE_MAINNET,
  V12_KITCHEN,
  V12_KITCHEN_IDL,
  ...OPTIONAL_PINS,
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

  if (SOURCE === "npm") {
    // Never reached by design; here so no path of the public mode can send the credential.
    throw new Error("the private release packages are never read under SAUCE_ARTIFACT_SOURCE=npm");
  }
  const name = `${NPM_SCOPE}/${parts.pkg}`;
  const credential = githubCredential();
  if (!credential) {
    throw new Error(
      `cannot download ${asset} from ${name}@${parts.version} — no GitHub credential found. These ` +
        "packages are private, so the read is authenticated: set GITHUB_TOKEN (CI supplies its own " +
        "automatically) or run `gh auth login`. No personal access token needs to be minted. " +
        PUBLIC_MODE_HINT,
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
        `and no personal access token is involved. ${PUBLIC_MODE_HINT}`,
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
  if (manifestKey === false) return dest;

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

/** A release's `addresses.json`, cached beside its assets and held to its digest on EVERY read
 *  (`fetchReleaseAsset` hashes the cached file each time): the row's own, or the quote Router's
 *  (`QUOTE_ROUTER_ADDRESSES`). A file no digest pins is not read: there is no unverified branch. */
function releaseAddresses(tag) {
  const pinned = [...PINS, QUOTE_ROUTER_ADDRESSES].find(
    (p) => p.tag === tag && p.asset === "addresses.json",
  );
  if (pinned === undefined) {
    throw new Error(
      `no digest in releases.json pins ${tag}/addresses.json: it is not read unverified`,
    );
  }

  return JSON.parse(readFileSync(fetchReleaseAsset(pinned), "utf8"));
}

/** Each engine's own identity as its release records it: the EVM address, the SVM program id. */
const ENGINE_IDENTITY = {
  "v12-evm": (addresses) => addresses.contracts?.engine?.address,
  "v12-svm": (addresses) => addresses.programs?.engine?.programId,
};

/** What the EVM Kitchen's release says every Pot it mints is placed by: the Kitchen proxy and the
 *  Pot's identity — its init-code hash (CREATE2, up to kitchen-evm 1.3.0), or its proxy's hash, the
 *  Pot profile and the fixed Router (CREATE3, from 1.4.0). The `sauce` command tells which release
 *  minted a Pot from them. */
const POT_FAMILY_CREATE2 = {
  kitchen: (addresses) => addresses.contracts?.kitchen?.address,
  potInitCodeHash: (addresses) => addresses.pot?.initCodeHash,
};
const POT_FAMILY_CREATE3 = {
  kitchen: (addresses) => addresses.contracts?.kitchen?.address,
  potProxyInitCodeHash: (addresses) => addresses.pot?.potProxyInitCodeHash,
  potProfileHash: (addresses) => addresses.pot?.potProfileHash,
  fixedRouter: (addresses) => addresses.pot?.fixedRouter,
};
const POT_FAMILY =
  SET["kitchen-evm"].potProxyInitCodeHash !== undefined ? POT_FAMILY_CREATE3 : POT_FAMILY_CREATE2;

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
  const unfamilied = Object.keys(POT_FAMILY).filter(
    (field) => report || (SET["kitchen-evm"][field] ?? null) === null,
  );
  if (unpinned.length > 0 || unnamed.length > 0 || unfamilied.length > 0) {
    if (SOURCE === "npm") {
      console.error(
        `[sync-engine-artifacts] ${report ? "--report" : `releases.json's row for compiler ${COMPILER} is not pinned yet, and pinning it`} ` +
          "reads the private release packages, which SAUCE_ARTIFACT_SOURCE=npm never does.",
      );
      process.exit(1);
    }
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
    if (unfamilied.length > 0) {
      const tag = `kitchen-evm-v${SET["kitchen-evm"].version}`;
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
        for (const field of unfamilied) {
          console.error(`  ${tag} ${field}: "${POT_FAMILY[field](addresses)}"`);
        }
      } catch (e) {
        console.error(`  ${tag} ${unfamilied.join(", ")}: not available — ${e.message}`);
      }
    }
    process.exit(report ? 0 : 1);
  }
}

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

// NOTHING IS WRITTEN UNTIL EVERYTHING IS CHECKED. Every artifact write of a run waits here while the
// run reads and checks its inputs, and `flush` then makes them all, in the order they were queued.
const pending = [];
const later = (action) => pending.push(action);
/** Write `bytes` at `path`, making its folder. */
const put = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
};
function flush() {
  try {
    for (const action of pending.splice(0)) action();
  } catch (e) {
    console.error(`[sync-engine-artifacts] writing the artifacts failed: ${e.message}`);
    process.exit(1);
  }
}

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
    later(() => {
      mkdirSync(d, { recursive: true });
      copyFileSync(srcPath, resolve(d, name));
    });
  }
};

const write = (name, artifact) => {
  const json = JSON.stringify(artifact);
  for (const dest of DESTS) later(() => put(resolve(dest, `${name}.json`), json));
};

// ---------------------------------------------------------------------------
// THE PUBLIC SOURCE: `SAUCE_ARTIFACT_SOURCE=npm`.
//
// The release packages are private, so a fork of this repository, or anyone the grant does not
// cover, cannot read them. Every artifact this script writes also ships inside the PUBLIC
// `@eco-incorp/sauce` package on npmjs.com (`sdk/dist/artifacts`, written by this script in the
// release build). A row names the published version that carries it — `npm: { version,
// integrity, compiler? }`. `compiler` explicitly names an earlier source row with identical assets.
// It never reads the GitHub credential and never touches the per-tag cache the private
// path keeps, so the two sources never mix; the private path never falls back to it.
//
// The same guarantees, all checked before anything is written:
//   - the tarball hashes to the integrity COMMITTED in the row, not merely the one the registry
//     reports, so it is the exact package the row was pinned to;
//   - its own releases.json carries the committed source row; source and target assets are identical;
//   - every release asset it carries matches this row's digest, exactly as the private path checks
//     it: both SVM engines, both wire files, the Kitchen and its IDL, the EVM creation code;
//   - what it carries DERIVED rather than as the release asset — the ABIs out of the two abis.json
//     and the addresses assembled from each addresses.json — is rebuilt from the raw abis.json and
//     addresses.json the same tarball carries under releases/<folder>/ (each held to the row's
//     digest by `readReleaseAssets`) and must be the files it carries; it is also corroborated as
//     the private path corroborates it: the compiler, each component's version, both engine
//     identities, the Kitchen, the Pot init-code hash and, for a CREATE3 row, the Router, the scheme
//     and the deployer, against the row and the gate, and the generation-3 quote Router (whose
//     addresses.json the tarball carries no raw copy of, so that entry stands as corroborated).
// What it cannot repeat is the cross-check against each release's manifest, which the tarball does
// not carry; the private path calls that corroboration, never the guarantee. Any mismatch stops
// here with nothing written.
const PUBLIC_PACKAGE = "@eco-incorp/sauce";
const PUBLIC_REGISTRY = "https://registry.npmjs.org";

/** The row's public tarball, held to its committed integrity and cached by version: a reader of
 *  the files it carries, extracted afresh on every run. */
function publicPackage(row = SET) {
  const { version, integrity } = row.npm ?? {};
  if (!version || !integrity) {
    throw new Error(
      `releases.json's ${row.compiler} row names no public ${PUBLIC_PACKAGE} version carrying its ` +
        "artifacts (`npm`: { version, integrity }) — commit a published version built from " +
        "this row, or read the private release packages (unset SAUCE_ARTIFACT_SOURCE)",
    );
  }
  const split = integrity.indexOf("-");
  const [algorithm, expected] = [integrity.slice(0, split), integrity.slice(split + 1)];
  const dir = resolve(CACHE_ROOT, "npm", `sauce-${version}`);
  const archive = resolve(dir, "package.tgz");
  const pinned = (path) =>
    existsSync(path) &&
    createHash(algorithm).update(readFileSync(path)).digest("base64") === expected;
  if (!pinned(archive)) {
    mkdirSync(dir, { recursive: true });
    const tmp = `${archive}.partial`;
    rmSync(tmp, { force: true });
    // The public registry, unauthenticated: nothing here carries a credential.
    const url = `${PUBLIC_REGISTRY}/${PUBLIC_PACKAGE}/-/sauce-${version}.tgz`;
    try {
      execFileSync("curl", ["-sfL", "-o", tmp, url], { stdio: "ignore" });
    } catch (err) {
      // No credential on this command line, so the cause may ride along; only `message` prints.
      throw new Error(`cannot download ${PUBLIC_PACKAGE}@${version} (${curlFailure(err)})`, {
        cause: err,
      });
    }
    if (!pinned(tmp)) {
      rmSync(tmp, { force: true });
      throw new Error(
        `${PUBLIC_PACKAGE}@${version} does not hash to the ${integrity} releases.json pins`,
      );
    }
    renameSync(tmp, archive);
  }

  const out = resolve(dir, "package");
  rmSync(out, { recursive: true, force: true });
  const members = ["package/sdk/dist/artifacts", "package/sdk/dist/deployments/releases.json"];
  try {
    execFileSync("tar", ["-xzf", archive, "-C", dir, ...members], { stdio: "ignore" });
  } catch {
    throw new Error(`${PUBLIC_PACKAGE}@${version} carries no ${members.join(" or no ")}`);
  }
  const files = new Map();
  return (path) => {
    if (!files.has(path)) {
      const file = resolve(out, path);
      if (!existsSync(file)) throw new Error(`${PUBLIC_PACKAGE}@${version} carries no ${path}`);
      files.set(path, readFileSync(file));
    }
    return files.get(path);
  };
}

// Only the historical quote service has a fixed-address generation. The current execution Router
// is content-addressed and keeps its release metadata verbatim rather than inventing a generation.
const ROUTER_SALT = /^0x[0-9a-f]{40}00526f7574657200000000(?<generation>[0-9a-f]{2})$/;
const routerGeneration = (router) => {
  const match = ROUTER_SALT.exec(String(router?.rawSalt).toLowerCase());
  const generation = match ? Number.parseInt(match.groups.generation, 16) : 0;
  if (router?.saltName !== "Router" || generation < 1) {
    throw new Error(`the Router's salt ${router?.rawSalt} is not a fixed-generation Router salt`);
  }

  return generation;
};

/**
 * V12Deployments.json, made of the `addresses.json` each of the four releases publishes and the quote
 * Router's: the one place it is assembled. The private path writes what it returns, and the public
 * source holds the file its tarball carries to what it returns for the raw addresses.json that
 * tarball carries too. `potCreationHash` is keccak256 of the Pot's creation code: a CREATE3
 * release's addresses.json records no `initCodeHash`, and the one the Kitchen's `potInitCodeHash()`
 * reports is that.
 */
function assembleDeployments({
  compiler,
  evm,
  kitchenEvm,
  svm,
  kitchenSvm,
  quoteRouter,
  potCreationHash,
}) {
  return {
    compiler,
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
        router: kitchenEvm.contracts.router,
        ...(quoteRouter === undefined
          ? {}
          : { quoteRouter: { ...quoteRouter, generation: routerGeneration(quoteRouter) } }),
        kitchen: kitchenEvm.contracts.kitchen,
        kitchenImplementation: kitchenEvm.contracts.kitchenImplementation,
      },
      pot:
        kitchenEvm.pot.scheme === "create3"
          ? { ...kitchenEvm.pot, initCodeHash: potCreationHash }
          : kitchenEvm.pot,
    },
    svm: {
      clusterIndependent: true,
      programs: { engine: svm.programs.engine, kitchen: kitchenSvm.programs.kitchen },
    },
  };
}

function syncFromPublicPackage() {
  const read = publicPackage();
  const where = `${PUBLIC_PACKAGE}@${SET.npm.version}`;
  const refuse = (what) => {
    throw new Error(`${where} ${what}`);
  };
  const artifact = (name) => read(`sdk/dist/artifacts/${name}`);
  const parse = (bytes) => JSON.parse(bytes.toString("utf8"));

  // An explicit source compiler avoids requiring an unpublished SDK for a compiler-only bump.
  const sourceCompiler = SET.npm.compiler ?? SET.compiler;
  const sourceSet = RELEASE_SETS.find((row) => row.compiler === sourceCompiler);
  const bare = (row) => {
    const copy = { ...row };
    delete copy.npm;
    delete copy.compiler;
    return copy;
  };
  const shipped = parse(read("sdk/dist/deployments/releases.json"));
  const shippedRow = shipped.releases?.find((row) => row.compiler === sourceCompiler);
  if (
    !sourceSet ||
    !shippedRow ||
    !isDeepStrictEqual(bare(shippedRow), bare(sourceSet)) ||
    !isDeepStrictEqual(bare(sourceSet), bare(SET)) ||
    !isDeepStrictEqual(shipped.quoteRouter, RELEASE_TABLE.quoteRouter)
  ) {
    refuse(
      `does not carry the committed ${sourceCompiler} source row with the target ${COMPILER} assets`,
    );
  }

  // Every release asset it carries, by this row's digest. `abis.json` is the one it carries only
  // derived (below); a pin added without a place here is refused rather than left unchecked.
  const runtime = parse(artifact("V12RuntimeBytecode.json")).runtimeCreationCode;
  const carried = new Map([
    [V12_EVM, Buffer.from(`${runtime}\n`)],
    ...[
      V12_SVM,
      V12_SVM_MAINNET,
      V12_ENGINE_WIRE,
      V12_ENGINE_WIRE_MAINNET,
      V12_KITCHEN,
      V12_KITCHEN_IDL,
    ].map((p) => [p, artifact(`svm/${p.asset}`)]),
  ]);
  // The raw abis.json, addresses.json and pot-profile.json are held to their digests by
  // `readReleaseAssets`; what the first two say is held below, by rebuilding the derived files from
  // them, and through the identities of the derived V12Deployments.json and V12EngineGate.json.
  for (const p of PINS.filter((pin) => pin !== V12_EVM_ABIS && !OPTIONAL_PINS.includes(pin))) {
    if (!carried.has(p)) refuse(`is not read for ${p.tag}/${p.asset}: this script needs updating`);
    const actual = p.hash(carried.get(p));
    if (actual !== p.digest) {
      refuse(`carries a ${p.asset} hashing to ${actual}, not the ${p.digest} pinned for ${p.tag}`);
    }
  }

  // What it carries derived, held to the row as the private path holds addresses.json.
  const names = [
    ...Object.keys(RELEASE_ABIS),
    "V12QuoteRouter",
    "V12RuntimeBytecode",
    "V12EngineGate",
    "V12Deployments",
  ];
  const derived = Object.fromEntries(names.map((name) => [name, artifact(`${name}.json`)]));
  const deployments = parse(derived.V12Deployments);
  const gate = parse(derived.V12EngineGate);
  const quote = parse(derived.V12QuoteRouter);
  const contracts = deployments.evm?.contracts ?? {};
  const kitchenPin = SET["kitchen-evm"];
  const same = (a, b) =>
    typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  const held = {
    compiler: deployments.compiler === sourceCompiler,
    ...Object.fromEntries(
      ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"].map((c) => [
        `${c} version`,
        deployments.releases?.[c]?.version === SET[c].version,
      ]),
    ),
    "EVM engine": same(contracts.engine?.address, SET["v12-evm"].engine),
    "SVM engine": deployments.svm?.programs?.engine?.programId === SET["v12-svm"].engine,
    Kitchen:
      same(contracts.kitchen?.address, kitchenPin.kitchen) &&
      same(gate.kitchen, kitchenPin.kitchen),
    ...(kitchenPin.potProxyInitCodeHash === undefined
      ? {
          "Pot init-code hash":
            same(deployments.evm?.pot?.initCodeHash, kitchenPin.potInitCodeHash) &&
            same(gate.potInitCodeHash, kitchenPin.potInitCodeHash),
        }
      : {
          // CREATE3: the proxy and profile hashes and the fixed Router, as the deployments and the
          // gate carry them; `initCodeHash` is the Pot creation code's own hash, which the Kitchen
          // reports from `potInitCodeHash()`.
          "Pot identity":
            same(deployments.evm?.pot?.potProxyInitCodeHash, kitchenPin.potProxyInitCodeHash) &&
            same(gate.potProxyInitCodeHash, kitchenPin.potProxyInitCodeHash) &&
            same(deployments.evm?.pot?.potProfileHash, kitchenPin.potProfileHash) &&
            same(gate.potProfileHash, kitchenPin.potProfileHash) &&
            same(deployments.evm?.pot?.fixedRouter, kitchenPin.fixedRouter) &&
            same(deployments.evm?.pot?.initCodeHash, gate.potInitCodeHash) &&
            same(gate.potInitCodeHash, keccak256(parse(derived.V12Pot).bytecode)),
          // …and what the private path holds a CREATE3 row's whole stack to: the Router the Kitchen
          // names and the engine's gate carries, the scheme of both, and who deploys the Pot.
          Router:
            same(contracts.router?.address, kitchenPin.fixedRouter) &&
            same(gate.fixedRouter, kitchenPin.fixedRouter),
          "CREATE3 scheme":
            gate.scheme === "create3" &&
            deployments.evm?.pot?.scheme === "create3" &&
            same(deployments.evm?.pot?.deployer, kitchenPin.kitchen),
        }),
    "Router, Kitchen implementation, SVM Kitchen": Boolean(
      contracts.router?.address &&
      contracts.kitchenImplementation?.address &&
      deployments.svm?.programs?.kitchen?.programId,
    ),
    // From the public tarball the quote Router's addresses.json cannot be held to its digest: it is a
    // historical release's and the tarball carries no raw copy of it (the private path pins it, see
    // QUOTE_ROUTER_ADDRESSES). Here the guarantee is the tarball's committed integrity, and these two
    // derived files agreeing on one address and on generation 3.
    "quote Router":
      contracts.quoteRouter?.generation === 3 &&
      same(quote.address, contracts.quoteRouter?.address) &&
      Array.isArray(quote.abi) &&
      quote.abi.some((item) => item.name === "quote"),
    ABIs: Object.keys(RELEASE_ABIS).every((name) => Array.isArray(parse(derived[name]).abi)),
  };
  const disagree = Object.keys(held).filter((what) => !held[what]);
  if (disagree.length > 0) {
    refuse(`disagrees with releases.json's ${COMPILER} row on: ${disagree.join(", ")}`);
  }

  // The tarball carries the raw abis.json and addresses.json too, each held to the row's digest, so
  // what it carries derived from them is held to them as well as to what the row records: the ABIs
  // and V12Deployments.json are made again here as the private path makes them, and must be the
  // files it carries. The quote Router's addresses.json has no raw copy in it, so that entry is the
  // file's own, as `held` checked it.
  const raw = (component, asset) => {
    const found = available.find((entry) => entry.component === component && entry.asset === asset);
    if (found === undefined) {
      refuse(`carries no raw ${asset} of ${component} to hold the files it derives from it to`);
    }

    return parse(found.bytes);
  };
  const roundTrip = (value) => JSON.parse(JSON.stringify(value));
  const rawAbis = raw("kitchen-evm", "abis.json").contracts ?? {};
  const unlike = Object.entries(RELEASE_ABIS)
    .filter(
      ([name, contract]) =>
        !isDeepStrictEqual(
          parse(derived[name]),
          roundTrip({ abi: rawAbis[contract]?.abi, bytecode: rawAbis[contract]?.bytecode }),
        ),
    )
    .map(([name]) => `${name}.json`);
  const rebuilt = assembleDeployments({
    compiler: sourceCompiler,
    evm: raw("v12-evm", "addresses.json"),
    kitchenEvm: raw("kitchen-evm", "addresses.json"),
    svm: raw("v12-svm", "addresses.json"),
    kitchenSvm: raw("kitchen-svm", "addresses.json"),
    quoteRouter: contracts.quoteRouter,
    potCreationHash: keccak256(rawAbis.Pot?.bytecode ?? "0x"),
  });
  if (!isDeepStrictEqual(deployments, roundTrip(rebuilt))) unlike.push("V12Deployments.json");
  if (unlike.length > 0) {
    refuse(
      `carries ${unlike.join(", ")} that the raw, digest-pinned abis.json and addresses.json it ` +
        "also carries do not make",
    );
  }

  // Only compiler compatibility metadata changes; verified release artifacts remain byte-for-byte.
  if (sourceCompiler !== COMPILER) {
    derived.V12Deployments = Buffer.from(
      `${JSON.stringify({ ...deployments, compiler: COMPILER }, null, 2)}\n`,
    );
  }
  for (const [name, bytes] of Object.entries(derived)) {
    for (const dest of DESTS) later(() => put(resolve(dest, `${name}.json`), bytes));
  }
  writeLocalAbis();
  later(() =>
    console.log(
      `[sync-engine-artifacts] wrote ${names.length} release artifacts from ${where} ` +
        `(SAUCE_ARTIFACT_SOURCE=npm), each held to releases.json's ${COMPILER} row, plus IERC20 ` +
        "(declared) and IUniswapV3Pool (@uniswap/v3-core)",
    ),
  );

  if (process.argv.includes("--fetch-v12-engines")) {
    const dir = resolve(CACHE_ROOT, "npm", `sauce-${SET.npm.version}`);
    const place = (p) => {
      const path = resolve(dir, p.asset);
      writeFileSync(path, carried.get(p));
      return path;
    };
    shipEngines({
      engine: place(V12_SVM),
      engineMainnet: place(V12_SVM_MAINNET),
      wireMainnet: place(V12_ENGINE_WIRE_MAINNET),
      kitchen: place(V12_KITCHEN),
      wire: place(V12_ENGINE_WIRE),
      kitchenIdl: place(V12_KITCHEN_IDL),
      runtimeCreation: place(V12_EVM),
    });
  }
}

// The release's raw assets ship in the folder of the FIRST row naming these four releases, so a
// compiler-only release keeps the path: SDK 1.1.0 shipped the 1.4.0 set at releases/2.6.3/.
const ASSETS_FOLDER = RELEASE_SETS.find((row) =>
  ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"].every(
    (c) => row[c].version === CURRENT[c].version,
  ),
).compiler;

// The release's raw assets, each held to the row's digest and kept under its original name and
// bytes (`releases/<folder>/<tag>/<asset>`), so callers can verify them against the
// independently pinned row. `shipAvailable` ships them; the identities they carry are held where
// the defaults are assembled.
function readReleaseAssets() {
  const read = SOURCE === "npm" ? publicPackage(CURRENT) : undefined;
  const root = `releases/${ASSETS_FOLDER}`;
  const components = ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"];
  const fetched = components.flatMap((component) => {
    const { version, assets } = CURRENT[component];
    const tag = `${component}-v${version}`;

    return Object.entries(assets).map(([asset, digest]) => {
      const path = `${root}/${tag}/${asset}`;
      const { hash, manifestKey } = ASSET_FORMATS[asset] ?? DEFAULT_FORMAT;
      const bytes = read
        ? read(`sdk/dist/artifacts/${path}`)
        : readFileSync(fetchReleaseAsset({ tag, asset, digest, hash, manifestKey }));
      const actual = hash(bytes);
      if (actual !== digest) throw new Error(`${tag}/${asset} digest ${actual} != ${digest}`);

      return { component, asset, path, bytes };
    });
  });

  console.log(`[sync-engine-artifacts] verified ${fetched.length} assets for ${root}`);
  return fetched;
}

let available = [];
try {
  available = readReleaseAssets();
} catch (e) {
  console.error(`[sync-engine-artifacts] the release's raw assets: ${e.message}`);
  process.exit(1);
}
if (REPORT) process.exit(0);

// SDK 1.1.0 documented releases/2.6.3/ (its opt-in path). It keeps shipping the release it named,
// byte for byte: that row's raw assets, read from the public package that row pins (no credential,
// both artifact-source modes) and held to that row's digests.
const KEPT_ASSET_FOLDERS = ["2.6.3"];
function readKeptReleaseAssets() {
  const components = ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"];

  return KEPT_ASSET_FOLDERS.filter((folder) => folder !== ASSETS_FOLDER).flatMap((folder) => {
    const row = RELEASE_SETS.find((candidate) => candidate.compiler === folder);
    if (row === undefined) {
      throw new Error(
        `releases.json has no ${folder} row, whose raw assets ship under releases/${folder}/`,
      );
    }
    const read = publicPackage(row);

    return components.flatMap((component) => {
      const { version, assets } = row[component];
      const tag = `${component}-v${version}`;

      return Object.entries(assets).map(([asset, digest]) => {
        const path = `releases/${folder}/${tag}/${asset}`;
        const { hash } = ASSET_FORMATS[asset] ?? DEFAULT_FORMAT;
        const bytes = read(`sdk/dist/artifacts/${path}`);
        const actual = hash(bytes);
        if (actual !== digest) {
          throw new Error(
            `${PUBLIC_PACKAGE}@${row.npm.version} carries ${path} hashing to ${actual}, not the ` +
              `${folder} row's ${digest}`,
          );
        }

        return { component, asset, path, bytes };
      });
    });
  });
}

let kept = [];
try {
  kept = readKeptReleaseAssets();
} catch (e) {
  console.error(
    `[sync-engine-artifacts] the kept release assets: ${e.message} — refused, nothing written.`,
  );
  process.exit(1);
}

// The earlier releases' artifacts are read and held to their rows now, before anything is written:
// a refusal here leaves sdk/{src,dist}/artifacts as it was. Their files are written last.
let legacy = [];
try {
  legacy = readLegacyArtifacts();
} catch (e) {
  console.error(
    `[sync-engine-artifacts] the legacy artifacts: ${e.message} — refused, nothing written.`,
  );
  process.exit(1);
}

if (SOURCE === "npm") {
  try {
    syncFromPublicPackage();
    shipAvailable();
  } catch (e) {
    console.error(`[sync-engine-artifacts] ${e.message} — refused, nothing written.`);
    process.exit(1);
  }
  writeLegacyArtifacts(legacy);
  flush();
  process.exit(0);
}

// From here on every failure stops the sync, and nothing a previous sync left on disk stands in: a
// digest or manifest that does not match is a moved release, and a read the registry refuses is a
// missing grant (`SAUCE_ARTIFACT_SOURCE=npm`'s case), so neither may pass behind older files. A warm
// cache still needs no network and no credential.
const stop = (what, e) => {
  console.error(`[sync-engine-artifacts] ${what}: ${e.message}`);
  process.exit(1);
};

// The release-derived ABIs.
let releaseAbis;
try {
  const parsed = JSON.parse(readFileSync(fetchReleaseAsset(V12_EVM_ABIS), "utf8"));
  // A parse that yields no `.contracts` is a SCHEMA CHANGE, not a fetch failure: say so.
  if (parsed?.contracts === undefined) {
    console.error(
      `[sync-engine-artifacts] ${V12_EVM_ABIS.tag}/abis.json has no 'contracts' object — it carries: ` +
        `${Object.keys(parsed ?? {}).join(", ") || "(nothing)"}. The release schema changed; this ` +
        "script needs updating rather than working around it.",
    );
    process.exit(1);
  }
  releaseAbis = parsed.contracts;
} catch (e) {
  stop("the release ABIs", e);
}

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

// keccak256 of the Pot's creation code (abis.json's bytecode is a hex string): what the Kitchen's
// `potInitCodeHash()` reports, and the `initCodeHash` a CREATE3 release's Pot is recorded with
// (its addresses.json has none; the Pot's address does not derive from it).
const POT_CREATION_HASH = keccak256(releaseAbis.Pot.bytecode);

writeLocalAbis();

/** The two ABIs no release publishes, written the same way whichever source the rest came from. */
function writeLocalAbis() {
  write("IERC20", { abi: IERC20_ABI, bytecode: { object: "0x" } });

  if (!existsSync(IUNISWAP_V3_POOL)) {
    console.error(
      `[sync-engine-artifacts] ${IUNISWAP_V3_POOL} is missing — run \`pnpm install\` (@uniswap/v3-core ` +
        "is a devDependency of the ROOT package.json).",
    );
    process.exit(1);
  }
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
const RUNTIME_DEST = "V12RuntimeBytecode.json";
const GATE_DEST = "V12EngineGate.json";
let runtimeCreationPath;

try {
  runtimeCreationPath = fetchReleaseAsset(V12_EVM);
  const creationCode = readFileSync(runtimeCreationPath, "utf8").trim();
  const json = `${JSON.stringify({ runtimeCreationCode: creationCode }, null, 2)}\n`;
  for (const dest of DESTS) later(() => put(resolve(dest, RUNTIME_DEST), json));
} catch (e) {
  stop("V12RuntimeBytecode", e);
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
  // From v12-evm 1.4.0 the engine gates on the CREATE3 profile; `potInitCodeHash` stays, and is what
  // the Kitchen's `potInitCodeHash()` reports: keccak256 of the Pot's creation code.
  const gate =
    manifest.gate?.scheme === "create3"
      ? {
          kitchen: manifest.gate.kitchen,
          potInitCodeHash: POT_CREATION_HASH,
          scheme: "create3",
          fixedRouter: manifest.gate.fixedRouter,
          potProxyInitCodeHash: manifest.gate.potProxyInitCodeHash,
          potProfileHash: manifest.gate.potProfileHash,
        }
      : {
          kitchen: manifest.gate?.kitchen,
          potInitCodeHash: manifest.gate?.potInitCodeHash,
        };
  if (Object.values(gate).some((value) => value === undefined)) {
    throw new Error(`incomplete gate anchors: ${JSON.stringify(gate)}`);
  }
  const json = `${JSON.stringify(gate, null, 2)}\n`;
  for (const dest of DESTS) later(() => put(resolve(dest, GATE_DEST), json));
} catch (e) {
  stop("V12EngineGate", e);
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

const addressesFor = (tag) => {
  const parsed = releaseAddresses(tag);
  if (parsed.version !== tagVersion(tag)) {
    throw new Error(
      `${tag}/addresses.json version ${parsed.version} != tag version ${tagVersion(tag)} — the tag moved`,
    );
  }
  return parsed;
};
let quoteRouter;
try {
  quoteRouter = addressesFor(QUOTE_ROUTER_ABIS.tag).contracts.router;
  const released = JSON.parse(readFileSync(fetchReleaseAsset(QUOTE_ROUTER_ABIS), "utf8"));
  const { abi, bytecode } = released.contracts.Router;
  if (routerGeneration(quoteRouter) !== 3 || !abi.some((item) => item.name === "quote")) {
    throw new Error("the quote service must be the generation-3 Router with quote(QuoteParams)");
  }
  write("V12QuoteRouter", { abi, bytecode, address: quoteRouter.address });
} catch (e) {
  stop("the quote Router", e);
}
try {
  const evm = addressesFor(V12_EVM.tag); // engine
  const kitchenEvm = addressesFor(V12_EVM_ABIS.tag); // router + kitchen + kitchenImplementation + pot
  const svm = addressesFor(V12_SVM.tag); // engine program
  const kitchenSvm = addressesFor(V12_KITCHEN.tag); // kitchen program
  const create3 = SET["kitchen-evm"].potProxyInitCodeHash !== undefined;
  const deployments = assembleDeployments({
    compiler: COMPILER,
    evm,
    kitchenEvm,
    svm,
    kitchenSvm,
    quoteRouter,
    potCreationHash: POT_CREATION_HASH,
  });
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
  // …and the Pot identity the kitchen release mints under must be the one the engine gates on: a
  // Kitchen upgrade that moves it orphans every Pot it mints from this engine.
  if (create3) {
    for (const field of ["potProxyInitCodeHash", "potProfileHash"]) {
      const gated = engineManifest.gate?.[field];
      if (gated !== deployments.evm.pot[field]) {
        throw new Error(
          `kitchen-evm Pot ${field} ${deployments.evm.pot[field]} != engine gate ${field} ${gated}`,
        );
      }
    }
  } else {
    const gateHash = engineManifest.gate?.potInitCodeHash;
    if (gateHash && deployments.evm.pot.initCodeHash !== gateHash) {
      throw new Error(
        `kitchen-evm Pot initCodeHash ${deployments.evm.pot.initCodeHash} != engine gate hash ${gateHash}`,
      );
    }
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
  // So must the Kitchen and the Pot init-code hash the row records: they are how a Pot's release is
  // told, and a wrong one would name another release for every Pot this one mints.
  for (const [field, of] of Object.entries(POT_FAMILY)) {
    const published = String(of(kitchenEvm)).toLowerCase();
    const recorded = String(SET["kitchen-evm"][field]).toLowerCase();
    if (published !== recorded) {
      throw new Error(
        `releases.json records the kitchen-evm ${kitchenEvm.version} ${field} as ` +
          `${SET["kitchen-evm"][field]}, but its addresses.json publishes ${of(kitchenEvm)}`,
      );
    }
  }
  // A CREATE3 row holds the release's whole stack to the row: the Router, the Pot scheme and
  // profile, the engine's gate, and both pot-profile.json files (each pinned by digest).
  if (create3) {
    const pin = SET["kitchen-evm"];
    if (
      kitchenEvm.contracts.router.address !== pin.fixedRouter ||
      kitchenEvm.pot.scheme !== "create3" ||
      kitchenEvm.pot.deployer !== pin.kitchen ||
      kitchenEvm.pot.fixedRouter !== pin.fixedRouter ||
      kitchenEvm.pot.potProxyInitCodeHash !== pin.potProxyInitCodeHash ||
      kitchenEvm.pot.potProfileHash !== pin.potProfileHash ||
      SET["v12-evm"].assets["pot-profile.json"] !== pin.assets["pot-profile.json"]
    ) {
      throw new Error("released CREATE3 stack identities do not match releases.json");
    }
    const gated = engineManifest.gate;
    if (
      gated?.scheme !== kitchenEvm.pot.scheme ||
      gated.kitchen !== pin.kitchen ||
      gated.fixedRouter !== pin.fixedRouter ||
      gated.potProxyInitCodeHash !== pin.potProxyInitCodeHash ||
      gated.potProfileHash !== pin.potProfileHash
    ) {
      throw new Error("released engine gate does not match the Kitchen's CREATE3 profile");
    }
    for (const component of ["v12-evm", "kitchen-evm"]) {
      const tag = `${component}-v${SET[component].version}`;
      const profile = JSON.parse(
        readFileSync(
          fetchReleaseAsset(PINS.find((p) => p.tag === tag && p.asset === "pot-profile.json")),
          "utf8",
        ),
      );
      if (
        profile.profileHash !== pin.potProfileHash ||
        profile.potProxyInitCodeHash !== pin.potProxyInitCodeHash
      ) {
        throw new Error(`${tag}/pot-profile.json does not carry the Kitchen's CREATE3 Pot profile`);
      }
    }
  }
  const json = `${JSON.stringify(deployments, null, 2)}\n`;
  for (const dest of DESTS) later(() => put(resolve(dest, DEPLOYMENTS_DEST), json));
  later(() =>
    console.log(
      `[sync-engine-artifacts] wrote ${DEPLOYMENTS_DEST} — compiler ${COMPILER}: engines ${evm.version}/${svm.version}, kitchens ${kitchenEvm.version}/${kitchenSvm.version}`,
    ),
  );
} catch (e) {
  stop("V12Deployments", e);
}

later(() =>
  console.log(
    `[sync-engine-artifacts] wrote ${Object.keys(RELEASE_ABIS).length} ABIs from ` +
      `${V12_EVM_ABIS.tag}/abis.json, plus IERC20 (declared) and IUniswapV3Pool (@uniswap/v3-core)`,
  ),
);

// `--fetch-v12-engines`: also place the SVM engine binary in the cache, and print every cached path
// as `NAME=<path>`. CI appends these to $GITHUB_ENV so SAUCE_RUST_ENGINE_SO and the runtime-derivation
// step read the same verified, cached bytes this script already fetched — one download, one digest
// check, no second implementation in YAML.
if (process.argv.includes("--fetch-v12-engines")) {
  shipEngines({
    engine: fetchReleaseAsset(V12_SVM),
    engineMainnet: fetchReleaseAsset(V12_SVM_MAINNET),
    wireMainnet: fetchReleaseAsset(V12_ENGINE_WIRE_MAINNET),
    kitchen: fetchReleaseAsset(V12_KITCHEN),
    wire: fetchReleaseAsset(V12_ENGINE_WIRE),
    kitchenIdl: fetchReleaseAsset(V12_KITCHEN_IDL),
    runtimeCreation: runtimeCreationPath,
  });
}

shipAvailable();
writeLegacyArtifacts(legacy);
flush();

// The release's raw assets, digest-pinned, ship under `dist/artifacts/releases/<folder>/`, named for
// the first row of the release set (`ASSETS_FOLDER`): SDK 1.1.0 shipped them there as opt-in
// artifacts, and they stay for whoever reads them by path. They are the same release as the
// top-level artifacts, which are derived from them. Dist only: nothing reads them from `src`.
function shipAvailable() {
  const dist = resolve(SDK_DIR, "dist", "artifacts");
  for (const { path, bytes } of [...available, ...kept]) {
    later(() => put(resolve(dist, path), bytes));
  }
  later(() =>
    console.log(
      `[sync-engine-artifacts] wrote the release's raw assets to dist/artifacts/releases/${ASSETS_FOLDER}` +
        (kept.length === 0
          ? ""
          : `, and the kept ${KEPT_ASSET_FOLDERS.map((folder) => `releases/${folder}`).join(", ")}`),
    ),
  );
}

// The engines the installed compiler's output also runs on mint Pots the SDK still cooks, each on
// its own engine. Their artifacts do not ship: the suites that cook such a Pot read them from
// src/artifacts/legacy/<compiler>/, taken from the public package of the newest row pinning that
// engine (integrity-pinned in releases.json; no credential), and held to that row's digests.
//
// Read and checked before the run writes anything (every file is read here, so a package that lacks
// one refuses here too), then written with everything else.
function readLegacyArtifacts() {
  const wanted = new Map();
  for (const [component, versions] of Object.entries(CURRENT.alsoRunsOn ?? {})) {
    for (const version of versions) {
      const row = [...RELEASE_SETS]
        .reverse()
        .find((r) => r[component].version === version && r.npm);
      if (!row) throw new Error(`no row with a public package pins ${component} ${version}`);
      wanted.set(row.compiler, row);
    }
  }

  return [...wanted.values()].map((row) =>
    row["kitchen-evm"].potProxyInitCodeHash === undefined
      ? legacyFromTopLevelFiles(row)
      : legacyFromRawAssets(row),
  );
}

/**
 * A CREATE2 row's artifacts, as its public package carries them at the top level, each held to the
 * row's identities and digests.
 */
function legacyFromTopLevelFiles(row) {
  const read = publicPackage(row);
  const at = (path) => read(`sdk/dist/artifacts/${path}`);
  const parse = (bytes) => JSON.parse(bytes.toString("utf8"));
  const deployments = parse(at("V12Deployments.json"));
  const gate = parse(at("V12EngineGate.json"));
  const runtime = parse(at("V12RuntimeBytecode.json")).runtimeCreationCode;
  const pot = parse(at("V12Pot.json")).bytecode;
  const checks = {
    "runtime creation code": keccak256(runtime) === row["v12-evm"].assets["runtime.creation.hex"],
    "EVM engine":
      deployments.evm.contracts.engine.address.toLowerCase() ===
      row["v12-evm"].engine.toLowerCase(),
    Kitchen:
      deployments.evm.contracts.kitchen.address.toLowerCase() ===
        row["kitchen-evm"].kitchen.toLowerCase() &&
      gate.kitchen.toLowerCase() === row["kitchen-evm"].kitchen.toLowerCase(),
    "Pot init-code hash": [
      deployments.evm.pot.initCodeHash,
      gate.potInitCodeHash,
      keccak256(pot),
    ].every((h) => h.toLowerCase() === row["kitchen-evm"].potInitCodeHash.toLowerCase()),
    "SVM engine": deployments.svm.programs.engine.programId === row["v12-svm"].engine,
    ...Object.fromEntries(
      ["engine-devnet.so", "engine-mainnet.so"].map((so) => [
        so,
        sha256(at(`svm/${so}`)) === row["v12-svm"].assets[so],
      ]),
    ),
    "kitchen.so": sha256(at("svm/kitchen.so")) === row["kitchen-svm"].assets["kitchen.so"],
    ...Object.fromEntries(
      ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"].map((c) => [
        `${c} version`,
        deployments.releases[c].version === row[c].version,
      ]),
    ),
  };
  const wrong = Object.keys(checks).filter((what) => !checks[what]);
  if (wrong.length) {
    throw new Error(
      `${PUBLIC_PACKAGE}@${row.npm.version} disagrees with releases.json's ${row.compiler} row ` +
        `on: ${wrong.join(", ")}`,
    );
  }
  const files = new Map();
  for (const name of [
    "V12Deployments",
    "V12EngineGate",
    "V12RuntimeBytecode",
    "V12Pot",
    "V12Kitchen",
    "V12KitchenProxy",
    "Router",
    "ISauceRouter",
  ]) {
    files.set(`${name}.json`, at(`${name}.json`));
  }
  for (const so of ["engine-devnet.so", "engine-mainnet.so", "kitchen.so"]) {
    files.set(`svm/${so}`, at(`svm/${so}`));
  }

  return { row, files, from: `${PUBLIC_PACKAGE}@${row.npm.version}` };
}

/**
 * A CREATE3 row's artifacts (EVM only), DERIVED from its raw assets as the default path derives the
 * installed row's: the public package that row pins ships them under `releases/<compiler>/`, each
 * held to the row's digest. The package's top-level files are not used: SDK 1.1.0's tarball carries
 * the 1.3.0 set there. What is derived is held to the row's identities.
 */
function legacyFromRawAssets(row) {
  const read = publicPackage(row);
  const parse = (bytes) => JSON.parse(bytes.toString("utf8"));
  const raw = (component, asset) => {
    const tag = `${component}-v${row[component].version}`;
    const path = `releases/${row.compiler}/${tag}/${asset}`;
    const bytes = read(`sdk/dist/artifacts/${path}`);
    const { hash } = ASSET_FORMATS[asset] ?? DEFAULT_FORMAT;
    const actual = hash(bytes);
    if (actual !== row[component].assets[asset]) {
      throw new Error(
        `${PUBLIC_PACKAGE}@${row.npm.version} carries ${path} hashing to ${actual}, not the ` +
          `${row.compiler} row's ${row[component].assets[asset]}`,
      );
    }

    return bytes;
  };
  const runtime = raw("v12-evm", "runtime.creation.hex").toString("utf8").trim();
  const evm = parse(raw("v12-evm", "addresses.json"));
  const kitchenEvm = parse(raw("kitchen-evm", "addresses.json"));
  const svm = parse(raw("v12-svm", "addresses.json"));
  const kitchenSvm = parse(raw("kitchen-svm", "addresses.json"));
  const abis = parse(raw("kitchen-evm", "abis.json")).contracts ?? {};
  const profiles = ["v12-evm", "kitchen-evm"].map((c) => parse(raw(c, "pot-profile.json")));
  const pin = row["kitchen-evm"];
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const potCreationHash = keccak256(abis.Pot?.bytecode ?? "0x");
  const checks = {
    ...Object.fromEntries(
      [
        ["v12-evm", evm],
        ["kitchen-evm", kitchenEvm],
        ["v12-svm", svm],
        ["kitchen-svm", kitchenSvm],
      ].map(([c, addresses]) => [`${c} version`, addresses.version === row[c].version]),
    ),
    "EVM engine":
      same(evm.contracts?.engine?.address, row["v12-evm"].engine) &&
      same(evm.contracts?.engine?.initCodeHash, keccak256(runtime)),
    Kitchen:
      same(kitchenEvm.contracts?.kitchen?.address, pin.kitchen) &&
      same(kitchenEvm.pot?.deployer, pin.kitchen),
    Router:
      same(kitchenEvm.contracts?.router?.address, kitchenEvm.pot?.fixedRouter) &&
      same(kitchenEvm.pot?.fixedRouter, pin.fixedRouter) &&
      same(kitchenEvm.contracts?.router?.initCodeHash, keccak256(abis.Router?.bytecode ?? "0x")),
    "Pot identity":
      same(kitchenEvm.pot?.potProxyInitCodeHash, pin.potProxyInitCodeHash) &&
      same(kitchenEvm.pot?.potProfileHash, pin.potProfileHash),
    "Pot profiles": profiles.every((profile) => same(profile.profileHash, pin.potProfileHash)),
  };
  const wrong = Object.keys(checks).filter((what) => !checks[what]);
  if (wrong.length) {
    throw new Error(
      `${PUBLIC_PACKAGE}@${row.npm.version} disagrees with releases.json's ${row.compiler} row ` +
        `on: ${wrong.join(", ")}`,
    );
  }

  const pretty = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const files = new Map();
  for (const [name, contract] of Object.entries(RELEASE_ABIS)) {
    files.set(
      `${name}.json`,
      Buffer.from(JSON.stringify({ abi: abis[contract].abi, bytecode: abis[contract].bytecode })),
    );
  }
  files.set("V12RuntimeBytecode.json", pretty({ runtimeCreationCode: runtime }));
  files.set(
    "V12EngineGate.json",
    pretty({
      kitchen: pin.kitchen,
      potInitCodeHash: potCreationHash,
      scheme: "create3",
      fixedRouter: pin.fixedRouter,
      potProxyInitCodeHash: pin.potProxyInitCodeHash,
      potProfileHash: pin.potProfileHash,
    }),
  );
  files.set(
    "V12Deployments.json",
    pretty(
      assembleDeployments({
        compiler: row.compiler,
        evm,
        kitchenEvm,
        svm,
        kitchenSvm,
        potCreationHash,
      }),
    ),
  );

  return {
    row,
    files,
    from: `${PUBLIC_PACKAGE}@${row.npm.version}'s releases/${row.compiler}`,
  };
}

/** Queue each earlier release's folder, replaced whole, behind everything else the run writes. */
function writeLegacyArtifacts(prepared) {
  for (const { row, files, from } of prepared) {
    const dir = resolve(SDK_DIR, "src", "artifacts", "legacy", row.compiler);
    later(() => {
      rmSync(dir, { recursive: true, force: true });
      for (const [path, bytes] of files) put(resolve(dir, path), bytes);
      console.log(
        `[sync-engine-artifacts] wrote the compiler ${row.compiler} release's artifacts to ` +
          `src/artifacts/legacy/${row.compiler} (suites only; not shipped), from ${from}`,
      );
    });
  }
}

/** Ship the digest-verified binaries so they ride in the package (see SVM_DESTS above) — both
 *  clusters plus the kitchen, plus the wire/IDL a local harness reads alongside them — and print
 *  every verified path as `NAME=<path>`. */
function shipEngines({
  engine,
  engineMainnet,
  wireMainnet,
  kitchen,
  wire,
  kitchenIdl,
  runtimeCreation,
}) {
  shipSvmBinary(engine, "engine-devnet.so");
  shipSvmBinary(engineMainnet, "engine-mainnet.so");
  shipSvmBinary(kitchen, "kitchen.so");
  shipSvmBinary(wire, "engine-wire-devnet.json");
  shipSvmBinary(wireMainnet, "engine-wire-mainnet.json");
  shipSvmBinary(kitchenIdl, "kitchen-idl.json");
  later(() => {
    console.log(`[sync-engine-artifacts] shipped SVM engine binaries into ${SVM_DESTS[0]}`);

    console.log(`SAUCE_RUST_ENGINE_SO=${engine}`);
    console.log(`SAUCE_RUST_ENGINE_MAINNET_SO=${engineMainnet}`);
    console.log(`SAUCE_ENGINE_WIRE_MAINNET_JSON=${wireMainnet}`);
    console.log(`SAUCE_KITCHEN_SO=${kitchen}`);
    console.log(`SAUCE_ENGINE_WIRE_JSON=${wire}`);
    console.log(`SAUCE_KITCHEN_IDL_JSON=${kitchenIdl}`);
    console.log(`SAUCE_V12_RUNTIME_CREATION_HEX=${runtimeCreation}`);
  });
}
