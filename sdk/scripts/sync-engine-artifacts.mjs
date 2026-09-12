#!/usr/bin/env node
// Produce the Sauce engine artifacts the SDK ships and its tests read, from sources that live
// OUTSIDE `compiler/`. Two provenances, deliberately different:
//
//   1. The v12 EVM runtime — from the eco-incorp/v12 GitHub RELEASE, pinned to an immutable tag
//      and checked against a digest committed here. No Huff toolchain, no submodule fetch, no
//      compile step: the release publishes the exact bytes.
//   2. The contract ABIs — four from the `kitchen-evm` release's `abis.json` (`Router`/`IRouter`/
//      `Pot`/`Kitchen`), a DIFFERENT component from item 1, plus `IERC20` declared below (the
//      ERC-20 standard is
//      OpenZeppelin's, never v12's) and `IUniswapV3Pool` read from `@uniswap/v3-core`. `SauceRouter`
//      and `IStateView` are NOT produced: they came from the engine repo's Solidity tree, which no
//      release ships, so anything that wanted them had to stop (see dev-tools/scripts/deploy.ts).
//
// The artifacts land in sdk/dist/artifacts (shipped to git-URL/tarball consumers) and sdk/src/artifacts
// (gitignored, read by the drift tests). Neither is committed; CI re-runs this script and asserts all
// seven files exist, so a broken generation fails there instead of shipping an empty dir.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
// PINNED BY TAG + DIGEST. A git tag is movable on GitHub, so the tag alone is not a pin — every
// asset is checked against a digest committed HERE, not only against the manifest downloaded beside
// it. That digest is the whole guarantee: bytes that match it ARE the pinned artifact, whichever
// commit produced them.
//
// There is deliberately no commit pin. The components release INDEPENDENTLY, so a shared commit is
// not a property this can rely on — `v12-evm-v0.4.0` came from `dbdda3ff` while `v12-svm-v0.5.0`
// came from `bb65620c`. (All four currently share `0bc085a3`; that is a property of a given
// release run, not something to assert.) Requiring one made a routine per-component
// bump fail as "the tag moved".
//
// To bump: change the tag, run this script, and paste the digest it reports.

const V12_EVM = {
  tag: "v12-evm-v0.6.0",
  asset: "runtime.creation.hex",
  // keccak256 of the creation code, cross-checked against the release manifest's `creationCodeKeccak`.
  digest: "0x1cc79965657f4a4beb8a64a8d1a0f17e6844c16b24cca7f45e27e6a61de4f52e",
  manifestKey: "creationCodeKeccak",
  // The manifest hashes the DECODED creation bytecode, not the hex file's bytes.
  hash: (buf) => keccak256(toBytes(buf.toString("utf8").trim())),
};

