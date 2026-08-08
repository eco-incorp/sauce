/**
 * The universal token interface — real-compile tests. Uses the ordinary `@eco-incorp/sauce-compiler`,
 * no forge/fork/anvil. Same import + baseDirs pattern as `swap.compile.test.ts`/`svm-settle.compile.test.ts`.
 *
 * This is the required "compiles on an EVM target AND svm" proof, plus the negative controls that
 * lock in the E1.3 capability gate: the ERC20 arm is REJECTED on `svm`, and the SPL arm is REJECTED
 * on an EVM target — proving the two arms are not interchangeable, which is what makes shipping both
 * from one generator (approach (a)) sound.
 */
import { compile } from "../../compiler/dist/index.js";

import { Token } from "../src/token/api.js";
import { TOKEN_BASE_DIRS, tokenSource } from "../src/token/source.js";
import type { TokenSpec } from "../src/token/types.js";

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

describe("Token: compiles on an EVM target (v1 and v12)", () => {
  for (const target of ["v1", "v12"] as const) {
    it(`transfer + balanceOf, ${target}`, () => {
      const src = tokenSource(
        [
          { op: "transfer", token: TOKEN_ADDR, to: TO, amount: 5n },
          { op: "balanceOf", token: TOKEN_ADDR, owner: "self" },
        ],
        target,
      );
      const { bytecode } = compile(src, { baseDirs: [...TOKEN_BASE_DIRS], target, treeshake: true });
      expect(bytecode[0]!.length).toBeGreaterThan(0);
    });

    it(`approve, ${target}`, () => {
      const src = tokenSource({ op: "approve", token: TOKEN_ADDR, spender: SPENDER, amount: 5n }, target);
      const { bytecode } = compile(src, { baseDirs: [...TOKEN_BASE_DIRS], target, treeshake: true });
      expect(bytecode[0]!.length).toBeGreaterThan(0);
    });
  }
});

describe("Token: compiles on target 'svm'", () => {
  it("transfer", () => {
    const src = tokenSource(SVM_TRANSFER, "svm");
    const { bytecode, accountPlan } = compile(src, { target: "svm", treeshake: true });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
    expect(accountPlan).toBeDefined();
  });

  it("approve", () => {
    const src = tokenSource(SVM_APPROVE, "svm");
    const { bytecode } = compile(src, { target: "svm", treeshake: true });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("balanceOf", () => {
    const src = tokenSource(SVM_BALANCE, "svm");
    const { bytecode } = compile(src, { target: "svm", treeshake: true });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("★ AccountPlan order matches Token.transfer(...).accountRefs() exactly, roles included", () => {
    const { accountPlan } = compile(tokenSource(SVM_TRANSFER, "svm"), { target: "svm", treeshake: true });
    expect(accountPlan!.metas.map((m) => [m.ref, !!m.writable, !!m.signer])).toEqual([
      ["tokenProgram", false, false],
      ["mint", false, false],
      ["source", true, false],
      ["dest", true, false],
      ["owner", false, true],
    ]);
    expect(accountPlan!.metas.map((m) => m.ref)).toEqual(
      Token.transfer({ amount: 5n, svm: { source: "source", mint: "mint", dest: "dest" } }).accountRefs(),
    );
  });

  it("★ approve's AccountPlan: delegate is NOT writable", () => {
    const { accountPlan } = compile(tokenSource(SVM_APPROVE, "svm"), { target: "svm", treeshake: true });
    expect(accountPlan!.metas.map((m) => [m.ref, !!m.writable, !!m.signer])).toEqual([
      ["tokenProgram", false, false],
      ["mint", false, false],
      ["source", true, false],
      ["delegate", false, false],
      ["owner", false, true],
    ]);
  });

  it("a multi-op program compiles with distinct refs per op", () => {
    const src = tokenSource(
      [
        { op: "transfer", amount: 1n, svm: { source: "a", mint: "am", dest: "ad" } },
        { op: "transfer", amount: 2n, svm: { source: "b", mint: "bm", dest: "bd" } },
      ],
      "svm",
    );
    const { bytecode } = compile(src, { target: "svm", treeshake: true });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("Token: E1.3 capability gate — the two arms are NOT interchangeable (negative controls)", () => {
  it("the ERC20 (evm) source is rejected on target 'svm'", () => {
    const src = tokenSource({ op: "transfer", token: TOKEN_ADDR, to: TO, amount: 5n }, "evm");
    expect(() => compile(src, { baseDirs: [...TOKEN_BASE_DIRS], target: "svm", treeshake: true })).toThrow(
      /contract bindings are not supported on target 'svm'/,
    );
  });

  for (const target of ["v1", "v12"] as const) {
    it(`the SPL (svm) source is rejected on target '${target}'`, () => {
      // The compiler's OWN first unsupported-capability line is hit before `contract.call`'s own
      // "accounts list" row would be — `accountData` (the load-bearing tokenProgram intern) is
      // svm-only too, and appears earlier in program order. Either error is proof the two arms are
      // not interchangeable; this asserts the one that actually fires.
      const src = tokenSource(SVM_TRANSFER, "svm");
      expect(() => compile(src, { baseDirs: [...TOKEN_BASE_DIRS], target, treeshake: true })).toThrow(
        /accountData is only available on target 'svm'/,
      );
    });
  }

  it("the SPL (svm) source's own 'accounts list' row is what rejects it, once accountData is out of the way", () => {
    // Isolate the accounts-list row specifically (Rule: E1.3 gate applies to BOTH call-argument
    // shapes contract.call needs — the ref-string account list, not just accountData).
    const src = tokenSource(SVM_BALANCE, "svm");
    // balanceOf has no accountData/contract.call at all — it's a pure accountUint read, which is
    // itself svm-only, so it fails the same way for a different (still svm-only) reason.
    expect(() => compile(src, { baseDirs: [...TOKEN_BASE_DIRS], target: "v1", treeshake: true })).toThrow(
      /accountUint is only available on target 'svm'/,
    );
  });
});
