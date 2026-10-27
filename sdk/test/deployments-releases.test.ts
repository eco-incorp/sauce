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
import type { Address, Hex } from "viem";

import {
  assertEngineRunsCompiler,
  sdkCompilerVersion,
  v12DeployedAddresses,
  v12EngineAddress,
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

  it("the synced artifacts are the row of the compiler that is installed", () => {
    expect(sdkCompilerVersion()).toBe(resolvedCompilerVersion());
    const set = v12ReleaseSet();
    const { releases } = v12DeployedAddresses();
    for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"] as const) {
      expect([component, releases[component].version]).toEqual([component, set[component].version]);
    }
    expect(set["v12-evm"].engine?.toLowerCase()).toBe(v12EngineAddress().toLowerCase());
    expect(set["v12-svm"].engine).toBe(v12SvmEngineProgramId());
    // The Kitchen and Pot init-code hash the row records are the synced release's own.
    const { pot } = v12DeployedAddresses().evm;
    expect(set["kitchen-evm"].kitchen?.toLowerCase()).toBe(pot.deployer.toLowerCase());
    expect(set["kitchen-evm"].potInitCodeHash?.toLowerCase()).toBe(pot.initCodeHash.toLowerCase());
  });

  it("names the Kitchen and the Pot init-code hash of every kitchen-evm release, the same in every row", () => {
    const hashOf = new Map<string, string>();
    for (const row of V12_RELEASE_SETS) {
      const pin = row["kitchen-evm"];
      expect([row.compiler, pin.kitchen]).toEqual([
        row.compiler,
        expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      ]);
      expect([row.compiler, pin.potInitCodeHash]).toEqual([
        row.compiler,
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
      ]);
      // A release mints under one hash, whichever row names it.
      const seen = hashOf.get(pin.version);
      if (seen !== undefined) expect(pin.potInitCodeHash).toBe(seen);
      hashOf.set(pin.version, pin.potInitCodeHash!);
    }
  });

  it("holds every row's Kitchen and Pot init-code hash to its release's addresses.json, where cached", () => {
    // The sync checks the installed row's against its release; an older row's release is checked
    // here wherever a sync (or `--report`) left it in the cache.
    const cache = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.cache");
    let checked = 0;
    for (const row of V12_RELEASE_SETS) {
      const pin = row["kitchen-evm"];
      const tag = join(cache, "sauce-engine-releases", `kitchen-evm-v${pin.version}`);
      const path = [join(tag, "addresses.json"), join(tag, ".report", "addresses.json")].find(
        (candidate) => existsSync(candidate),
      );
      if (path === undefined) continue;
      const published = JSON.parse(readFileSync(path, "utf8")) as {
        version: string;
        contracts: { kitchen: { address: string } };
        pot: { initCodeHash: string };
      };
      expect([pin.version, published.version]).toEqual([pin.version, pin.version]);
      expect([pin.version, pin.kitchen?.toLowerCase()]).toEqual([
        pin.version,
        published.contracts.kitchen.address.toLowerCase(),
      ]);
      expect([pin.version, pin.potInitCodeHash]).toEqual([
        pin.version,
        published.pot.initCodeHash.toLowerCase(),
      ]);
      checked++;
    }
    // The installed row's release is always there: the sync fetched it.
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

  it("refuses other compilers unless their row explicitly shares the engine", () => {
    expect(crossings.length).toBeGreaterThan(0);
    for (const { own, other } of crossings) {
      for (const target of ["evm", "svm"] as const) {
        const component = target === "evm" ? "v12-evm" : "v12-svm";
        const engine = own[component].engine;
        if (engine === null) continue;
        const check = () => assertEngineRunsCompiler(target, engine, other.compiler);
        if (engine === other[component].engine) expect(check).not.toThrow();
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

  it("pairs compiler 2.6.1 only with the released TRY and capped-copy engines", () => {
    const current = v12ReleaseSet("2.6.1");
    expect(current["v12-evm"].version).toBe("1.3.0");
    expect(current["kitchen-evm"].version).toBe("1.3.0");
    expect(current["v12-svm"].version).toBe("1.4.0");
    expect(current["kitchen-svm"].version).toBe("1.1.0");
    const previous = v12ReleaseSet("2.5.0");
    for (const target of ["evm", "svm"] as const) {
      const component = target === "evm" ? "v12-evm" : "v12-svm";
      expect(() =>
        assertEngineRunsCompiler(target, previous[component].engine!, "2.6.1"),
      ).toThrow();
      expect(() => assertEngineRunsCompiler(target, current[component].engine!, "2.5.0")).toThrow();
    }
  });

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

/** An engine the table names for a compiler that is NOT this SDK's — what every builder refuses. */
const foreign = (component: "v12-evm" | "v12-svm"): string[] =>
  V12_RELEASE_SETS.filter((row) => row[component].engine !== v12ReleaseSet()[component].engine)
    .map((row) => row[component].engine)
    .filter((engine): engine is string => engine !== null);

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
