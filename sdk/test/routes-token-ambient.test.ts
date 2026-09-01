/**
 * `@sauce/token` as an AMBIENT MODULE on the route path: its exported functions (`approve`,
 * `transfer`, `balanceOf`, ...) become callable in a route body with NO import line, resolved from
 * the SDK's own vendored `src/std/token` copy via `rs-compile.ts`'s `SDK_STD_PACKAGES` override
 * (never a `node_modules` install). This is the "ambient MODULE" half of the DSL -- distinct from
 * the "ambient DEFINES" half (`chainDefines`, covered in `routes-ambient.test.ts`).
 *
 * NOTE: the compiler's M1 subset rejects a method call on a call result (`Token(addr).approve(...)`),
 * so this surface is the FUNCTION form (`approve(token, spender, amount)`), not a `Token(addr)`
 * wrapper -- see this PR's description for the compiler feature the wrapper is gated on.
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

describe("@sauce/token ambient module on the route path", () => {
  it("approve(USDC, spender, amount) compiles with zero import when @sauce/token is ambient", () => {
    const built = openRoute(
      "base",
      `approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n;`,
      evmOptions({ compile: { ambient: ["@sauce/token"] } }),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("the ambient function surface is broadcast, not just approve: transfer + balanceOf resolve too", () => {
    const built = openRoute(
      "base",
      `transfer(USDC, ${BigInt(SPENDER)}n, 5n); return balanceOf(USDC, ctx.self());`,
      evmOptions({ compile: { ambient: ["@sauce/token"] } }),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("without the ambient module, the same bare `approve(...)` is an undeclared name -> compile error", () => {
    expect(() =>
      openRoute("base", `approve(USDC, ${BigInt(SPENDER)}n, 5n); return 0n;`, evmOptions()).reward(0n),
    ).toThrow();
  });
});
