/**
 * What an intent body's names mean when the body is a program of its own.
 *
 * `Chain(() => { ... }).reward(...)` with a body that is not plain token writes compiles that body
 * as a program for the destination — the compiler's program argument, in the destination's scope.
 * A name the body reads is one of: its own local; a value of the enclosing program, carried in as
 * an entry argument (a capture); or a declaration of the file — a function, an import, an
 * interface, a constant — which the body's program has as the file does, compiled only where the
 * body reaches it. A module `let` the body reads is a capture too: it starts from the value it has
 * where the intent opens.
 *
 * Each case reads the captures of the body's program from the compile's own report, as `bind`
 * receives it (`src/routes/intent-host.ts`).
 */
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
const realIntents = await import("../src/routes/intent-host.js");
/** The captures of each body program bound since the last `compileBody`, in bind order. */
let bodies: (readonly string[])[] = [];
jest.unstable_mockModule("../src/routes/intent-host.js", () => ({
  ...realIntents,
  intentHost: (level: Parameters<typeof realIntents.intentHost>[0]) => {
    const host = realIntents.intentHost(level);
    return {
      ...host,
      bind: (site: Parameters<typeof host.bind>[0]) => {
        const receiver = site.receiver;
        const body =
          receiver !== undefined && "fields" in receiver ? receiver.fields[0]?.[1] : undefined;
        if (body !== undefined && "program" in body) {
          bodies.push(body.program.captures.map((capture) => capture.name));
        }
        return host.bind(site);
      },
    };
  },
}));
const { compileSauceProgram } = await import("../src/routes/sauce-route.js");

const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const INTENTS = { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n } as const;

/** `source` compiled for Base, and the captures of the one body program it opens. */
function captures(source: string): readonly string[] {
  bodies = [];
  const program = compileSauceProgram("base", source, { defines: { RECIPIENT }, intents: INTENTS });
  expect(program.bytecode.length).toBeGreaterThan(0);
  expect(bodies).toHaveLength(1);
  return bodies[0]!;
}

/** `file` followed by a `main` on Base that opens one Arbitrum intent around `body`. */
const fileWithIntent = (file: string, body: string) => `${file}
function main() {
  const amount = USDC.balanceOf(self);
  Arbitrum(() => {
${body}
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;

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

describe("the body's program has the file's declarations it reaches", () => {
  it("a helper function, which is not a capture", () => {
    expect(
      captures(
        fileWithIntent(
          "function half(x: Uint256): Uint256 {\n  return x / 2n;\n}\n",
          "    if (amount > 1n) { USDC.transfer(RECIPIENT, half(amount)); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("what the helpers reach too; a function only the enclosing program has is not compiled there", () => {
    // `unused` calls a contract only Base has: the body's program does not reach it, so it is
    // never compiled for Arbitrum, where it would be refused.
    expect(
      captures(
        fileWithIntent(
          `${ARRAY_HELPERS}
