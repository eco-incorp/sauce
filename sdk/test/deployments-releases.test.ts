/**
 * The compiler/engine pairing: ONE table (`deployments/releases.json`), keyed by exact versions, and
 * the refusal every engine-naming builder applies from it.
 *
 * The pairing runs in both directions. Compiler 2.4.0's EVM output carries `ABI_ENCODE` type lists
 * a v12-evm 1.0.x engine reads as instructions and its SVM output needs v12-svm 1.3.0's untyped
 * stack; 2.3.x output must not reach the new engines either. The SVM ISA revision does not move
 * between them, so nothing but the versions can tell them apart.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { address } from "@solana/kit";
import { getAddress, type Address, type Hex } from "viem";

import {
  assertEngineRunsCompiler,
  engineRunsCompiler,
  sdkCompilerVersion,
  v12DeployedAddresses,
  v12DeployedReleaseSet,
  v12EngineAddress,
  v12OptInReleaseSet,
  v12ReleaseSet,
  v12SvmEngineProgramId,
  V12_RELEASE_SETS,
} from "../src/deployments/index.js";
import { v12Pot } from "../src/evm/engine.js";
import { buildSauceEvmCall } from "../src/routes/sauce-calls.js";
import {
  buildCookAndPayFromAccountInstruction,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
  buildExecuteFromAccountInstruction,
} from "../src/svm/instructions.js";
import { buildCookInstruction } from "../src/svm/kitchen.js";

const SEMVER = /^\d+\.\d+\.\d+$/;

/** The resolved compiler's own manifest (see verify.compile.test.ts for why this walks up). */
function resolvedCompilerVersion(): string {
  let dir = dirname(createRequire(import.meta.url).resolve("sauce-compiler"));
  for (let up = 0; up < 10; up++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === "@eco-incorp/sauce-compiler" && parsed.version) return parsed.version;
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the @eco-incorp/sauce-compiler manifest");
}

const PROGRAM = "0x00" as Hex;
const POT = "0x2222222222222222222222222222222222222222" as Address;

