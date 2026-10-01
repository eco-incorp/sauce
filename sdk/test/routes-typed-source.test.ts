/**
 * TypeScript-annotated SauceScript through the route compiler.
 *
 * The compiler takes annotations, and needs them: an unannotated parameter is a number, so a helper
 * that takes or returns an array, a record or bytes has to say so. Nothing in the SDK reads the
 * program's text, so an annotation reaches the compiler exactly as written; each case is checked
 * against the compiler, so a program that changed on the way would fail to compile or compile to
 * something else.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;

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
    // What the compiler was given is the program, annotations and all.
    expect(out.source).toBe(source);
  });

  it("compiles to the program the compiler makes of the source with its names written by hand", () => {
    // The one name the chain gives this program is `self`, a read of `@sauce/context`; the rest
    // reaches the compiler byte for byte, annotations included.
    const source = `${HELPERS}
function main(amount: Uint256): Uint256 {
  const parts: Uint256[] = [amount, ctx.timestamp()];
  return total(doubled(parts)) + ctx.balance(self);
}`;
    const routed = compileSauceRoute("base", source, EXECUTION);
    const direct = compileSauceRoute(
      "base",
      `import { self as me } from "@sauce/context";\n${source.replace("(self)", "(me())")}`,
      EXECUTION,
    ).compiled;

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
  });
});
