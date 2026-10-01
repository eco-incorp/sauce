/**
 * What an intent body's names mean when the body becomes its own program.
 *
 * `Chain(() => { ... }).reward(...)` compiles a body that is not plain token writes as a separate
 * program for the destination. A name the body reads is one of three things there: its own local,
 * a value of the enclosing program captured at run time (spliced into the child's arguments), or a
 * declaration of the file the child carries with it. Getting the first two backwards is the defect
 * this file pins: a destructured local was taken for a capture, so the parent tried to splice a
 * variable that only exists inside the child ("`p` is not a declared variable"), and the child
 * declared a parameter of the same name as its own local ("Identifier 'p' has already been
 * declared").
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { rewriteIntentSugar, type IntentSugarContext } from "../src/routes/intent-sugar.js";
import { requireChain } from "../src/chains/canonical.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
const INTENTS = { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n } as const;

/** A context whose child compile records the source and captures it was handed. */
function recording() {
  const children: { source: string; captures: readonly string[] }[] = [];
  const context: IntentSugarContext = {
    source: BASE,
    chains: new Map([["Arbitrum", ARBITRUM]]),
    definesFor: () =>
      new Map([
        ["USDC", 0x7777777777777777777777777777777777777777n],
        ["RECIPIENT", RECIPIENT],
      ]),
    portalOf: (chain) => ecoRoutesPortal(chain),
    proverFor: (from, to) => ecoRoutesProver(from, to),
    defaults: INTENTS,
    compileChild: (_chain, source, captures) => {
      children.push({ source, captures });
      const sentinel = (i: number) =>
        `5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`;
      return {
        // Each sentinel as the left-padded word a real compact-v1 argument tail carries.
        call: {
          target: "0x4444444444444444444444444444444444444444",
          data: `0x${captures.map((_, i) => `${"00".repeat(12)}${sentinel(i)}`).join("")}`,
          value: 0n,
        },
        captureSentinels: captures.map((_, i) => BigInt(`0x${sentinel(i)}`)),
      };
    },
  };
  return { context, children };
}

/** A program on Base that opens one Arbitrum intent around `body`. */
const intentProgram = (body: string, prelude = "") => `${prelude}function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
${body}
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;

describe("a destructured local of the body is the body's own", () => {
  it.each(["const", "let"])("`%s [p] = ...` is not captured", (keyword) => {
    const { context, children } = recording();
    rewriteIntentSugar(
      intentProgram(`    ${keyword} [p] = abi.decode(ctx.msgData(), ["Uint256"]);
    USDC.transfer(RECIPIENT, p + amount);`),
      context,
    );

    expect(children).toHaveLength(1);
    expect(children[0]!.captures).toEqual(["amount"]);
  });

  it("keeps every name a pattern binds, past a skipped element and from `crypto.findPDA`", () => {
    const { context, children } = recording();
    rewriteIntentSugar(
      intentProgram(`    const [, q] = abi.decode(ctx.msgData(), ["Uint256", "Uint256"]);
    const [vault, bump] = crypto.findPDA(q, [hex\`01\`]);
    USDC.transfer(vault + bump, amount);`),
      context,
    );

    expect(children[0]!.captures).toEqual(["amount"]);
  });

  it.each(["const", "let"])("`%s [p]` compiles on the real path", (keyword) => {
    const out = compileSauceRoute(
      "base",
      intentProgram(`    ${keyword} [p] = abi.decode(ctx.msgData(), ["Uint256"]);
    if (p > 0n) { USDC.transfer(RECIPIENT, p); }`),
      EXECUTION,
      { defines: { RECIPIENT }, intents: INTENTS },
    );

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("still captures an enclosing value the body only reads", () => {
    const { context, children } = recording();
    rewriteIntentSugar(
      intentProgram(`    const [p] = abi.decode(ctx.msgData(), ["Uint256"]);
    if (p > amount) { USDC.transfer(RECIPIENT, amount); }`),
      context,
    );

    expect(children[0]!.captures).toEqual(["amount"]);
  });
});

describe("an intent opened at a script's top level", () => {
  // A script's top-level statements are its entry, so what they declare are the locals an intent
  // there captures, as `main`'s would be.
  const SCRIPT = `const amount = USDC.balanceOf(ctx.self());
const [fee] = abi.decode(ctx.msgData(), ["Uint256"]);
Arbitrum(() => {
  if (amount > fee) { USDC.transfer(RECIPIENT, amount - fee); }
}).reward({ tokens: [{ token: USDC, amount }] });`;

  it("captures the script's locals the body reads", () => {
    const { context, children } = recording();
    rewriteIntentSugar(SCRIPT, context);

    expect(children[0]!.captures).toEqual(["amount", "fee"]);
  });

  it("compiles on the real path", () => {
    const out = compileSauceRoute("base", SCRIPT, EXECUTION, {
      defines: { RECIPIENT },
      intents: INTENTS,
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  // A `const` of a literal is fixed when the file is compiled, so it is not a value the script
  // hands over at run time: the body's program declares it, as it would a module's.
  const WITH_CONSTANT = `const FEE = 30n;\n${SCRIPT.replaceAll("fee", "FEE").replace(
    'const [FEE] = abi.decode(ctx.msgData(), ["Uint256"]);\n',
    "",
  )}`;

  it("carries a top-level `const` of a literal rather than capturing it", () => {
    const { context, children } = recording();
    rewriteIntentSugar(WITH_CONSTANT, context);

    expect(children[0]!.captures).toEqual(["amount"]);
    expect(children[0]!.source).toMatch(/^const FEE = 30n;\n/);
  });

  it("compiles that on the real path", () => {
    const out = compileSauceRoute("base", WITH_CONSTANT, EXECUTION, {
      defines: { RECIPIENT },
      intents: INTENTS,
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
