/**
 * `@sauce/token` as the DEFAULT ambient MODULE of a program compile: its exported functions
 * (`approve`, `transfer`, `balanceOf`, ...) are callable in any program with NO import line and NO
 * options, resolved from the SDK's own embedded `std/token`. This is the "ambient MODULE" half --
 * distinct from the "ambient DEFINES" half (`chainDefines`, covered in `routes-ambient.test.ts`).
 */
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const SPENDER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;

const MINT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

describe("@sauce/token as the default ambient module", () => {
  it("approve(USDC, spender, amount) compiles with zero import AND zero opts (default ambient)", () => {
    const built = compileSauceProgram(
      "base",
      `function main() { approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n; }`,
    );
    expect(built.bytecode.length).toBeGreaterThan(0);
  });

  it("the whole function surface is broadcast by default: transfer + balanceOf resolve too", () => {
    const built = compileSauceProgram(
      "base",
      `function main() { transfer(USDC, ${BigInt(SPENDER)}n, 5n); return balanceOf(USDC, ctx.self()); }`,
    );
    expect(built.bytecode.length).toBeGreaterThan(0);
  });

  it("explicitly opting @sauce/token in via compile.ambient is idempotent with the default", () => {
    const body = `function main() { approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n; }`;
    const viaDefault = compileSauceProgram("base", body);
    const viaExplicit = compileSauceProgram("base", body, { ambient: ["@sauce/token"] });
    expect(Array.from(viaDefault.bytecode)).toEqual(Array.from(viaExplicit.bytecode));
  });

  // --- the SVM arm ---
  //
  // `chainAmbient` returns the same list for every chain, so `token.svm.js` is broadcast into an
  // SVM compile too. EVERY export on the SVM arm takes at least one `Account` (`balanceOf(token,
  // account)`, `approve(token, tokenProgram, source, delegate, authority, amount)`), and an
  // `Account` reaches a program only as a `main` parameter with a TYPE ANNOTATION. A route body can
  // carry one since the rewrites parse TypeScript (`routes/parse.ts`), so the arm is called below;
  // executing it is `test/std/token/svm.e2e.test.ts`'s.
  it("calls the SVM arm with zero import, from a body that annotates its Account", () => {
    const built = compileSauceProgram(
      "solana",
      `function main(account: Account): Uint256 { return balanceOf(${BigInt(MINT)}n, account); }`,
    );
    expect(built.bytecode.length).toBeGreaterThan(0);
  });

  // And that the module RESOLVES on an SVM compile even where the call is malformed. The tell is
  // which error comes back.
  it("resolves on an SVM destination: the failure is the malformed call, never a missing module", () => {
    // No annotation, so this reaches the compiler and fails there — on the call, not on the import.
    // `failed to import module "@sauce/token"` is what an unresolvable ambient specifier raises, and
    // it is what this asserts does NOT happen: the SVM arm was found and read.
    let message: string;
    try {
      compileSauceProgram(
        "solana",
        `function main(account) { return balanceOf(${BigInt(MINT)}n, account); }`,
      );
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
      compileSauceProgram("solana", "function main() { return chainId; }", {
        ambient: ["@sauce/definitely-not-a-real-module"],
      }),
    ).toThrow(/failed to import module/);
  });

  it("negative control: a genuinely undeclared name is still a compile error (ambient is not a catch-all)", () => {
    expect(() =>
      compileSauceProgram("base", `function main() { return notARealAmbientName(1n); }`),
    ).toThrow();
  });
});
