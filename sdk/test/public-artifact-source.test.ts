import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const table = JSON.parse(readFileSync(join(repo, "sdk/src/deployments/releases.json"), "utf8"));

/** The compiler this checkout has installed, whose row is the SDK's defaults: never a literal, so a
 *  compiler bump needs no edit here. */
const INSTALLED = JSON.parse(
  readFileSync(join(repo, "node_modules/sauce-compiler/package.json"), "utf8"),
).version as string;
/** The row the installed row's `alsoRunsOn` engines come from (`readLegacyArtifacts`): the newest
 *  with a public package that pins them. */
const EARLIER = "2.6.2";
/** The folder the release's raw assets ship in: the first row naming the installed row's four
 *  releases, which is where SDK 1.1.0 put them (`releases/2.6.3/`), whatever compiler is installed. */
const RAW_ASSETS = "2.6.3";
const LEGACY = join(repo, "sdk/src/artifacts/legacy", EARLIER);

/** One component's pin in a row of `releases.json`: only what the fixture reads or changes. */
interface Pin {
  version: string;
  engine?: string | null;
  kitchen?: string;
  assets: Record<string, string>;
}

type Row = {
  compiler: string;
  npm?: { version: string; integrity: string; compiler?: string };
  deployedCompiler?: string;
} & Record<"v12-evm" | "kitchen-evm" | "v12-svm" | "kitchen-svm", Pin>;

const digestOf = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

interface QuoteRouter {
  version: string;
  assets: Record<string, string>;
}

/** Every file under a root's two artifact folders, by path and digest: what a refused run must
 *  leave exactly as it found it. */
function tree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const folder of ["sdk/dist/artifacts", "sdk/src/artifacts"]) {
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files[relative(root, path)] = digestOf(path);
    }
  }

  return files;
}

/**
 * The private release packages' cache, as a sync with the grant leaves it: each asset of the
 * installed row byte for byte as this checkout ships it, and a release manifest for each tag written
 * from the same digests. Nothing is downloaded, so the private path reads only what is here. The
 * quote Router's release is the one thing the checkout does not carry in release form: its abis.json
 * is made from the checkout's own quote Router artifact, and the fixture's table pins that.
 */
function privateCache(root: string, installed: Row, local: { quoteRouter: QuoteRouter }) {
  const cache = join(root, "node_modules/.cache/sauce-engine-releases");
  const dist = join(repo, "sdk/dist/artifacts");
  const json = (path: string) => JSON.parse(readFileSync(join(dist, path), "utf8"));
  const gate = json("V12EngineGate.json");
  for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"] as const) {
    const { version, assets } = installed[component];
    const tag = `${component}-v${version}`;
    mkdirSync(join(cache, tag), { recursive: true });
    for (const asset of Object.keys(assets)) {
      cpSync(join(dist, "releases", RAW_ASSETS, tag, asset), join(cache, tag, asset));
    }
    const manifest =
      component === "v12-evm"
        ? {
            creationCodeKeccak: assets["runtime.creation.hex"],
            gate: {
              scheme: gate.scheme,
              kitchen: gate.kitchen,
              fixedRouter: gate.fixedRouter,
              potProxyInitCodeHash: gate.potProxyInitCodeHash,
              potProfileHash: gate.potProfileHash,
            },
            potProfile: { sha256: assets["pot-profile.json"] },
          }
        : component === "kitchen-evm"
          ? {
              abis: { sha256: assets["abis.json"] },
              potProfile: { sha256: assets["pot-profile.json"] },
            }
          : {
              artifacts: Object.entries(assets)
                .filter(([name]) => name !== "addresses.json")
                .map(([name, sha256]) => ({ name, sha256 })),
            };
    writeFileSync(join(cache, tag, "manifest.json"), JSON.stringify(manifest));
  }

  const quote = json("V12QuoteRouter.json");
  const quoteTag = `kitchen-evm-v${local.quoteRouter.version}`;
  const abis = JSON.stringify({
    contracts: { Router: { abi: quote.abi, bytecode: quote.bytecode } },
  });
  const digest = createHash("sha256").update(abis).digest("hex");
  const { generation: _generation, ...router } =
    json("V12Deployments.json").evm.contracts.quoteRouter;
  mkdirSync(join(cache, quoteTag), { recursive: true });
  writeFileSync(join(cache, quoteTag, "abis.json"), abis);
  writeFileSync(
    join(cache, quoteTag, "manifest.json"),
    JSON.stringify({ abis: { sha256: digest } }),
  );
  const addresses = JSON.stringify({ version: local.quoteRouter.version, contracts: { router } });
  writeFileSync(join(cache, quoteTag, "addresses.json"), addresses);
  local.quoteRouter.assets["abis.json"] = digest;
  local.quoteRouter.assets["addresses.json"] = createHash("sha256").update(addresses).digest("hex");
}