describe("the release table", () => {
  it("keys every row by an exact compiler version, once", () => {
    const compilers = V12_RELEASE_SETS.map((row) => row.compiler);
    for (const version of compilers) expect(version).toMatch(SEMVER);
    expect(new Set(compilers).size).toBe(compilers.length);
  });

  it("names exact versions for all four components in every row", () => {
    for (const row of V12_RELEASE_SETS) {
      for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"] as const) {
        expect([row.compiler, component, row[component].version]).toEqual([
          row.compiler,
          component,
          expect.stringMatching(SEMVER),
        ]);
      }
    }
  });

  it("keeps an engine's version and artifact pins identical across compatible compilers", () => {
    for (const component of ["v12-evm", "v12-svm"] as const) {
      for (const row of V12_RELEASE_SETS) {
        const pin = row[component];
        if (pin.engine === null) continue;
        const key = (engine: string | null) =>
          component === "v12-evm" ? engine?.toLowerCase() : engine;
        for (const other of V12_RELEASE_SETS.filter(
          (other) => key(other[component].engine) === key(pin.engine),
        )) {
          expect(other[component].version).toBe(pin.version);
          expect(other[component].assets).toEqual(pin.assets);
        }
      }
    }
  });

  it("the defaults are the installed compiler's own row", () => {
    expect(sdkCompilerVersion()).toBe(resolvedCompilerVersion());
    const own = v12ReleaseSet(sdkCompilerVersion());
    // Every no-argument form is that row, and no row defers its defaults to another.
    expect(v12ReleaseSet()).toEqual(own);
    expect(v12OptInReleaseSet()).toEqual(own);
    expect(v12DeployedReleaseSet()).toEqual(own);
    expect(V12_RELEASE_SETS.every((row) => row.deployedCompiler === undefined)).toBe(true);
    expect([
      own["v12-evm"].version,
      own["kitchen-evm"].version,
      own["v12-svm"].version,
      own["kitchen-svm"].version,
    ]).toEqual(["1.5.0", "1.5.0", "1.4.1", "1.1.0"]);
    expect(v12EngineAddress().toLowerCase()).toBe(own["v12-evm"].engine?.toLowerCase());
    expect(v12SvmEngineProgramId()).toBe(own["v12-svm"].engine);
    // The synced release is that row's own: versions, Kitchen and Pot identity.
    const { releases, evm } = v12DeployedAddresses();
    for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"] as const) {
      expect([component, releases[component].version]).toEqual([component, own[component].version]);
    }
    expect(own["kitchen-evm"].kitchen?.toLowerCase()).toBe(evm.pot.deployer.toLowerCase());
    expect(own["kitchen-evm"].potProxyInitCodeHash).toBe(evm.pot.potProxyInitCodeHash);
    expect(own["kitchen-evm"].potProfileHash).toBe(evm.pot.potProfileHash);
  });

  it("the installed compiler's output runs on v12-evm 1.3.0 and v12-svm 1.4.0, as alsoRunsOn says", () => {
    expect(sdkCompilerVersion()).toBe(resolvedCompilerVersion());
    const earlier = v12ReleaseSet("2.6.2");
    expect(earlier["v12-evm"].version).toBe("1.3.0");
    expect(earlier["v12-svm"].version).toBe("1.4.0");
    // The solver's engine: eco-solver pins it and cooks through `v12Pot.encodeCook`.
    const solver = getAddress("0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67");
    expect(solver).toBe(getAddress(earlier["v12-evm"].engine!));
    expect(() => v12Pot.encodeCook(solver, "0x00")).not.toThrow();
    expect(engineRunsCompiler("evm", solver)).toBe(true);
    expect(engineRunsCompiler("svm", earlier["v12-svm"].engine!)).toBe(true);
    expect(() =>
      assertEngineRunsCompiler("svm", "53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW"),
    ).not.toThrow();
    // v12-evm 1.2.0 (compiler 2.5.0's) runs none of the installed compiler's output.
    const older = v12ReleaseSet("2.5.0");
    expect(older["v12-evm"].version).toBe("1.2.0");
    expect(engineRunsCompiler("evm", older["v12-evm"].engine!)).toBe(false);
    expect(() => assertEngineRunsCompiler("evm", older["v12-evm"].engine!)).toThrow(
      /runs compiler 2\.5\.0 output/,
    );
    // An engine no row names is one the SDK cannot tell.
    expect(engineRunsCompiler("evm", "0x1111111111111111111111111111111111111111")).toBeUndefined();
    // The other direction: compiler 2.6.2 output does not run on the 1.4.0 engine.
    const engine = v12EngineAddress();
    expect(engineRunsCompiler("evm", engine, "2.6.2")).toBe(false);
    expect(() => assertEngineRunsCompiler("evm", engine, "2.6.2")).toThrow(
      /v12-evm 1\.5\.0, which runs compiler 2\.6\.4 output/,
    );
  });

  it("compiler 2.6.4 names the Router release and the engine built for it; 2.6.3 keeps 1.1.0's", () => {
    const record = v12ReleaseSet("2.6.3");
    const current = v12ReleaseSet("2.6.4");
    const [E0, E1, E2] = [
      getAddress("0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67"),
      getAddress("0x983C102aa6321187877530723dDF6921AB4861a6"),
      getAddress("0x8c3DF550295f0F9975C5F0f3B017fF9982456c4a"),
    ];
    const [R1, R2] = [
      getAddress("0xcc5e707d3c063Faae1e0dAf2C6CBc2Fd076AE759"),
      getAddress("0xBbBaB15200b9031fB7Fd31811Cb62b6F83DF24e6"),
    ];
    // The installed row: v12-evm and kitchen-evm 1.5.0, the Router that answers HyperSwap V3's
    // callback, and the engine built for it.
    expect([current["v12-evm"].version, current["kitchen-evm"].version]).toEqual([
      "1.5.0",
      "1.5.0",
    ]);
    expect(getAddress(current["v12-evm"].engine!)).toBe(E2);
    expect(getAddress(current["kitchen-evm"].fixedRouter!)).toBe(R2);
    // The Kitchen and the Pot are 2.6.3's: only the Router, and so the engine, moved.
    for (const field of ["kitchen", "potProxyInitCodeHash", "potProfileHash"] as const)
      expect([field, current["kitchen-evm"][field]]).toEqual([field, record["kitchen-evm"][field]]);
    expect(current["kitchen-evm"].assets["pot-profile.json"]).toBe(
      record["kitchen-evm"].assets["pot-profile.json"],
    );
    for (const component of ["v12-svm", "kitchen-svm"] as const)
      expect([component, current[component]]).toEqual([component, record[component]]);
    expect(current.alsoRunsOn).toEqual({ "v12-evm": ["1.4.0", "1.3.0"], "v12-svm": ["1.4.0"] });
    // 2.6.3 stays SDK 1.1.0's record: engine 1.4.0 on its Router.
    expect(record["v12-evm"].version).toBe("1.4.0");
    expect(getAddress(record["v12-evm"].engine!)).toBe(E1);
    expect(getAddress(record["kitchen-evm"].fixedRouter!)).toBe(R1);
    expect(record.npm?.version).toBe("1.1.0");
    // 2.6.4's output runs on E1 (the fixed-Router and Shared Pots on R1) and on E0, and 2.6.3's does
    // not run on the new engine.
    for (const compiler of ["2.6.3", "2.6.4"]) {
      expect(() => assertEngineRunsCompiler("evm", E0, compiler)).not.toThrow();
      for (const set of [v12ReleaseSet("2.6.2"), current])
        expect(() =>
          assertEngineRunsCompiler("svm", set["v12-svm"].engine!, compiler),
        ).not.toThrow();
    }
    expect(() => assertEngineRunsCompiler("evm", E1, "2.6.4")).not.toThrow();
    expect(() => assertEngineRunsCompiler("evm", E1, "2.6.3")).not.toThrow();
    expect(() => assertEngineRunsCompiler("evm", E2, "2.6.3")).toThrow(
      /runs compiler 2\.6\.4 output/,
    );
    expect(() => assertEngineRunsCompiler("evm", E2, "2.6.2")).toThrow(
      /which runs compiler 2\.6\.4 output/,
    );
  });

  it("keeps a Kitchen release's legacy init-code hash or CREATE3 profile identity stable", () => {
    const hashOf = new Map<string, string>();
    for (const row of V12_RELEASE_SETS) {
      const pin = row["kitchen-evm"];
      expect([row.compiler, pin.kitchen]).toEqual([
        row.compiler,
        expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      ]);
      const hash = pin.potProfileHash ?? pin.potInitCodeHash;
      expect([row.compiler, hash]).toEqual([
        row.compiler,
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
      ]);
      if (pin.potProfileHash !== undefined) {
        expect(pin.potInitCodeHash).toBeNull();
        expect(pin.potProxyInitCodeHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(pin.fixedRouter).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
      const seen = hashOf.get(pin.version);
      if (seen !== undefined) expect(hash).toBe(seen);
      hashOf.set(pin.version, hash!);
    }
  });

  it("holds every row's Kitchen and Pot init-code hash to its release's addresses.json, where cached", () => {
    // The sync checks the installed row's against its release; an older row's release is checked
    // here wherever a sync (or `--report`) left it in the cache.
    const cache = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.cache");
    const deployed = v12DeployedAddresses();
    let checked = 0;
    for (const row of V12_RELEASE_SETS) {
      const pin = row["kitchen-evm"];
      const tag = join(cache, "sauce-engine-releases", `kitchen-evm-v${pin.version}`);
      const path = [join(tag, "addresses.json"), join(tag, ".report", "addresses.json")].find(
        (candidate) => existsSync(candidate),
      );
      // The public source (`SAUCE_ARTIFACT_SOURCE=npm`) caches no addresses.json: the installed
      // row is then held to the V12Deployments.json the sync wrote, which carries the same three.
      if (path === undefined && pin.version !== deployed.releases["kitchen-evm"].version) continue;
      const published =
        path === undefined
          ? {
              version: deployed.releases["kitchen-evm"].version,
              contracts: { kitchen: { address: deployed.evm.contracts.kitchen.address } },
              pot: {
                initCodeHash: deployed.evm.pot.initCodeHash,
                ...(deployed.evm.pot.potProfileHash === undefined
                  ? {}
                  : { potProfileHash: deployed.evm.pot.potProfileHash }),
              },
            }
          : (JSON.parse(readFileSync(path, "utf8")) as {
              version: string;
              contracts: { kitchen: { address: string } };
              pot: { initCodeHash?: string; potProfileHash?: string };
            });
      expect(published.version).toBe(pin.version);
      expect([pin.version, pin.kitchen?.toLowerCase()]).toEqual([
        pin.version,
        published.contracts.kitchen.address.toLowerCase(),
      ]);
      expect(published.pot.potProfileHash ?? published.pot.initCodeHash).toBe(
        pin.potProfileHash ?? pin.potInitCodeHash,
      );
      checked++;
    }
    // The installed row is always checked: the sync fetched its release or wrote its addresses.
    expect(checked).toBeGreaterThan(0);
  });

  it("refuses a compiler no row pairs with", () => {
    expect(() => v12ReleaseSet("0.0.1")).toThrow(/no v12 release set pairs with compiler 0\.0\.1/);
  });
});

