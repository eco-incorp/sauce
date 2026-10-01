/**
 * The SDK's rewrites parse TypeScript-annotated SauceScript.
 *
 * The compiler takes annotations, and needs them: an unannotated parameter is a number, so a helper
 * that takes or returns an array, a record or bytes has to say so. The token, protocol and intent
 * rewrites run before the compiler on the same source, and they parsed it as JavaScript, so an
 * annotated program failed in the SDK ("Unexpected token") before the compiler ever saw it.
 *
 * Each case below goes through the rewrite that has to parse it, and is checked against the
 * compiler: a rewrite that mangled an annotation would make the program fail to compile or change
 * what it compiles to.
 */
import { compileWithRs } from "../src/routes/rs-compile.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { requireChain } from "../src/chains/canonical.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const BASE = requireChain("base");

/** Helpers that take and return arrays and records — they cannot be written without annotations. */
const HELPERS = `interface Leg {
  amount: Uint256;
  to: Address;
}

function doubled(xs: Uint256[]): Uint256[] {
  let out: Uint256[] = new Array(xs.length);
  for (let i = 0n; i < xs.length; i++) {
    out[i] = xs[i] * 2n;
  }
  return out;
}

function total(xs: Uint256[]): Uint256 {
  let sum = 0n;
  for (const x of xs) {
    sum += x;
  }
  return sum;
}

function legOf(amount: Uint256, to: Address): Leg {
  return { amount, to };
}
`;

describe("an annotated program compiles through the route compiler", () => {
  it("uses helpers that take and return arrays and records from `main`", () => {
    const source = `${HELPERS}
function main(amount: Uint256, to: Address): void {
  const parts: Uint256[] = [amount, 1n];
  const leg: Leg = legOf(total(doubled(parts)), to);
  require(leg.amount > 0n);
  USDC.transfer(leg.to, leg.amount);
}`;
    const out = compileSauceRoute("base", source, EXECUTION);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // Nothing rewrites it: the compiler reads the token write, annotations and all, as written.
    expect(out.source).toBe(source);
  });

  it("compiles to the program the compiler makes of the source as written", () => {
    // Even the bare `self` is the compiler's to resolve (through the extensions manifest): the
    // source reaches it byte for byte, annotations included.
    const source = `${HELPERS}
function main(amount: Uint256): Uint256 {
  const parts: Uint256[] = [amount, ctx.timestamp()];
  return total(doubled(parts)) + ctx.balance(self);
}`;
    const routed = compileSauceRoute("base", source, EXECUTION);
    const direct = compileWithRs({ source, target: "v12", extensions: { chain: BASE } });

    expect(Array.from(routed.compiled.bytecode[0]!)).toEqual(Array.from(direct.bytecode[0]!));
  });

  it("keeps a trailing comma and a wrapped, annotated parameter list", () => {
    const source = `function main(
  refundTo: Address,
  amount: Uint256,
): void {
  require(amount > 0n);
  USDC.transfer(refundTo, amount);
}`;

    expect(
      compileSauceRoute("base", source, EXECUTION).compiled.bytecode[0]!.length,
    ).toBeGreaterThan(0);
  });

  it("lowers an intent opened in an annotated program", () => {
    const source = `function main(amount: Uint256): void {
  const held: Uint256 = USDC.balanceOf(ctx.self());
  require(held >= amount);
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;
    const out = compileSauceRoute("base", source, EXECUTION, {
      defines: { RECIPIENT },
      intents: { deadline: 4_000_000_000n, creator: "0x3333333333333333333333333333333333333333" },
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(out.source).toContain("function main(amount: Uint256): void {");
  });
});

describe("annotations reach the compiler with the token and protocol syntax around them", () => {
  it("a bound Token in an annotated helper, a token symbol and a protocol call compile as written", () => {
    const annotated = `function pay(token: Address, to: Address, amount: Uint256): void {
  const t = Token(token);
  t.transfer(to, amount);
}
function main(to: Address): Uint256 {
  pay(USDC, to, 1n);
  return Aave.Pool.getUserAccountData(to).totalDebtBase;
}`;
    const out = compileSauceRoute("base", annotated, EXECUTION);
    expect(out.source).toBe(annotated);
    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