/** The fields of V12Deployments.json a scenario changes. */
interface DeploymentsFile {
  evm: {
    contracts: { router: { address: string }; kitchenImplementation: { address: string } };
    pot: { scheme: string; deployer: string };
  };
  svm: { programs: { kitchen: { programId: string } } };
}

/** The fields of V12EngineGate.json a scenario changes. */
interface GateFile {
  fixedRouter: string;
  scheme: string;
}

/** The field of V12Pot.json a scenario changes. */
interface PotFile {
  abi: object[];
}

/** An address no release names, for an identity a scenario changes. */
const OTHER = "0x0000000000000000000000000000000000000002";
/** A base58 program id no release names (the System program's). */
const OTHER_PROGRAM = "11111111111111111111111111111111";

/**
 * The sync script copied beside a table of its own, the way `SAUCE_ARTIFACT_SOURCE=npm` reads the
 * public package of the version the installed row names — standing in for it with a tarball built
 * from this checkout's own artifacts — and a second tarball for the earlier release's artifacts.
 *
 * The installed row is the target; `source` is a copy of it under another compiler, the row the
 * tarball's table carries (the sync holds the installed row, the source row and the tarball's copy
 * of the source row equal but for `npm` and `compiler`). Only fake versions are used, so no archive
 * shares a cache key with a published one, and a `curl` that only fails stands where the registry
 * would be: a download is a failure of the test.
 */