// The engine is now built PER CLUSTER — `CHAIN_ID` is compiled in, because Solana exposes no chain
// identifier a program can read — so there is no longer one `engine.so`. Devnet is what the test
// harnesses load; a mainnet consumer takes `engine-mainnet.so` from the same release.
//
// The manifest moved with it: `soSha256` at the top level became an `artifacts` array, so the digest
// is looked up BY ASSET NAME rather than by a fixed key.
const V12_SVM = {
  tag: "v12-svm-v0.7.0",
  asset: "engine-devnet.so",
  digest: "5841c72fa8d78e8b57186fca57eda6e4019c9333f71a07900f214011a1503d21",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The contracts the kitchen component OWNS, as one asset. What the SDK ships under its own names is
// a superset: `IERC20` is the ERC-20 standard (OpenZeppelin's, never v12's) and `IUniswapV3Pool` is
// Uniswap's, so neither appears here and neither should — see ARTIFACTS below.
const V12_EVM_ABIS = {
  tag: "kitchen-evm-v0.2.0",
  asset: "abis.json",
  digest: "63718e4c666c9f6c54a34a121bf24ee96a6b9bb1797bf5b8208d43fdaefbcb23",
  manifestKey: "abis.sha256",
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The kitchen — the Anchor loader that stages bytecode and owns Pots. Fetched rather than vendored:
// a released binary is already pinned by tag + digest here, so a second copy in the tree would be a
// second thing to keep in step.
const V12_KITCHEN = {
  tag: "kitchen-svm-v0.2.0",
  asset: "kitchen.so",
  digest: "f3a051ac3837afae4a46c2cd3904372f3558f07869a00cd6ad932f7574fb9b1b",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The engine's own description of its wire — discriminators, fault codes, memory limits — generated
// from its Rust constants by the same build. It is the ground truth `engine-wire-drift.test.ts`
// checks the SDK's released-engine constants against, so it is pinned exactly like the binary: an
// engine whose wire moved must fail the digest here, not surprise a caller at run time.
const V12_ENGINE_WIRE = {
  tag: "v12-svm-v0.7.0",
  asset: "engine-wire-devnet.json",
  digest: "1bdb8dcda82e96fb7fca0911fdf5d28bcae8c67df1c66471f7f182e988d00fe2",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The kitchen's Anchor IDL — discriminators, PDA seeds, and account layouts. `svm/kitchen.ts`
// transcribes these by hand (Anchor emits no TypeScript the SDK can vendor), which is precisely the
// hand-copying that let BYTECODE_FORMAT_EPOCH rot. Pinned so the drift test can compare against it.
const V12_KITCHEN_IDL = {
  tag: "kitchen-svm-v0.2.0",
  asset: "kitchen-idl.json",
  digest: "3707e4a126e35b37515de77fe31b0f66ded7b08ec17d5cb7aad715b4c2b933d7",
  manifestKey: null,
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

// SDK artifact name -> where its ABI comes from.
//
// The names on the LEFT are the SDK's own and are shipped to consumers, so they do not move; v12
// renamed three of the four (`ISauceRouter` -> `IRouter`, `V12Pot` -> `Pot`, `V12Kitchen` ->
// `Kitchen`; `Router` is unchanged) and that is a remap here rather than a rename downstream.
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
  if (!present) {
    console.error(`[sync-engine-artifacts] ${e.message}`);
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
// No ADDRESSES are fetched or generated here, and that is now a deliberate hold rather than a gap.
//
// Every one of the four releases publishes an `addresses.json`, and it is exactly the shape this
// once wanted: `chainIndependent: true` / `clusterIndependent: true`, each address with its salt and
// derivation, because the deploys are CREATE3 (EVM) and a fixed keypair (SVM). It is the only
// published address source: the per-chain `deployment-kitchen-<chain>.json` the earlier cut of these
// tags carried was replaced by it.
//
// It is not consumed because the rollout is not finished — the current Kitchen has code on base and
// devnet only, so a committed address would resolve on eleven chains where nothing is deployed. See
// `src/deployments/v12.generated.ts`, which is a chain roster for that reason. When the rollout
// lands, `addresses.json` is what to pin: one asset per component, chain-independent, so the roster
// no longer has to be maintained alongside it.

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
  const kitchenPath = fetchReleaseAsset(V12_KITCHEN);
  const wirePath = fetchReleaseAsset(V12_ENGINE_WIRE);
  const kitchenIdlPath = fetchReleaseAsset(V12_KITCHEN_IDL);
  if (!runtimeCreationPath)
    throw new Error("--fetch-v12-engines: the v12 EVM runtime creation code was not fetched");
  console.log(`SAUCE_RUST_ENGINE_SO=${enginePath}`);
  console.log(`SAUCE_KITCHEN_SO=${kitchenPath}`);
  console.log(`SAUCE_ENGINE_WIRE_JSON=${wirePath}`);
  console.log(`SAUCE_KITCHEN_IDL_JSON=${kitchenIdlPath}`);
  console.log(`SAUCE_V12_RUNTIME_CREATION_HEX=${runtimeCreationPath}`);
}