/** Every (row, other row) pair: the engine a row names, and a compiler that is not that row's. */
const crossings = V12_RELEASE_SETS.flatMap((own) =>
  V12_RELEASE_SETS.filter((other) => other.compiler !== own.compiler).map((other) => ({
    own,
    other,
  })),
);

describe("assertEngineRunsCompiler — one table, both directions", () => {
  it("runs each row's compiler on that row's own engines", () => {
    for (const row of V12_RELEASE_SETS) {
      const evm = row["v12-evm"].engine;
      const svm = row["v12-svm"].engine;
      if (evm !== null)
        expect(() => assertEngineRunsCompiler("evm", evm, row.compiler)).not.toThrow();
      if (svm !== null)
        expect(() => assertEngineRunsCompiler("svm", svm, row.compiler)).not.toThrow();
    }
  });

  it("refuses other compilers unless their row names the engine or lists it in alsoRunsOn", () => {
    expect(crossings.length).toBeGreaterThan(0);
    for (const { own, other } of crossings) {
      for (const target of ["evm", "svm"] as const) {
        const component = target === "evm" ? "v12-evm" : "v12-svm";
        const engine = own[component].engine;
        if (engine === null) continue;
        const check = () => assertEngineRunsCompiler(target, engine, other.compiler);
        const runs =
          engine === other[component].engine ||
          other.alsoRunsOn?.[component]?.includes(own[component].version) === true;
        if (runs) expect(check).not.toThrow();
        else
          expect(check).toThrow(`is ${component} ${own[component].version}, which runs compiler`);
      }
    }
  });

  // The two refusals the rollout exists for, named. Each reads its engine from the table, so a row
  // edit that dropped either would fail here rather than let the pairing through.
  it("refuses compiler 2.4.0 output on v12-evm 1.0.1 and on v12-svm 1.2.0", () => {
    const old = v12ReleaseSet("2.3.0");
    expect(old["v12-evm"].version).toBe("1.0.1");
    expect(old["v12-svm"].version).toBe("1.2.0");
    expect(() => assertEngineRunsCompiler("evm", old["v12-evm"].engine!, "2.4.0")).toThrow(
      /Compiler 2\.4\.0 output runs on v12-evm 1\.1\.0/,
    );
    expect(() => assertEngineRunsCompiler("svm", old["v12-svm"].engine!, "2.4.0")).toThrow(
      /Compiler 2\.4\.0 output runs on v12-svm 1\.3\.0/,
    );
  });

  it("refuses compiler 2.3.0 output on v12-evm 1.1.0 and on v12-svm 1.3.0", () => {
    const next = v12ReleaseSet("2.4.0");
    expect(next["v12-evm"].version).toBe("1.1.0");
    expect(next["v12-svm"].version).toBe("1.3.0");
    expect(() => assertEngineRunsCompiler("evm", next["v12-evm"].engine!, "2.3.0")).toThrow(
      /Compiler 2\.3\.0 output runs on v12-evm 1\.0\.1/,
    );
    expect(() => assertEngineRunsCompiler("svm", next["v12-svm"].engine!, "2.3.0")).toThrow(
      /Compiler 2\.3\.0 output runs on v12-svm 1\.2\.0/,
    );
  });

  it.each(["2.6.1", "2.6.2"])(
    "pairs compiler %s only with the released TRY and capped-copy engines",
    (compiler) => {
      const current = v12ReleaseSet(compiler);
      expect(current["v12-evm"].version).toBe("1.3.0");
      expect(current["kitchen-evm"].version).toBe("1.3.0");
      expect(current["v12-svm"].version).toBe("1.4.0");
      expect(current["kitchen-svm"].version).toBe("1.1.0");
      const previous = v12ReleaseSet("2.5.0");
      for (const target of ["evm", "svm"] as const) {
        const component = target === "evm" ? "v12-evm" : "v12-svm";
        expect(() =>
          assertEngineRunsCompiler(target, previous[component].engine!, compiler),
        ).toThrow();
        expect(() =>
          assertEngineRunsCompiler(target, current[component].engine!, "2.5.0"),
        ).toThrow();
      }
    },
  );

  it("compares EVM engines case-insensitively", () => {
    const evm = v12ReleaseSet("2.3.0")["v12-evm"].engine!;
    expect(() => assertEngineRunsCompiler("evm", evm.toLowerCase(), "2.4.0")).toThrow();
    expect(() =>
      assertEngineRunsCompiler("evm", evm.toUpperCase().replace("0X", "0x"), "2.4.0"),
    ).toThrow();
  });

  it("does not refuse an engine no row names — a local deployment", () => {
    expect(() =>
      assertEngineRunsCompiler("evm", "0x1111111111111111111111111111111111111111", "2.4.0"),
    ).not.toThrow();
    expect(() =>
      assertEngineRunsCompiler("svm", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "2.3.0"),
    ).not.toThrow();
  });
});