function fixture(scenario?: string, sourceKind: "npm" | "private" = "npm") {
  const root = mkdtempSync(join(tmpdir(), "sauce-public-source-"));
  const script = join(root, "sdk/scripts/sync-engine-artifacts.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(join(repo, "sdk/scripts/sync-engine-artifacts.mjs"), script);
  mkdirSync(join(root, "node_modules/@uniswap"), { recursive: true });
  for (const name of ["viem", "sauce-compiler", "@uniswap/v3-core"])
    symlinkSync(join(repo, "node_modules", name), join(root, "node_modules", name));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), "#!/bin/sh\nexit 22\n");
  chmodSync(join(bin, "curl"), 0o755);

  const local: { releases: Row[]; quoteRouter: QuoteRouter } = structuredClone(table);
  const installed = local.releases.find((row) => row.compiler === INSTALLED)!;
  const earlier = local.releases.find((row) => row.compiler === EARLIER)!;
  const source = structuredClone(installed);
  source.compiler = "2.6.9";
  delete source.npm;
  local.releases.push(source);

  const pack = (name: string, version: string) => {
    const cache = join(root, "node_modules/.cache/sauce-engine-releases/npm", `sauce-${version}`);
    mkdirSync(cache, { recursive: true });
    const archive = join(cache, "package.tgz");
    execFileSync("tar", ["-czf", archive, "-C", join(root, name), "package"]);

    return `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  };

  // The default tarball: this checkout's artifacts (the installed release, with its raw assets
  // under releases/<compiler>/), its table with the source row, its deployments under the source.
  const contents = join(root, "contents/package/sdk/dist");
  mkdirSync(join(contents, "deployments"), { recursive: true });
  cpSync(join(repo, "sdk/dist/artifacts"), join(contents, "artifacts"), { recursive: true });
  const shipped: { releases: Row[] } = structuredClone(table);
  shipped.releases.push(structuredClone(source));
  writeFileSync(join(contents, "deployments/releases.json"), JSON.stringify(shipped));
  const deploymentsPath = join(contents, "artifacts/V12Deployments.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8"));
  deployments.compiler = source.compiler;
  if (scenario === "derived identity changed")
    deployments.evm.contracts.engine.address = "0x0000000000000000000000000000000000000001";
  writeFileSync(deploymentsPath, JSON.stringify(deployments));
  /** Rewrites one artifact of the tarball as JSON, as the type `T` its caller changes. */
  const rewrite = <T>(name: string, change: (json: T) => void) => {
    const path = join(contents, "artifacts", name);
    const json = JSON.parse(readFileSync(path, "utf8")) as T;
    change(json);
    writeFileSync(path, JSON.stringify(json));
  };
  const deploymentsFile = (change: (json: DeploymentsFile) => void) =>
    rewrite("V12Deployments.json", change);
  const gateFile = (change: (json: GateFile) => void) => rewrite("V12EngineGate.json", change);
  const changed: Record<string, () => void> = {
    "Router changed": () =>
      deploymentsFile((d) => {
        d.evm.contracts.router.address = OTHER;
      }),
    "gate Router changed": () =>
      gateFile((g) => {
        g.fixedRouter = OTHER;
      }),
    "gate scheme changed": () =>
      gateFile((g) => {
        g.scheme = "create2";
      }),
    "Pot scheme changed": () =>
      deploymentsFile((d) => {
        d.evm.pot.scheme = "create2";
      }),
    "Pot deployer changed": () =>
      deploymentsFile((d) => {
        d.evm.pot.deployer = OTHER;
      }),
    // What the checks of the release's identities leave alone: an ABI, a Kitchen implementation and
    // the SVM Kitchen's program, each only read for being there.
    "derived ABI changed": () =>
      rewrite<PotFile>("V12Pot.json", (pot) => {
        pot.abi.push({
          type: "function",
          name: "added",
          inputs: [],
          outputs: [],
          stateMutability: "view",
        });
      }),
    "Kitchen implementation changed": () =>
      deploymentsFile((d) => {
        d.evm.contracts.kitchenImplementation.address = OTHER;
      }),
    "SVM Kitchen program changed": () =>
      deploymentsFile((d) => {
        d.svm.programs.kitchen.programId = OTHER_PROGRAM;
      }),
  };
  changed[scenario ?? ""]?.();
  if (scenario === "asset digest changed") {
    const path = join(contents, "artifacts/V12RuntimeBytecode.json");
    const runtime = JSON.parse(readFileSync(path, "utf8"));
    runtime.runtimeCreationCode = "0x00";
    writeFileSync(path, JSON.stringify(runtime));
  }
  const rawAsset = `releases/${RAW_ASSETS}/v12-evm-v${installed["v12-evm"].version}/runtime.creation.hex`;
  if (scenario === "raw asset changed") {
    writeFileSync(join(contents, "artifacts", rawAsset), "0x00\n");
  }
  const integrity = pack("contents", "0.0.1");
  if (scenario === "no public release pin") delete installed.npm;
  else installed.npm = { version: "0.0.1", compiler: source.compiler, integrity };

  // The earlier release's tarball, so the sync stays offline: the artifacts the sync wrote for it
  // in this checkout, which it took from that release's own public package.
  if (!existsSync(LEGACY)) {
    throw new Error("run `pnpm --filter './sdk' sync-engine-artifacts` first");
  }
  const legacy = join(root, "legacy/package/sdk/dist");
  mkdirSync(join(legacy, "deployments"), { recursive: true });
  cpSync(LEGACY, join(legacy, "artifacts"), { recursive: true });
  writeFileSync(join(legacy, "deployments/releases.json"), JSON.stringify(table));
  if (scenario === "legacy asset changed") {
    appendFileSync(join(legacy, "artifacts/svm/engine-mainnet.so"), Buffer.from([0]));
  }
  earlier.npm = { version: "0.0.2", compiler: "2.6.1", integrity: pack("legacy", "0.0.2") };
  if (scenario === "earlier row without a public version") {
    earlier.npm = { compiler: "2.6.1" } as Row["npm"];
  }
  if (scenario === "deployedCompiler set") installed.deployedCompiler = EARLIER;
  if (sourceKind === "private") privateCache(root, installed, local);

  const registry = join(root, "sdk/src/deployments/releases.json");
  mkdirSync(dirname(registry), { recursive: true });
  const run = () => {
    writeFileSync(registry, JSON.stringify(local));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
    // The public source is asked for by name; the private one is what an unset variable means.
    if (sourceKind === "npm") env.SAUCE_ARTIFACT_SOURCE = "npm";
    else delete env.SAUCE_ARTIFACT_SOURCE;

    return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  };
  const at = (path: string) => join(root, path);
  /** What an earlier sync left: a file in each place a sync writes, with contents no sync writes. */
  const seed = () => {
    for (const path of [
      "sdk/dist/artifacts/V12Deployments.json",
      "sdk/dist/artifacts/V12RuntimeBytecode.json",
      `sdk/dist/artifacts/${rawAsset}`,
      "sdk/src/artifacts/V12Deployments.json",
      `sdk/src/artifacts/legacy/${EARLIER}/V12RuntimeBytecode.json`,
      `sdk/src/artifacts/legacy/${EARLIER}/svm/engine-mainnet.so`,
    ]) {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), `left by an earlier sync: ${path}`);
    }
  };

  return {
    root,
    installed,
    source,
    run,
    seed,
    output: at("sdk/dist/artifacts/V12Deployments.json"),
    rawOutput: at(`sdk/dist/artifacts/${rawAsset}`),
    rawAsset,
    legacyOutput: at(`sdk/src/artifacts/legacy/${EARLIER}`),
    at,
  };
}

describe("public artifacts from an explicitly pinned earlier compiler row", () => {
  it("verifies source provenance and emits the target compiler compatibility metadata", () => {
    const f = fixture();
    try {
      const result = f.run();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(f.output, "utf8")).compiler).toBe(INSTALLED);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // What each refusal says. Most are the sync's own ("refused, nothing written"); a digest of the
  // installed row's raw assets is held first, by the step that reads them, and names the asset.
  it.each([
    ["unknown source", "refused, nothing written"],
    ["source row changed", "refused, nothing written"],
    ["target digest changed", "v12-evm-v1.4.0/runtime.creation.hex digest"],
    ["target ABI digest changed", "kitchen-evm-v1.4.0/abis.json digest"],
    ["asset digest changed", "refused, nothing written"],
    ["derived identity changed", "refused, nothing written"],
  ])("refuses %s before writing artifacts", (scenario, message) => {
    const f = fixture(scenario);
    try {
      if (scenario === "unknown source") f.installed.npm!.compiler = "0.0.0";
      if (scenario === "source row changed") f.source["v12-evm"].version = "0.0.0";
      if (scenario === "target digest changed")
        f.installed["v12-evm"].assets["runtime.creation.hex"] = `0x${"00".repeat(32)}`;
      if (scenario === "target ABI digest changed")
        f.installed["kitchen-evm"].assets["abis.json"] = "00".repeat(32);
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
      expect(existsSync(f.output)).toBe(false);
      expect(existsSync(f.rawOutput)).toBe(false);
      expect(existsSync(f.legacyOutput)).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe("the release's raw assets", () => {
  it("ships the verified assets and the earlier release's artifacts, and moves no default", () => {
    const f = fixture();
    try {
      const result = f.run();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const defaults = JSON.parse(readFileSync(f.output, "utf8"));
      expect(defaults.compiler).toBe(INSTALLED);
      expect(defaults.releases["v12-evm"].version).toBe(f.installed["v12-evm"].version);
      expect(defaults.evm.contracts.engine.address.toLowerCase()).toBe(
        f.installed["v12-evm"].engine!.toLowerCase(),
      );
      // The raw assets ship byte for byte, in the first row's folder (SDK 1.1.0's path), in dist only.
      expect(digestOf(f.rawOutput)).toBe(digestOf(join(repo, "sdk/dist/artifacts", f.rawAsset)));
      expect(readdirSync(join(f.root, "sdk/dist/artifacts/releases"))).toEqual([RAW_ASSETS]);
      expect(existsSync(f.at("sdk/src/artifacts/releases"))).toBe(false);
      // The earlier release's artifacts are written for the suites, src only, and never shipped.
      expect(existsSync(f.at("sdk/dist/artifacts/legacy"))).toBe(false);
      for (const file of ["V12RuntimeBytecode.json", "svm/engine-mainnet.so"]) {
        expect(digestOf(join(f.legacyOutput, file))).toBe(digestOf(join(LEGACY, file)));
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["no public release pin", "names no public @eco-incorp/sauce version"],
    ["raw asset changed", "v12-evm-v1.4.0/runtime.creation.hex digest"],
    ["derived identity changed", "refused, nothing written"],
  ])("refuses %s before writing either set", (scenario, message) => {
    const f = fixture(scenario);
    try {
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
      expect(existsSync(f.output)).toBe(false);
      expect(existsSync(f.rawOutput)).toBe(false);
      expect(existsSync(f.legacyOutput)).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("refuses a row that still sets deployedCompiler, which nothing reads any more", () => {
    const f = fixture("deployedCompiler set");
    try {
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("sets deployedCompiler");
      expect(existsSync(f.output)).toBe(false);
      expect(existsSync(f.rawOutput)).toBe(false);
      expect(existsSync(f.legacyOutput)).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // The earlier releases' artifacts are read and held to their rows before anything is written: a
  // refusal there leaves the default artifacts, the raw assets and the earlier folder as they were,
  // in a tree no sync has filled and in one an earlier sync did, from either source.
  it.each([
    ["npm", false],
    ["npm", true],
    ["private", false],
    ["private", true],
  ] as const)(
    "refuses an earlier release's artifact its row does not pin, changing nothing (%s source, tree synced before: %s)",
    (kind, seeded) => {
      const f = fixture("legacy asset changed", kind);
      try {
        if (seeded) f.seed();
        const before = tree(f.root);
        const result = f.run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `disagrees with releases.json's ${EARLIER} row on: engine-mainnet.so`,
        );
        expect(tree(f.root)).toEqual(before);
        expect(existsSync(f.legacyOutput)).toBe(seeded);
        if (!seeded) {
          expect(existsSync(f.output)).toBe(false);
          expect(existsSync(f.rawOutput)).toBe(false);
        }
        expect(result.stderr).toContain("refused, nothing written");
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );
});

