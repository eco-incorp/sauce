/**
 * `Token(addr)` — the DSL's global token WRAPPER, a constructor the extensions manifest gives every
 * program (`extensions.ts`): the address, typed as a token, so a write (`transfer`/`approve`/
 * `transferFrom`) is the `@sauce/token` function of the same name, which has OpenZeppelin
 * `SafeERC20` semantics, and a read the `IERC20` call. A local bound to `Token(addr)` carries the
 * type.
 *
 * What the lowered programs DO on a chain — a standard token, USDT's empty return, a `false`
 * return, no code — is `test/std/token/evm.e2e.test.ts`'s matrix. This file pins the lowering.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPENDER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
/** `approve(address,uint256)` selector — present iff the wrapper lowered to a real ERC20 approve. */
const APPROVE_SELECTOR = "095ea7b3";
/** `allowance(address,address)` — only the SafeERC20 approve reads it, for its zero-first reset. */
const ALLOWANCE_SELECTOR = "dd62ed3e";

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const compileRoute = (body: string) =>
  compileSauceRoute("base", body, { pot: POT, engine: ENGINE });
const bytes = (body: string): number[] => Array.from(compileRoute(body).compiled.bytecode[0]!);

describe("Token(addr) through compileSauceRoute", () => {
  it("reaches the compiler as written: nothing is imported or renamed", () => {
    const program = `const t = Token(${USDC});\nt.approve(${SPENDER}, 5n);\nt.transfer(${SPENDER}, t.balanceOf(${SPENDER}));`;
    expect(compileRoute(program).source).toBe(program);
  });

  it("a write alone needs no IERC20 import", () => {
    expect(compileRoute(`Token(${USDC}).transfer(${SPENDER}, 5n);`).source).not.toContain("IERC20");
  });

  it("Token(addr).approve is the SafeERC20 approve, with forceApprove's allowance read", () => {
    const code = hex(compileRoute(`Token(${USDC}).approve(${SPENDER}, 5n);`).compiled.bytecode[0]!);
    expect(code.includes(APPROVE_SELECTOR)).toBe(true);
    expect(code.includes(ALLOWANCE_SELECTOR)).toBe(true);
  });

  it("compiles the same bytes as a direct @sauce/token call, for every write", () => {
    const writes = [
      ["transfer", `${SPENDER}, 5n`],
      ["approve", `${SPENDER}, 5n`],
      ["transferFrom", `${SPENDER}, ${SPENDER}, 5n`],
    ] as const;
    for (const [write, args] of writes) {
      const library = bytes(
        `import { ${write} } from "@sauce/token";\nfunction main() { ${write}(${USDC}, ${args}); }`,
      );
      expect(bytes(`Token(${USDC}).${write}(${args});`)).toEqual(library);
    }
  });

  it("the binding form compiles the same bytes as the direct chain", () => {
    expect(bytes(`let t = Token(${USDC});\nt.approve(${SPENDER}, 5n);`)).toEqual(
      bytes(`Token(${USDC}).approve(${SPENDER}, 5n);`),
    );
  });

  it("a user's own `transfer`/`approve` is untouched and does not collide", () => {
    const body =
      "function transfer(a) { return a; }\nfunction approve(a) { return a; }\n" +
      `function main() { Token(${USDC}).transfer(${SPENDER}, transfer(5n)); Token(${USDC}).approve(${SPENDER}, approve(6n)); }`;
    expect(bytes(body).length).toBeGreaterThan(0);
  });

  it("the ambient `@sauce/token` openRoute adds does not collide with the aliased import", () => {
    const built = openRoute(
      "base",
      `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);\ntransfer(${USDC}, ${SPENDER}, 1n);`,
      evmOptions(),
    ).reward(0n);
    expect(hex(built.compiled.bytecode[0]!).includes(APPROVE_SELECTOR)).toBe(true);
  });

  it("Token(USDC) resolves its argument through the ambient chain define", () => {
    // `USDC` here is not a literal — it is the chain-scoped ambient define, resolved underneath.
    const built = openRoute(
      "base",
      `Token(USDC).transfer(${BigInt(SPENDER)}n, 5n);`,
      evmOptions(),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("refuses a write whose result is read: it returns nothing", () => {
    expect(() => compileRoute(`const ok = Token(${USDC}).approve(${SPENDER}, 5n);`)).toThrow();
  });

  it("refuses a write with the wrong number of arguments", () => {
    expect(() => compileRoute(`Token(${USDC}).transfer(${SPENDER});`)).toThrow(/transfer/);
    expect(() => compileRoute(`Token(${USDC}, ${SPENDER}).transfer(${SPENDER}, 5n);`)).toThrow();
  });

  it("a program's own `Token` is the program's", () => {
    expect(() =>
      compileRoute(
        `function Token(a: Uint256): Uint256 { return a; }\nfunction main(): Uint256 { return Token(7n); }`,
      ),
    ).not.toThrow();
  });

  it("an svm destination rejects Token(addr) with the EVM-only error", () => {
    expect(() =>
      openRoute("solana", `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);`, {
        execution: { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: "0x3333333333333333333333333333333333333333",
        prover: "0x4444444444444444444444444444444444444444",
        rewardDeadline: 1000n,
      }).reward(0n),
    ).toThrow(/svm/);
  });
});
