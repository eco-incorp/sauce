/**
 * `src/embedded/` — the SDK's files served from memory, checked against the files themselves.
 *
 * The SDK reads no filesystem: its standard library, recipe programs and protocol ABI twins are
 * embedded at build time (`scripts/gen-embedded-sources.mjs`), and its engine ABIs are JSON
 * imports. Everything here compares what that serves with what is on disk, and what it COMPILES to
 * with a compile that reads the same files off disk — so a stale embed, a mis-keyed path or a
 * resolution that changes a program's bytes fails here, by name.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  resolveSdkModule,
  resolveSdkPackage,
  SDK_STD_ROOT,
  sdkStdPath,
} from "../src/embedded/resolve.js";
import { depositSource } from "../src/deposit/source.js";
import type { DepositKey } from "../src/deposit/templates.js";
import { chainContracts } from "../src/descriptors/accessors.js";
import type { ContractCall } from "../src/descriptors/call.js";
import { compileWithRs } from "../src/routes/rs-compile.js";
import { swapSource } from "../src/swap/source.js";
import { SwapPoolType } from "../src/swap/types.js";
import { Token } from "../src/token/api.js";
import { compileProgram, SDK_SOURCE_DIRS } from "./helpers";
import { CASES, compileStdToken } from "./std/token/harness.js";

/** jest's cwd is `sdk/`. */
const SRC = resolve(process.cwd(), "src");
const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);
const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(text(bytes) ?? "null");
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("the generated modules", () => {
  it("match the files they embed (`gen-embedded-sources.mjs --check`)", () => {
    expect(() =>
      execFileSync(process.execPath, [resolve("scripts/gen-embedded-sources.mjs"), "--check"], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});

describe("sdkStdPath — which of two same-looking shapes a path is", () => {
  it("takes the absolute entry path resolveSdkPackage hands out", () => {
    expect(sdkStdPath(`${SDK_STD_ROOT}/token/token.evm.js`)).toBe("token/token.evm.js");
  });

  it("takes the compiler's importer-joined form, the root prefixed with '.'", () => {
    expect(sdkStdPath(`.${SDK_STD_ROOT}/token/erc20.abi.json`)).toBe("token/erc20.abi.json");
  });

  it("declines a genuine './rel' from an entry program — that one is the caller's", () => {
    expect(sdkStdPath("./helper.js")).toBeUndefined();
    expect(sdkStdPath("./sub/helper.js")).toBeUndefined();
    expect(sdkStdPath("./artifacts/IERC20.json")).toBeUndefined();
  });

  it("declines a path that climbs out of the root, and anything else", () => {
    expect(sdkStdPath(`${SDK_STD_ROOT}/../../etc/passwd`)).toBeUndefined();
    expect(sdkStdPath("@sauce/token")).toBeUndefined();
    expect(sdkStdPath(SDK_STD_ROOT)).toBeUndefined();
    expect(sdkStdPath("")).toBeUndefined();
  });
});

describe("resolveSdkModule serves what is on disk", () => {
  it("every standard-library file, under the std root", () => {
    const root = join(SRC, "std");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((path) =>
      statSync(join(root, path)).isFile(),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const onDisk = readFileSync(join(root, path), "utf8");
      const served = resolveSdkModule(`${SDK_STD_ROOT}/${path}`);
      if (path.endsWith(".json")) expect(json(served)).toEqual(JSON.parse(onDisk));
      else expect(text(served)).toBe(onDisk);
    }
  });

  it("every protocol ABI twin, at ./protocols/<slug>/<Export>.json", () => {
    const root = join(SRC, "protocols");
    let count = 0;
    for (const slug of readdirSync(root)) {
      if (!statSync(join(root, slug)).isDirectory()) continue;
      for (const file of readdirSync(join(root, slug)).filter((name) => name.endsWith(".json"))) {
        const onDisk = JSON.parse(readFileSync(join(root, slug, file), "utf8"));
        expect(json(resolveSdkModule(`./protocols/${slug}/${file}`))).toEqual(onDisk);
        count++;
      }
    }
    expect(count).toBeGreaterThan(100);
  });

  it("the engine ABIs the SDK's programs import, as synced", () => {
    for (const name of ["IERC20", "ISauceRouter"]) {
      const onDisk = JSON.parse(readFileSync(join(SRC, "artifacts", `${name}.json`), "utf8"));
      expect(json(resolveSdkModule(`./artifacts/${name}.json`))).toEqual(onDisk);
    }
  });

  it("nothing else: a miss is undefined, the compiler's 'nothing here'", () => {
    expect(resolveSdkModule("./artifacts/Router.json")).toBeUndefined();
    expect(resolveSdkModule("./protocols/aave-v3/abis.ts")).toBeUndefined();
    expect(resolveSdkModule("../artifacts/IERC20.json")).toBeUndefined();
    expect(resolveSdkModule(`${SDK_STD_ROOT}/token/token.js`)).toBeUndefined();
    expect(resolveSdkModule("main.js")).toBeUndefined();
  });

  // Dotted segments are applied the way the filesystem join this replaced applied them: a path that
  // stays inside the SDK tree names the file it lands on, and one that climbs out of its root —
  // the tree's, or the standard library's — names nothing, even when it would land on a served key.
  it("applies '..' inside the tree, and declines a path that climbs out of its root", () => {
    const ierc20 = resolveSdkModule("./artifacts/IERC20.json");
    const pool = resolveSdkModule("./protocols/aave-v3/PoolABI.json");
    expect(resolveSdkModule("./protocols/../artifacts/IERC20.json")).toEqual(ierc20);
    expect(resolveSdkModule("./protocols/aave-v3/../aave-v3/PoolABI.json")).toEqual(pool);

    expect(resolveSdkModule("./protocols/../../artifacts/IERC20.json")).toBeUndefined();
    expect(resolveSdkModule("./../artifacts/IERC20.json")).toBeUndefined();
    expect(resolveSdkModule(`${SDK_STD_ROOT}/../artifacts/IERC20.json`)).toBeUndefined();
    expect(resolveSdkModule(`.${SDK_STD_ROOT}/token/../../artifacts/IERC20.json`)).toBeUndefined();
  });

  it("resolveSdkPackage maps @sauce/token to its neutral entry, and declines the rest", () => {
    expect(resolveSdkPackage("@sauce/token")).toBe(`${SDK_STD_ROOT}/token/token.js`);
    expect(resolveSdkPackage("@sauce/other")).toBeUndefined();
    expect(resolveSdkPackage("viem")).toBeUndefined();
  });
});

describe("compiling from memory gives the same bytes as compiling from disk", () => {
  const evm = (source: string): string =>
    hex(compileWithRs({ source, target: "v12" }).bytecode[0]!);
  const fromDisk = (source: string): string =>
    hex(compileProgram(source, { baseDirs: SDK_SOURCE_DIRS }).bytecode[0]!);

  const tokenCases = CASES.flatMap((c) => [
    { method: c.method, target: "evm" as const, entry: c.evm },
    { method: c.method, target: "svm" as const, entry: c.svm },
  ]);
  it.each(tokenCases)("@sauce/token $method on $target", ({ target, entry }) => {
    const fromMemory = compileWithRs({ source: entry, target: target === "evm" ? "v12" : "svm" });
    expect(hex(fromMemory.bytecode[0]!)).toBe(hex(compileStdToken(entry, target).bytecode));
  });

  it("a swap program (./artifacts/ISauceRouter.json, ./artifacts/IERC20.json)", () => {
    const source = swapSource({
      poolType: SwapPoolType.UniV3,
      pool: "0x1111111111111111111111111111111111111111",
      tokenIn: "0x2222222222222222222222222222222222222222",
      tokenOut: "0x3333333333333333333333333333333333333333",
      amountIn: "balance",
    });
    expect(source).toContain("./artifacts/ISauceRouter.json");
    expect(source).toContain("./artifacts/IERC20.json");
    expect(evm(source)).toBe(fromDisk(source));
  });

  it.each<DepositKey>(["aave-v3:supply", "compound-v3:supply", "erc4626:deposit", "lido:wrap"])(
    "a deposit program (%s, a ./protocols/ twin)",
    (key) => {
      const [protocol, action] = key.split(":") as [string, string];
      const source = depositSource({
        protocol,
        action,
        target: "0x1111111111111111111111111111111111111111",
        token: "0x2222222222222222222222222222222222222222",
        amount: 1_000n,
      });
      expect(source).toContain("./protocols/");
      expect(evm(source)).toBe(fromDisk(source));
    },
  );

  it("a token transfer", () => {
    const { source } = Token.transfer({
      token: "0x2222222222222222222222222222222222222222",
      to: "0x3333333333333333333333333333333333333333",
      amount: 5n,
    }).toSauceScript("evm");
    expect(evm(source)).toBe(fromDisk(source));
  });

  it("a registry contract call's toSauceScript()", () => {
    const pool = chainContracts("base").AaveV3.Pool;
    const supply = pool.supply as (...args: unknown[]) => ContractCall;
    const { source } = supply(
      "0x1111111111111111111111111111111111111111",
      100n,
      "0x2222222222222222222222222222222222222222",
      0,
    ).toSauceScript();
    expect(evm(source)).toBe(fromDisk(source));
  });
});