describe("the public source holds the release to its row's identities and to its raw assets", () => {
  // What the private path holds a CREATE3 row's Router, scheme and deployer to, in the gate and in
  // the deployments the tarball carries.
  it.each([
    ["Router changed", "Router"],
    ["gate Router changed", "Router"],
    ["gate scheme changed", "CREATE3 scheme"],
    ["Pot scheme changed", "CREATE3 scheme"],
    ["Pot deployer changed", "CREATE3 scheme"],
  ])("refuses a tarball whose %s, changing nothing", (scenario, what) => {
    const f = fixture(scenario);
    try {
      f.seed();
      const before = tree(f.root);
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `disagrees with releases.json's ${INSTALLED} row on: ${what} — refused, nothing written.`,
      );
      expect(tree(f.root)).toEqual(before);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // The tarball carries the raw abis.json and addresses.json, each held to the row's digest, and
  // what it carries derived from them is held to them: not only to what the row records.
  it.each([
    ["derived ABI changed", "V12Pot.json"],
    ["Kitchen implementation changed", "V12Deployments.json"],
    ["SVM Kitchen program changed", "V12Deployments.json"],
  ])(
    "refuses a derived file its raw assets do not make: %s, changing nothing",
    (scenario, file) => {
      const f = fixture(scenario);
      try {
        f.seed();
        const before = tree(f.root);
        const result = f.run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `carries ${file} that the raw, digest-pinned abis.json and addresses.json it also carries do not make — refused, nothing written.`,
        );
        expect(tree(f.root)).toEqual(before);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );

  it("names the row an earlier release's missing pin belongs to, not the installed one", () => {
    const f = fixture("earlier row without a public version");
    try {
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `releases.json's ${EARLIER} row names no public @eco-incorp/sauce version`,
      );
      expect(result.stderr).not.toContain(`releases.json's ${INSTALLED} row names no public`);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe("the private release packages, read from their cache", () => {
  it("writes the default artifacts, the raw assets and the earlier release's", () => {
    const f = fixture(undefined, "private");
    try {
      const result = f.run();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const defaults = JSON.parse(readFileSync(f.output, "utf8"));
      expect(defaults.compiler).toBe(INSTALLED);
      expect(defaults.evm.contracts.engine.address.toLowerCase()).toBe(
        f.installed["v12-evm"].engine!.toLowerCase(),
      );
      for (const file of ["V12QuoteRouter.json", "V12EngineGate.json", "svm/engine-devnet.so"]) {
        // The SVM binaries ship only under --fetch-v12-engines, which this run does not pass.
        if (file.startsWith("svm/")) continue;
        expect(digestOf(f.at(`sdk/dist/artifacts/${file}`))).toBe(
          digestOf(join(repo, "sdk/dist/artifacts", file)),
        );
      }
      expect(digestOf(f.rawOutput)).toBe(digestOf(join(repo, "sdk/dist/artifacts", f.rawAsset)));
      for (const file of ["V12RuntimeBytecode.json", "svm/engine-mainnet.so"]) {
        expect(digestOf(join(f.legacyOutput, file))).toBe(digestOf(join(LEGACY, file)));
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // A check of the default artifacts that fails late, after the ABIs, the runtime and the gate are
  // assembled: none of them has been written.
  it("refuses a Kitchen its row does not record, changing nothing", () => {
    const f = fixture(undefined, "private");
    try {
      f.seed();
      f.installed["kitchen-evm"].kitchen = "0x0000000000000000000000000000000000000001";
      const before = tree(f.root);
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("releases.json records the kitchen-evm");
      expect(tree(f.root)).toEqual(before);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // The quote Router's own `addresses.json` is pinned by digest like every other release asset the
  // sync reads, and held to it on EVERY read of the cache, not only after a download.
  it("pins the quote Router's addresses.json by digest in the table", () => {
    expect(table.quoteRouter.assets["addresses.json"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a cached quote Router addresses.json its row does not pin, changing nothing", () => {
    const f = fixture(undefined, "private");
    try {
      f.seed();
      const cached = f.at(
        `node_modules/.cache/sauce-engine-releases/kitchen-evm-v${table.quoteRouter.version}/addresses.json`,
      );
      // The same file with another address for the quote Router: it parses, carries the right
      // version and a Router salt of the right generation. All that is wrong with it is that it is
      // not the file the row pins.
      const held = JSON.parse(readFileSync(cached, "utf8"));
      held.contracts.router.address = OTHER;
      writeFileSync(cached, JSON.stringify(held));
      const before = tree(f.root);
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `kitchen-evm-v${table.quoteRouter.version}/addresses.json failed its digest`,
      );
      expect(tree(f.root)).toEqual(before);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
