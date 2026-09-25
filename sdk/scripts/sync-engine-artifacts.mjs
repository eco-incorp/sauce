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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  copyFileSync,
} from "node:fs";
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
// not a property this can rely on. Requiring one shared commit made a
// routine per-component bump fail as "the tag moved".
//
// To bump: change the tag, run this script, and paste the digest it reports.

const V12_EVM = {
  tag: "v12-evm-v1.0.1",
  asset: "runtime.creation.hex",
  // keccak256 of the creation code, cross-checked against the release manifest's `creationCodeKeccak`.
  digest: "0xac489233c18aeaacdefc8429dd3b15aa24762ed3b6aac3854dbd457ea5186972",
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
  tag: "v12-svm-v1.2.0",
  asset: "engine-devnet.so",
  digest: "5e9a164ce9163f5a28018526053e9c78359c922671f9480b7eb730f6eef9fa01",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The MAINNET engine and its wire, pinned exactly like devnet's. Both clusters ship from one
// release because `CHAIN_ID` is compiled in — they are genuinely different binaries, and a suite
// that asserts the cluster id has to run each one rather than assume they differ.
const V12_SVM_MAINNET = {
  tag: "v12-svm-v1.2.0",
  asset: "engine-mainnet.so",
  digest: "9ad752e1beb58428d66e99f00d86c24fa1c8744b2de91908ade249a90235caf9",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

const V12_ENGINE_WIRE_MAINNET = {
  tag: "v12-svm-v1.2.0",
  asset: "engine-wire-mainnet.json",
  digest: "f9e47b4329c2cd7bae6a5624a60c48d5fe13404c03fea925048fa0ae7c76168d",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The contracts the kitchen component OWNS, as one asset. What the SDK ships under its own names is
// a superset: `IERC20` is the ERC-20 standard (OpenZeppelin's, never v12's) and `IUniswapV3Pool` is
// Uniswap's, so neither appears here and neither should — see ARTIFACTS below.
const V12_EVM_ABIS = {
  tag: "kitchen-evm-v1.0.0",
  asset: "abis.json",
  digest: "3310065f6f4c752888ffbc351ef40f0d9dcdfbb877b8ee33c851d08bb174f912",
  manifestKey: "abis.sha256",
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The kitchen — the Anchor loader that stages bytecode and owns Pots. Fetched rather than vendored:
// a released binary is already pinned by tag + digest here, so a second copy in the tree would be a
// second thing to keep in step.
const V12_KITCHEN = {
  tag: "kitchen-svm-v1.0.0",
  asset: "kitchen.so",
  digest: "7b6af3c5b52a56567c2617d634b7403566b4aa5d6fb5dacd958430d84a15466f",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The engine's own description of its wire — discriminators, fault codes, memory limits — generated
// from its Rust constants by the same build. It is the ground truth `engine-wire-drift.test.ts`
// checks the SDK's released-engine constants against, so it is pinned exactly like the binary: an
// engine whose wire moved must fail the digest here, not surprise a caller at run time.
const V12_ENGINE_WIRE = {
  tag: "v12-svm-v1.2.0",
  asset: "engine-wire-devnet.json",
  digest: "316b7ea4e63d030396a475f55f76a2b46aceaac82186def44d80b6752b6fcdad",
  manifestKey: null,
  hash: (buf) => createHash("sha256").update(buf).digest("hex"),
};

// The kitchen's Anchor IDL — discriminators, PDA seeds, and account layouts. `svm/kitchen.ts`
// transcribes these by hand (Anchor emits no TypeScript the SDK can vendor), which is precisely the
// hand-copying that let BYTECODE_FORMAT_EPOCH rot. Pinned so the drift test can compare against it.
const V12_KITCHEN_IDL = {
  tag: "kitchen-svm-v1.0.0",
  asset: "kitchen-idl.json",
  digest: "17d07f64d849ec67a40c5633f58530d84af33e8918300b196b8148728517aab5",
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
const GATE_DEST = "V12EngineGate.json";
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
// The GATE ANCHORS, which a test harness cannot work without.
//
// The released engine runs only when `CREATE2(KITCHEN, gateSalt(potId), POT_INITCODEHASH)` lands on
// its caller, and both constants are baked into the artifact at release time. A harness therefore
// has to stand up a Kitchen at exactly that address, minting Pots whose init code hashes to exactly
// that hash — so it needs all three of these, and none of them can be guessed.
//
// `kitchen` and `potInitCodeHash` come from the engine release's own manifest (`gate`), already
// fetched and cross-checked above. `router` comes from the kitchen release's `addresses.json`: it is
// the Kitchen's constructor argument, and it is what makes `potInitCodeHash` come out right. Nothing
// here authenticates the router on its own — the harness asserts the deployed Kitchen's live
// `potInitCodeHash()` against the pinned one, which fails loudly if it is wrong.
try {
  const manifest = JSON.parse(
    readFileSync(resolve(CACHE_ROOT, V12_EVM.tag, "manifest.json"), "utf8"),
  );
  const addressesPath = resolve(CACHE_ROOT, V12_EVM_ABIS.tag, "addresses.json");
  if (!existsSync(addressesPath)) download(V12_EVM_ABIS.tag, "addresses.json", addressesPath);
  const addresses = JSON.parse(readFileSync(addressesPath, "utf8"));
  const gate = {
    kitchen: manifest.gate?.kitchen,
    potInitCodeHash: manifest.gate?.potInitCodeHash,
    router: addresses.contracts?.router?.address,
  };
  if (Object.values(gate).some((value) => value === undefined)) {
    throw new Error(`incomplete gate anchors: ${JSON.stringify(gate)}`);
  }
  const json = `${JSON.stringify(gate, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, GATE_DEST), json);
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, GATE_DEST)));
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
// These are ADDRESSES (deterministic, always resolvable), NOT liveness. The deployed Kitchen does not
// have code on every chain yet. The legacy chain roster does not attest that these pinned release
// versions are deployed. addresses.json carries no digest in the manifest (unlike the
// bytecode), so a moved tag is caught two other ways: the version baked into each addresses.json must
// match its tag, and the EVM Kitchen must equal the engine gate's own Kitchen (the harness in turn
// re-verifies that Kitchen against the live `potInitCodeHash()`).
const DEPLOYMENTS_DEST = "V12Deployments.json";
const tagVersion = (tag) => tag.replace(/^.*-v(?=\d)/, "");
const addressesFor = (tag) => {
  const dir = resolve(CACHE_ROOT, tag);
  const path = resolve(dir, "addresses.json");
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    download(tag, "addresses.json", path);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.version !== tagVersion(tag)) {
    throw new Error(
      `${tag}/addresses.json version ${parsed.version} != tag version ${tagVersion(tag)} — the tag moved`,
    );
  }
  return parsed;
};
try {
  const evm = addressesFor(V12_EVM.tag); // engine
  const kitchenEvm = addressesFor(V12_EVM_ABIS.tag); // router + kitchen + kitchenImplementation + pot
  const svm = addressesFor(V12_SVM.tag); // engine program
  const kitchenSvm = addressesFor(V12_KITCHEN.tag); // kitchen program
  const deployments = {
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
  const json = `${JSON.stringify(deployments, null, 2)}\n`;
  for (const dest of DESTS) writeFileSync(resolve(dest, DEPLOYMENTS_DEST), json);
  console.log(
    `[sync-engine-artifacts] wrote ${DEPLOYMENTS_DEST} — release addresses: engines ${evm.version}/${svm.version}, kitchens ${kitchenEvm.version}/${kitchenSvm.version}`,
  );
} catch (e) {
  const present = DESTS.every((d) => existsSync(resolve(d, DEPLOYMENTS_DEST)));
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