/** An engine the table names that does not run this SDK's compiler — what every builder refuses. */
const foreign = (component: "v12-evm" | "v12-svm"): string[] =>
  V12_RELEASE_SETS.map((row) => row[component].engine).filter(
    (engine): engine is string =>
      engine !== null &&
      engineRunsCompiler(component === "v12-evm" ? "evm" : "svm", engine) === false,
  );

describe("every builder that names an engine refuses another compiler's", () => {
  it("has an EVM engine of another compiler to refuse", () => {
    expect(foreign("v12-evm").length).toBeGreaterThan(0);
  });

  it("v12Pot.encodeCook and buildSauceEvmCall refuse it, and take this SDK's own", () => {
    for (const engine of foreign("v12-evm")) {
      expect(() => v12Pot.encodeCook(engine as Address, PROGRAM)).toThrow(/runs compiler/);
      expect(() =>
        buildSauceEvmCall({ pot: POT, engine: engine as Address, program: PROGRAM }),
      ).toThrow(/runs compiler/);
    }
    expect(() =>
      buildSauceEvmCall({ pot: POT, engine: v12EngineAddress() as Address, program: PROGRAM }),
    ).not.toThrow();
  });

  it("the SVM engine and Kitchen cook instructions refuse it, and take this SDK's own", () => {
    const kitchen = address("SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot");
    const owner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const cook = (engineProgram: string) =>
      buildCookInstruction({
        kitchen,
        owner,
        engineProgram: address(engineProgram),
        potSalt: new Uint8Array(32),
        pot: owner,
        feeConfig: owner,
        bytecode: new Uint8Array([0]),
        maxExecutionFee: 0n,
      });
    const execute = (programId: string) =>
      buildExecuteFromAccountInstruction({
        programId: address(programId),
        code: owner,
        accounts: [],
      });
    for (const engine of foreign("v12-svm")) {
      expect(() => cook(engine)).toThrow(/runs compiler/);
      expect(() => execute(engine)).toThrow(/runs compiler/);
    }
    expect(() => cook(v12SvmEngineProgramId())).not.toThrow();
    expect(() => execute(v12SvmEngineProgramId())).not.toThrow();
  });

  it("the engine's direct paid cooks refuse it, and take this SDK's own", () => {
    const account = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const payment = { feeConfig: account, feePayer: account, maxExecutionFee: 0n };
    const direct = (engine: string) => [
      () =>
        buildCookAndPayInstruction({
          engineProgram: address(engine),
          bytecode: new Uint8Array([0]),
          ...payment,
        }),
      () =>
        buildCookAndPayFromAccountInstruction({
          engineProgram: address(engine),
          code: account,
          ...payment,
        }),
      () =>
        buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: address(engine),
          code: account,
          expectedSha256: new Uint8Array(32),
          ...payment,
        }),
    ];
    for (const engine of foreign("v12-svm")) {
      for (const build of direct(engine)) expect(build).toThrow(/runs compiler/);
    }
    for (const build of direct(v12SvmEngineProgramId())) expect(build).not.toThrow();
  });
});
