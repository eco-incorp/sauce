/**
 * An intent body reaches the file it is written in: its functions, imports, interfaces and module
 * constants.
 *
 * A body that is not plain token writes compiles as a program of its own for the destination. It
 * used to be compiled as nothing but `function main(<captures>) { <body> }`, so a call to a helper
 * declared beside `main` failed ("`half` is called but never declared") and so did an imported
 * binding. Constants only reached the body by accident, as captured run-time values. The child
 * program now carries the declarations the body reaches — and those reach — as written, and
 * nothing else.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { rewriteIntentSugar, type IntentSugarContext } from "../src/routes/intent-sugar.js";
import { requireChain } from "../src/chains/canonical.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const OPTIMISM = requireChain("optimism");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
const INTENTS = { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n } as const;

/** A context whose child compile records what it was handed. */
function recording() {
  const children: { source: string; captures: readonly string[] }[] = [];
  const sentinel = (i: number) => `5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`;
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
      return {
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

/** `file` followed by a `main` on Base that opens one Arbitrum intent around `body`. */
const fileWithIntent = (file: string, body: string) => `${file}
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
${body}
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;

/** The one child program `source` lowers to. */
function childOf(source: string) {
  const { context, children } = recording();
  rewriteIntentSugar(source, context);
  expect(children).toHaveLength(1);
  return children[0]!;
}

/** Annotated helpers taking and returning arrays: they cannot be written without annotations. */
const ARRAY_HELPERS = `function doubled(xs: Uint256[]): Uint256[] {
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
`;

describe("the child program carries the file's declarations the body reaches", () => {
  it("a helper function, as written, and not as a capture", () => {
    const child = childOf(
      fileWithIntent(
        "function half(x: Uint256): Uint256 {\n  return x / 2n;\n}\n",
        "    USDC.transfer(RECIPIENT, half(amount));",
      ),
    );

    expect(child.captures).toEqual(["amount"]);
    // The declaration, then `main` around the body exactly as the closure holds it.
    expect(child.source).toBe(
      "function half(x: Uint256): Uint256 {\n  return x / 2n;\n}\n\n" +
        "function main(amount) {\n\n    USDC.transfer(RECIPIENT, half(amount));\n  \n}",
    );
  });

  it("what the helpers reach too, and nothing the body does not reach", () => {
    const child = childOf(
      fileWithIntent(
        `${ARRAY_HELPERS}
function unused(x: Uint256): Uint256 {
  return x;
}
`,
        "    USDC.transfer(RECIPIENT, total(doubled([amount, 1n])));",
      ),
    );

    expect(child.source).toContain("function doubled(xs: Uint256[]): Uint256[] {");
    expect(child.source).toContain("function total(xs: Uint256[]): Uint256 {");
    expect(child.source).not.toContain("function unused");
  });

  it("transitively: a helper that calls another", () => {
    const child = childOf(
      fileWithIntent(
        `function fee(x: Uint256): Uint256 {
  return x / 100n;
}
function net(x: Uint256): Uint256 {
  return x - fee(x);
}
`,
        "    USDC.transfer(RECIPIENT, net(amount));",
      ),
    );

    expect(child.source).toContain("function fee(");
    expect(child.source).toContain("function net(");
  });

  it("the import bindings it uses, and only those", () => {
    const child = childOf(
      fileWithIntent(
        `import ISauceRouter from "./artifacts/ISauceRouter.json";
import { approve, transfer as send, balanceOf } from "@sauce/token";
`,
        "    approve(USDC, RECIPIENT, amount);\n    send(USDC, RECIPIENT, amount);",
      ),
    );

    expect(child.source).toContain('import { approve, transfer as send } from "@sauce/token";');
    expect(child.source).not.toContain("ISauceRouter");
    expect(child.source).not.toContain("balanceOf }");
  });

  it("a default import with its attributes, and a namespace import, as written", () => {
    const child = childOf(
      fileWithIntent(
        `import cfg from "./config.json" with { type: "json" };
import ERC20, { helper } from "./lib.js";
import * as math from "./math.js";
`,
        "    USDC.transfer(RECIPIENT, cfg.fee + math.half(amount));",
      ),
    );

    expect(child.source).toContain('import cfg from "./config.json" with { type: "json" };');
    expect(child.source).toContain('import * as math from "./math.js";');
    // Neither binding of the other import is read, so that line is not carried at all.
    expect(child.source).not.toContain("./lib.js");
  });

  it("a default import beside a named one, each only when read", () => {
    const child = childOf(
      fileWithIntent(
        'import ERC20, { helper, other } from "./lib.js";\n',
        "    USDC.transfer(RECIPIENT, helper(ERC20.at(RECIPIENT).totalSupply()));",
      ),
    );

    expect(child.source).toContain('import ERC20, { helper } from "./lib.js";');
  });

  it("an interface a carried signature names", () => {
    const child = childOf(
      fileWithIntent(
        `interface Leg {
  amount: Uint256;
  to: Address;
}
function legOf(amount: Uint256): Leg {
  return { amount, to: RECIPIENT };
}
`,
        "    const leg = legOf(amount);\n    USDC.transfer(leg.to, leg.amount);",
      ),
    );

    expect(child.source).toContain("interface Leg {");
    expect(child.source).toContain("function legOf(");
  });

  it("a module constant, as a declaration rather than a captured value", () => {
    const child = childOf(
      fileWithIntent(
        "const FEE_BPS = 30n;\n",
        "    USDC.transfer(RECIPIENT, amount - (amount * FEE_BPS) / 10000n);",
      ),
    );

    expect(child.captures).toEqual(["amount"]);
    expect(child.source).toContain("const FEE_BPS = 30n;");
  });

  it("a local of the opening function shadows a file declaration of the same name", () => {
    const child = childOf(`function amount(): Uint256 {
  return 1n;
}
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    if (amount > 0n) { USDC.transfer(RECIPIENT, amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(child.captures).toEqual(["amount"]);
    expect(child.source).not.toContain("function amount");
  });

  it("a module `let` starts the program with the value it has where the intent opens", () => {
    // The reward reads `total` at run time; the body must read the same value, not the `0n` the
    // declaration starts with — and so must a function the body calls.
    const child = childOf(`let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  total = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const out = half() + total;
    if (out > 0n) { USDC.transfer(RECIPIENT, out); }
  }).reward({ tokens: [{ token: USDC, amount: total }] });
}`);

    expect(child.captures).toEqual(["total"]);
    expect(child.source).toContain("let total = 0n;");
    expect(child.source).toMatch(/function main\((\w+)\) \{\ntotal = \1;\n/);
  });

  it("a module `let` only a carried function reads is passed in too", () => {
    const child = childOf(`let scratch = 0n;
function bump(): Uint256 {
  scratch = scratch + 1n;
  return scratch;
}
function main() {
  scratch = 5n;
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    if (bump() > 1n) { USDC.transfer(RECIPIENT, amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(child.captures).toEqual(["amount", "scratch"]);
    expect(child.source).toMatch(/\nscratch = \w+;\n/);
  });

  it("refuses a module `let` the opening function shadows, whose value the body cannot be given", () => {
    const { context } = recording();
    expect(() =>
      rewriteIntentSugar(
        `let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  const total = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    if (half() > 0n) { USDC.transfer(RECIPIENT, total); }
  }).reward({ tokens: [{ token: USDC, amount: total }] });
}`,
        context,
      ),
    ).toThrow(/module variable `total`/);
  });

  it("a helper's own parameters and locals are not references to the file's declarations", () => {
    // `payout` and `fees` below are bindings inside the helpers, not the functions of those names.
    const child = childOf(`function compute(x: Uint256): Uint256 {
  const payout = x * 2n;
  return payout;
}
function fees(): Uint256 {
  return USDT.balanceOf(ctx.self());
}
function net(x: Uint256, fees: Uint256): Uint256 {
  return x - fees;
}
function payout(amount: Uint256): void {
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, net(compute(amount), 1n));
  }).reward({ tokens: [{ token: USDC, amount }] });
}
function main() {
  payout(USDC.balanceOf(ctx.self()) + fees());
}`);

    expect(child.source).toContain("function compute(");
    expect(child.source).toContain("function net(");
    expect(child.source).not.toContain("function fees(");
    expect(child.source).not.toContain("function payout(");
  });

  it("refuses a body that calls the function opening it", () => {
    const source = `function payout(amount: Uint256): void {
  Arbitrum(() => {
    if (amount > 0n) { payout(amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}
function main() {
  payout(USDC.balanceOf(ctx.self()));
}`;
    const { context } = recording();

    expect(() => rewriteIntentSugar(source, context)).toThrow(/calls `payout`, the function/);
  });
});

describe("through the real compile path", () => {
  const compile = (source: string) =>
    compileSauceRoute("base", source, EXECUTION, {
      defines: { RECIPIENT },
      intents: INTENTS,
    });

  it("an annotated helper taking and returning arrays, used from main and from an intent body", () => {
    const out = compile(`${ARRAY_HELPERS}
function main(): void {
  const amount: Uint256 = total(doubled([USDC.balanceOf(ctx.self()), 1n]));
  Arbitrum(() => {
    const parts: Uint256[] = doubled([amount, 2n]);
    if (total(parts) > 0n) { USDC.transfer(RECIPIENT, total(parts)); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // `main` still calls both helpers, so the enclosing program keeps them.
    expect(out.source).toContain("function doubled(");
    expect(out.source).toContain("function total(");
  });

  it("an import the body uses", () => {
    const out = compile(`import { balanceOf } from "@sauce/token";
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const held = balanceOf(USDC, ctx.self());
    if (held > 0n) { USDC.transfer(RECIPIENT, held); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a module `let` handed to the body's program", () => {
    const out = compile(`let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  total = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const out = half() + total;
    if (out > 0n) { USDC.transfer(RECIPIENT, out); }
  }).reward({ tokens: [{ token: USDC, amount: total }] });
}`);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("keeps a moved function's callers whole: a function that stays keeps what it calls", () => {
    // `net` is never called by `main`, but it stays in the enclosing program, and the compiler
    // checks every function there, so `fee` — which the body also calls — must stay too.
    const out = compile(`function fee(x: Uint256): Uint256 {
  return x / 100n;
}
function net(x: Uint256): Uint256 {
  return x - fee(x);
}
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const f = fee(amount);
    if (f > 0n) { USDC.transfer(RECIPIENT, f); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(out.source).toContain("function fee(");
  });

  it("moves a function only the body calls out of the enclosing program", () => {
    // USDT is an Optimism token and not a Base one: compiled for Base, `payout` would name a
    // token Base does not have. It runs only on Optimism, so only Optimism compiles it.
    expect(OPTIMISM.id).toBe(10);
    const out = compile(`function payout(to: Address, value: Uint256): void {
  USDT.transfer(to, value);
}
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Optimism(() => {
    const held = USDT.balanceOf(ctx.self());
    if (held > 0n) { payout(RECIPIENT, held); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`);

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(out.source).not.toContain("function payout");
  });
});
