/**
 * The universal token interface — real-compile tests. Uses the ordinary compiler, no
 * forge/fork/anvil. Same import + baseDirs pattern as `swap.compile.test.ts`/`svm-settle.compile.test.ts`.
 *
 * This is the required "compiles on an EVM target AND svm" proof, plus the negative controls that
 * lock in the E1.3 capability gate: the ERC20 arm is REJECTED on `svm`, and the SPL arm is REJECTED
 * on an EVM target — proving the two arms are not interchangeable, which is what makes shipping both
 * from one generator (approach (a)) sound.
 */
import { Token } from "../src/token/api.js";
import { compile as compileDirect } from "../src/compiler.js";
import { tokenSource } from "../src/token/source.js";
import type { TokenSpec } from "../src/token/types.js";
import { compileSource, SDK_SOURCE_DIRS } from "./helpers";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111" as const;
const TO = "0x2222222222222222222222222222222222222222" as const;
const SPENDER = "0x3333333333333333333333333333333333333333" as const;

const SVM_TRANSFER: TokenSpec = {
  op: "transfer",
  amount: 5n,
  svm: { source: "source", mint: "mint", dest: "dest" },
};
const SVM_APPROVE: TokenSpec = {
  op: "approve",
  amount: 5n,
  svm: { source: "source", mint: "mint", delegate: "delegate" },
};
const SVM_BALANCE: TokenSpec = { op: "balanceOf", svm: { source: "source" } };

/** `main`'s declared slots, as `[name, writable, signer]` — the account manifest's whole content. */
const slots = (
  manifest: { accounts: readonly unknown[] } | undefined,
): [string, boolean, boolean][] =>
  (manifest?.accounts ?? []).flatMap((entry) => {
    const slot = entry as { kind: string; name: string; requires: string };
    if (slot.kind !== "slot") return [];

    return [
      [slot.name, slot.requires.startsWith("writable"), slot.requires.endsWith("signer")] as [
        string,
        boolean,
        boolean,
      ],
    ];
  });

describe("Token: compiles on an EVM target", () => {
  it("transfer + balanceOf", () => {
    const src = tokenSource(
      [
        { op: "transfer", token: TOKEN_ADDR, to: TO, amount: 5n },
        { op: "balanceOf", token: TOKEN_ADDR, owner: "self" },
      ],
      "evm",
    );
    expect(
      compileSource(src, "evm", { baseDirs: SDK_SOURCE_DIRS }).bytecode.length,
    ).toBeGreaterThan(0);
  });

  it("approve", () => {
    const src = tokenSource(
      { op: "approve", token: TOKEN_ADDR, spender: SPENDER, amount: 5n },
      "evm",
    );
    expect(
      compileSource(src, "evm", { baseDirs: SDK_SOURCE_DIRS }).bytecode.length,
    ).toBeGreaterThan(0);
  });

  it("an EVM program declares no account manifest", () => {
    const src = tokenSource(
      { op: "approve", token: TOKEN_ADDR, spender: SPENDER, amount: 5n },
      "evm",
    );
    expect(compileSource(src, "evm", { baseDirs: SDK_SOURCE_DIRS }).manifest).toBeUndefined();
  });
});

