/**
 * `@sauce/token` as the DEFAULT ambient MODULE on the route path: its exported functions (`approve`,
 * `transfer`, `balanceOf`, ...) are callable in ANY route body with NO import line and NO opts,
 * resolved from the SDK's own vendored `std/token` copy via `rs-compile.ts`'s `SDK_STD_PACKAGES`
 * (never a `node_modules` install). This is the "ambient MODULE" half of the DSL -- distinct from
 * the "ambient DEFINES" half (`chainDefines`, covered in `routes-ambient.test.ts`).
 *
 * This file covers the FUNCTION form (`approve(token, spender, amount)`), which the ambient module
 * exports directly. The `Token(addr).approve(...)` WRAPPER is a separate mechanism with its own
 * suite (`routes-token-factory.test.ts`): a textual rewrite to `IERC20.at(addr)` that runs before
 * the compiler, so it needs no compiler feature even though the M1 subset rejects a method call on
 * a call result.
 */
import { openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const SPENDER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

const SVM_BUFFER = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as const;
const MINT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

function svmOptions(): IntentOptions {
  return {
    execution: { buffer: SVM_BUFFER, accounts: [] },
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
  } as IntentOptions;
}

describe("@sauce/token as the default ambient module", () => {
  it("approve(USDC, spender, amount) compiles with zero import AND zero opts (default ambient)", () => {
    const built = openRoute(
      "base",
      `approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n;`,
      evmOptions(),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("the whole function surface is broadcast by default: transfer + balanceOf resolve too", () => {
    const built = openRoute(
      "base",
      `transfer(USDC, ${BigInt(SPENDER)}n, 5n); return balanceOf(USDC, ctx.self());`,
      evmOptions(),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("explicitly opting @sauce/token in via compile.ambient is idempotent with the default", () => {
    const body = `approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n;`;
    const viaDefault = openRoute("base", body, evmOptions()).reward(0n);
    const viaExplicit = openRoute(
      "base",
      body,
      evmOptions({ compile: { ambient: ["@sauce/token"] } }),
    ).reward(0n);
    expect(Array.from(viaDefault.compiled.bytecode[0]!)).toEqual(
      Array.from(viaExplicit.compiled.bytecode[0]!),
    );
  });

  // --- the SVM arm ---
  //
  // `chainAmbient` returns the same list for every chain, so `token.svm.js` is broadcast into an
  // SVM compile too. It cannot be exercised the way the EVM cases above are: EVERY export on the
  // SVM arm takes at least one `Account` (`balanceOf(token, account)`, `approve(token,
  // tokenProgram, source, delegate, authority, amount)`), an `Account` reaches a program only as a
  // `main` parameter, and a parameter needs a TYPE ANNOTATION — which an `openRoute` body cannot
  // carry, because the rewrite passes parse it with acorn as plain JS. That is pre-existing and not
  // specific to svm (an annotated body is a SyntaxError on an EVM destination too), so the SPL
  // execution path is covered by `test/std/token/svm.e2e.test.ts`, which compiles an explicit
  // `import { balanceOf } from "@sauce/token"` entry instead.
  //
  // What IS checkable here is the thing this file is about: that the module RESOLVES on an SVM
  // compile. The tell is which error comes back.
  it("resolves on an SVM destination: the failure is the malformed call, never a missing module", () => {
    // No annotation, so this reaches the compiler and fails there — on the call, not on the import.
    // `failed to import module "@sauce/token"` is what an unresolvable ambient specifier raises, and
    // it is what this asserts does NOT happen: the SVM arm was found and read.
    let message: string;
    try {
      openRoute(
        "solana",
        `function main(account) { return balanceOf(${BigInt(MINT)}n, account); }`,
        svmOptions(),
      ).reward(0n);
      throw new Error("expected the malformed call to fail the compile");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toMatch(/failed to import module/);
    expect(message).toMatch(/compil/i);
  });

  it("negative control: an ambient specifier that does NOT resolve raises exactly that error on svm", () => {
    // The other side of the assertion above — proves `failed to import module` is reachable on this
    // path at all, so the `not.toMatch` is a real check rather than a string that never appears.
    expect(() =>
      openRoute("solana", "return chainId;", {
        ...svmOptions(),
        compile: { ambient: ["@sauce/definitely-not-a-real-module"] },
      }).reward(0n),
    ).toThrow(/failed to import module/);
  });

  it("negative control: a genuinely undeclared name is still a compile error (ambient is not a catch-all)", () => {
    expect(() =>
      openRoute("base", `return notARealAmbientName(1n);`, evmOptions()).reward(0n),
    ).toThrow();
  });
});
