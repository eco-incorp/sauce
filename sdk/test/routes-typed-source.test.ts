/**
 * The SDK's rewrites parse TypeScript-annotated SauceScript.
 *
 * The compiler takes annotations, and needs them: an unannotated parameter is a number, so a helper
 * that takes or returns an array, a record or bytes has to say so. The token and protocol rewrites
 * run before the compiler on the same source, and they parsed it as JavaScript, so an
 * annotated program failed in the SDK ("Unexpected token") before the compiler ever saw it.
 *
 * Each case below goes through the rewrite that has to parse it, and is checked against the
 * compiler: a rewrite that mangled an annotation would make the program fail to compile or change
 * what it compiles to.
 */
import { compileWithRs } from "../src/routes/rs-compile.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { rewriteTokenFactory, rewriteTokenMembers } from "../src/routes/token-rewrite.js";
import { requireChain } from "../src/chains/canonical.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
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
    // The token write was rewritten and the annotations were left exactly where they were.
    expect(out.source).toContain("__sauce_transfer(USDC, leg.to, leg.amount)");
    expect(out.source).toContain("function doubled(xs: Uint256[]): Uint256[] {");
    expect(out.source).toContain("const leg: Leg = legOf(");
  });

  it("compiles to the program the compiler makes of the source with the rewrite done by hand", () => {
    // The only rewrite here is the protocol pass's bare `pot`; the rest must reach the compiler
    // byte for byte, annotations included.
    const source = `${HELPERS}
function main(amount: Uint256): Uint256 {
  const parts: Uint256[] = [amount, ctx.timestamp()];
  return total(doubled(parts)) + ctx.balance(pot);
}`;
    const routed = compileSauceRoute("base", source, EXECUTION);
    const direct = compileWithRs({
      source: source.replace("(pot)", "(ctx.self())"),
      target: "v12",
    });

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
});

describe("each rewrite parses annotations on its own", () => {
  const annotated = `function pay(token: Address, to: Address, amount: Uint256): void {
  const t = Token(token);
  t.transfer(to, amount);
}
function main(to: Address): Uint256 {
  pay(USDC, to, 1n);
  return Aave.Pool.getUserAccountData(to).totalDebtBase;
}`;

  it("the token-member pass", () => {
    const usdc = registryTokenAddress(BASE, "USDC")!;
    const out = rewriteTokenMembers(
      `function main(to: Address): Uint256 { return USDC.balanceOf(to); }`,
      new Map([["USDC", usdc]]),
    );
    expect(out.source).toBe(
      "function main(to: Address): Uint256 { return IERC20.at(USDC).balanceOf(to); }",
    );
  });

  it("the Token(addr) pass", () => {
    const out = rewriteTokenFactory(annotated);
    expect(out.source).toContain(
      "function pay(token: Address, to: Address, amount: Uint256): void {",
    );
    expect(out.source).toContain("const t = token;");
    expect(out.source).toContain("__sauce_transfer(t, to, amount)");
  });

  it("the protocol-accessor pass", () => {
    const out = rewriteProtocolAccessors(annotated, BASE);
    expect(out.accessorSites).toBe(1);
    expect(out.source).toContain("function main(to: Address): Uint256 {");
  });

  it("reads an annotated parameter as the binding it is", () => {
    // `pot` as an annotated parameter is a declaration, so the whole-program shadow rule leaves
    // every `pot` alone, exactly as it does for an unannotated one.
    const out = rewriteProtocolAccessors(
      "function f(pot: Address): Address { return pot; }\nfunction main(): Address { return f(pot); }",
      BASE,
    );
    expect(out.source).toBe(
      "function f(pot: Address): Address { return pot; }\nfunction main(): Address { return f(pot); }",
    );
  });

  it("still reports a syntax error as one", () => {
    expect(() => rewriteProtocolAccessors("function main( { }", BASE)).toThrow(SyntaxError);
  });
});