describe("Token: compiles on target 'svm'", () => {
  it("transfer", () => {
    const { bytecode, manifest } = compileSource(tokenSource(SVM_TRANSFER, "svm"), "svm");
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest).toBeDefined();
  });

  it("approve", () => {
    expect(compileSource(tokenSource(SVM_APPROVE, "svm"), "svm").bytecode.length).toBeGreaterThan(
      0,
    );
  });

  it("balanceOf", () => {
    expect(compileSource(tokenSource(SVM_BALANCE, "svm"), "svm").bytecode.length).toBeGreaterThan(
      0,
    );
  });

  it("★ manifest order matches Token.transfer(...).accountRefs() exactly, roles included", () => {
    const { manifest } = compileSource(tokenSource(SVM_TRANSFER, "svm"), "svm");
    expect(slots(manifest)).toEqual([
      ["tokenProgram", false, false],
      ["mint", false, false],
      ["source", true, false],
      ["dest", true, false],
      ["owner", false, true],
    ]);
    expect(slots(manifest).map(([name]) => name)).toEqual(
      Token.transfer({
        amount: 5n,
        svm: { source: "source", mint: "mint", dest: "dest" },
      }).accountRefs(),
    );
  });

  it("★ approve's manifest: delegate is NOT writable", () => {
    const { manifest } = compileSource(tokenSource(SVM_APPROVE, "svm"), "svm");
    expect(slots(manifest)).toEqual([
      ["tokenProgram", false, false],
      ["mint", false, false],
      ["source", true, false],
      ["delegate", false, false],
      ["owner", false, true],
    ]);
  });

  it("a multi-op program compiles, sharing one tokenProgram/owner slot across ops", () => {
    const src = tokenSource(
      [
        { op: "transfer", amount: 1n, svm: { source: "a", mint: "am", dest: "ad" } },
        { op: "transfer", amount: 2n, svm: { source: "b", mint: "bm", dest: "bd" } },
      ],
      "svm",
    );
    const { bytecode, manifest } = compileSource(src, "svm");
    expect(bytecode.length).toBeGreaterThan(0);
    expect(slots(manifest).map(([name]) => name)).toEqual([
      "tokenProgram",
      "am",
      "a",
      "ad",
      "owner",
      "bm",
      "b",
      "bd",
    ]);
  });
});

describe("Token: SVM source compiles through the public compiler without route adaptation", () => {
  it.each([SVM_TRANSFER, SVM_APPROVE, SVM_BALANCE])("$op", (spec) => {
    const source = tokenSource(spec, "svm");
    const result = compileDirect({
      target: "svm",
      entry: "main.ts",
      // Deliberately serve the exact generated source: compileSource's ensureVoidMain shim
      // concealed that transfer/approval programs could not be compiled directly by consumers.
      resolve: (path) => (path === "main.ts" ? Buffer.from(source) : undefined),
    });

    expect(result.bytecode.length).toBeGreaterThan(0);
    const expectedNames =
      spec.op === "balanceOf"
        ? ["source"]
        : ["tokenProgram", "mint", "source", spec.op === "transfer" ? "dest" : "delegate", "owner"];
    expect(slots(result.manifest).map(([name]) => name)).toEqual(expectedNames);
  });
});

describe("Token: E1.3 capability gate — the two arms are NOT interchangeable (negative controls)", () => {
  it("the ERC20 (evm) source is rejected on target 'svm'", () => {
    const src = tokenSource({ op: "transfer", token: TOKEN_ADDR, to: TO, amount: 5n }, "evm");
    expect(() => compileSource(src, "svm", { baseDirs: SDK_SOURCE_DIRS })).toThrow(
      /is not available on the svm target/,
    );
  });

  it("the SPL (svm) source is rejected on an EVM target — its account ROLES have no EVM meaning", () => {
    // The role annotation (`Account<Writable>`) is the first svm-only construct in program order,
    // so it is what fires; the `svm.sload`/`svm.call` rows below it are svm-only too.
    const src = tokenSource(SVM_TRANSFER, "svm");
    expect(() => compileSource(src, "evm", { baseDirs: SDK_SOURCE_DIRS })).toThrow(
      /`an Account role` is not available on the evm target/,
    );
  });

  it("the SPL balanceOf source is rejected on an EVM target by its svm.sload read", () => {
    // balanceOf declares a bare `Account` (no role) and does no CPI, so the account read itself is
    // the row that rejects it — the gate holds for the plain-read arm too, not just the CPI arm.
    const src = tokenSource(SVM_BALANCE, "svm");
    expect(() => compileSource(src, "evm", { baseDirs: SDK_SOURCE_DIRS })).toThrow(
      /`svm\.sload` is not available on the evm target/,
    );
  });
});