function unused(): Uint256 {
  return AerodromeSlipstream.CLFactory.getPool(USDC, WETH, 100n);
}
`,
          "    if (amount > 1n) { USDC.transfer(RECIPIENT, total(doubled([amount, 1n]))); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("transitively: a helper that calls another", () => {
    expect(
      captures(
        fileWithIntent(
          `function fee(x: Uint256): Uint256 {
  return x / 100n;
}
function net(x: Uint256): Uint256 {
  return x - fee(x);
}
`,
          "    if (amount > 1n) { USDC.transfer(RECIPIENT, net(amount)); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("the import bindings it uses", () => {
    expect(
      captures(
        fileWithIntent(
          'import { approve, transfer as send, balanceOf } from "@sauce/token";\n',
          "    if (amount > 1n) { approve(USDC, RECIPIENT, amount); send(USDC, RECIPIENT, amount); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("an interface a carried signature names", () => {
    expect(
      captures(
        fileWithIntent(
          `interface Leg {
  amount: Uint256;
  to: Address;
}
function legOf(amount: Uint256): Leg {
  return { amount, to: RECIPIENT };
}
`,
          "    const leg = legOf(amount);\n    if (leg.amount > 0n) { USDC.transfer(leg.to, leg.amount); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("a module constant, as a declaration rather than a captured value", () => {
    expect(
      captures(
        fileWithIntent(
          "const FEE_BPS = 30n;\n",
          "    if (amount > 1n) { USDC.transfer(RECIPIENT, amount - (amount * FEE_BPS) / 10000n); }",
        ),
      ),
    ).toEqual(["amount"]);
  });

  it("a local of the opening function shadows a file declaration of the same name", () => {
    expect(
      captures(`function amount(): Uint256 {
  return 1n;
}
function main() {
  const amount = USDC.balanceOf(self);
  Arbitrum(() => {
    if (amount > 0n) { USDC.transfer(RECIPIENT, amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`),
    ).toEqual(["amount"]);
  });

  it("a module `let` starts the program with the value it has where the intent opens", () => {
    // The reward reads `total` at run time; the body must read the same value, not the `0n` the
    // declaration starts with — and so must a function the body calls.
    expect(
      captures(`let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  total = USDC.balanceOf(self);
  Arbitrum(() => {
    const out = half() + total;
    if (out > 0n) { USDC.transfer(RECIPIENT, out); }
  }).reward({ tokens: [{ token: USDC, amount: total }] });
}`),
    ).toEqual(["total"]);
  });

  it("a module `let` only a carried function reads is passed in too, after the locals", () => {
    expect(
      captures(`let scratch = 0n;
function bump(): Uint256 {
  scratch = scratch + 1n;
  return scratch;
}
function main() {
  scratch = 5n;
  const amount = USDC.balanceOf(self);
  Arbitrum(() => {
    if (bump() > 1n) { USDC.transfer(RECIPIENT, amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`),
    ).toEqual(["amount", "scratch"]);
  });

  it("a module `let` and a local of the opening function of the same name are each read from where they live", () => {
    expect(
      captures(`let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  const total = USDC.balanceOf(self);
  Arbitrum(() => {
    if (half() > 0n) { USDC.transfer(RECIPIENT, total); }
  }).reward({ tokens: [{ token: USDC, amount: total }] });
}`),
    ).toEqual(["total", "total"]);
  });

  it("a helper's own parameters and locals are not references to the file's declarations", () => {
    expect(
      captures(`function compute(x: Uint256): Uint256 {
  const payout = x * 2n;
  return payout;
}
function fees(): Uint256 {
  return USDC.balanceOf(self);
}
function net(x: Uint256, fees: Uint256): Uint256 {
  return x - fees;
}
function payout(amount: Uint256): void {
  Arbitrum(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, net(compute(amount), 1n)); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}
function main() {
  payout(USDC.balanceOf(self) + fees());
}`),
    ).toEqual(["amount"]);
  });

  it("refuses a body that calls the function opening it", () => {
    expect(() =>
      compileSauceProgram(
        "base",
        `function payout(amount: Uint256): void {
  Arbitrum(() => {
    if (amount > 0n) { payout(amount); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}
function main() {
  payout(USDC.balanceOf(self));
}`,
        { defines: { RECIPIENT }, intents: INTENTS },
      ),
    ).toThrow(/contains itself/);
  });

  it("an annotated helper taking and returning arrays, used from main and from an intent body", () => {
    expect(
      captures(`${ARRAY_HELPERS}
function main(): void {
  const amount: Uint256 = total(doubled([USDC.balanceOf(self), 1n]));
  Arbitrum(() => {
    const parts: Uint256[] = doubled([amount, 2n]);
    if (total(parts) > 0n) { USDC.transfer(RECIPIENT, total(parts)); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`),
    ).toEqual(["amount"]);
  });

  it("a function only the body calls is compiled for the body's chain alone", () => {
    // USDT is an Optimism token and not a Base one: compiled for Base, `payout` would name a token
    // Base does not have. It runs only on Optimism, so only Optimism compiles it.
    bodies = [];
    const program = compileSauceProgram(
      "base",
      `function payout(to: Address, value: Uint256): void {
  USDT.transfer(to, value);
}
function main() {
  const amount = USDC.balanceOf(self);
  Optimism(() => {
    const held = USDT.balanceOf(self);
    if (held > 0n) { payout(RECIPIENT, held); }
  }).reward({ tokens: [{ token: USDC, amount }] });
}`,
      { defines: { RECIPIENT }, intents: INTENTS },
    );
    expect(program.bytecode.length).toBeGreaterThan(0);
    expect(bodies).toEqual([[]]);
  });
});

describe("a destructured local of the body is the body's own", () => {
  const intentProgram = (body: string) => fileWithIntent("", body);

  it.each(["const", "let"])("`%s [p] = ...` is not captured", (keyword) => {
    expect(
      captures(
        intentProgram(`    ${keyword} [p] = abi.decode(ctx.msgData(), ["Uint256"]);
    if (p > 0n) { USDC.transfer(RECIPIENT, p + amount); }`),
      ),
    ).toEqual(["amount"]);
  });

  it("every name a pattern binds, past a skipped element", () => {
    expect(
      captures(
        intentProgram(`    const [, q] = abi.decode(ctx.msgData(), ["Uint256", "Uint256"]);
    if (q > 0n) { USDC.transfer(RECIPIENT, q + amount); }`),
      ),
    ).toEqual(["amount"]);
  });
});

describe("an intent opened at a script's top level", () => {
  // A script's top-level statements are its entry, so what they declare are the locals an intent
  // there captures, as `main`'s would be.
  const SCRIPT = `const amount = USDC.balanceOf(self);
const [fee] = abi.decode(ctx.msgData(), ["Uint256"]);
Arbitrum(() => {
  if (amount > fee) { USDC.transfer(RECIPIENT, amount - fee); }
}).reward({ tokens: [{ token: USDC, amount }] });`;

  it("captures the script's locals the body reads", () => {
    expect(captures(SCRIPT)).toEqual(["amount", "fee"]);
  });

  it("a top-level `const` of a literal is a constant there, not a capture", () => {
    const withConstant = `const FEE = 30n;\n${SCRIPT.replaceAll("fee", "FEE").replace(
      'const [FEE] = abi.decode(ctx.msgData(), ["Uint256"]);\n',
      "",
    )}`;
    expect(captures(withConstant)).toEqual(["amount"]);
  });
});
