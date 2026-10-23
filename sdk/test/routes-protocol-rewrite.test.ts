/**
 * Full protocol-accessor rewrite -- `Uniswap.UniversalRouter.execute(...)` ->
 * `IUniswapV4_UniversalRouter.at(<addr>n).execute(...)`, plus bare `pot` -> `ctx.self()`.
 * See `src/routes/protocol-rewrite.ts`'s module doc for the design.
 */
import { compileProgram as compile } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { rewriteTokenMembers } from "../src/routes/token-rewrite.js";

const BASE = requireChain("base");
const OPTIMISM = requireChain("optimism");
const ETHEREUM = requireChain("ethereum");

const BASE_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const BASE_AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const ETHEREUM_AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const SVM_EXECUTION = {
  code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  accounts: [],
} as const;

/** `body` compiled as a route on `chain`: an EVM Pot's cook, or an SVM code account's. */
const route = (
  chain: string,
  body: string,
  options: Parameters<typeof compileSauceRoute>[3] = {},
): ReturnType<typeof compileSauceRoute> =>
  compileSauceRoute(
    chain,
    body,
    chain === "solana" ? SVM_EXECUTION : { pot: POT, engine: ENGINE },
    options,
  );

describe("rewriteProtocolAccessors: THE DECISIVE STEP -- a real protocol accessor for a real chain", () => {
  it("Uniswap.UniversalRouter.execute(...) on Base compiles byte-identically to hand-written IUniswapV4_UniversalRouter.at(<addr>n).execute(...) with NO import line and NO baseDirs", () => {
    const source = `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    const {
      source: rewritten,
      rewrote,
      contracts,
      accessorSites,
    } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(accessorSites).toBe(1);
    expect(rewritten).toContain(
      `IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER).toString()}n).execute`,
    );
    expect(Object.keys(contracts)).toEqual(["IUniswapV4_UniversalRouter"]);

    const handWritten = `function main() { IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}n).execute("0x0a", ["0x00"], 0n); }`;

    const a = compile(rewritten, { contracts });
    const b = compile(handWritten, { contracts });
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
    expect(a.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("end-to-end: a real accessor call on the destination chain produces exactly one cook() call", () => {
    const built = route("base", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`);
    expect(built.calls).toHaveLength(1);
  });
});

describe("rewriteProtocolAccessors: shape coverage (A-D)", () => {
  it("shape A: <Protocol>.<Contract>.<method> on the enclosing chain", () => {
    const source = `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(out).toContain("IUniswapV4_UniversalRouter.at(");
  });

  it("shape B: <Protocol>.<method> uses the protocol's single default contract", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    const { rewrote, source: out, contracts } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(out).toContain(`IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}n).getUserAccountData`);
    expect(Object.keys(contracts)).toEqual(["IAaveV3_Pool"]);
  });

  it("shape C: <Chain>.<Protocol>.<Contract>.<method> reaches the NAMED chain", () => {
    const source = `function main() { Base.Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, OPTIMISM);
    expect(rewrote).toBe(true);
    expect(out).toContain(`IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}n)`);
  });

  it("shape D: <Chain>.<Protocol>.<method> reaches the NAMED chain's default contract", () => {
    const source = `function main() { Base.AaveV3.getUserAccountData(ctx.self()); }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, OPTIMISM);
    expect(rewrote).toBe(true);
    expect(out).toContain(`IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}n)`);
  });
});

describe("rewriteProtocolAccessors: .view vs .at binding", () => {
  it("a view/pure method binds via .view(), byte-identical bytecode to .at()", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    const { source: out, contracts } = rewriteProtocolAccessors(source, BASE);
    expect(out).toContain(".view(");

    const atVariant = out.replace(".view(", ".at(");
    const a = compile(out, { contracts });
    const b = compile(atVariant, { contracts });
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
  });

  it("a nonpayable method binds via .at(), never .view()", () => {
    const source = `function main() { AaveV3.Pool.supply(ctx.self(), 1n, ctx.self(), 0n); }`;
    const { source: out } = rewriteProtocolAccessors(source, BASE);
    expect(out).toContain(".at(");
    expect(out).not.toContain(".view(");
  });
});

describe("rewriteProtocolAccessors: chain-scoped addresses differ", () => {
  it("the same protocol accessor resolves to a DIFFERENT address on Base vs Ethereum", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    const onBase = rewriteProtocolAccessors(source, BASE);
    const onEthereum = rewriteProtocolAccessors(source, ETHEREUM);
    expect(onBase.source).toContain(`${BigInt(BASE_AAVE_POOL)}n`);
    expect(onEthereum.source).toContain(`${BigInt(ETHEREUM_AAVE_POOL)}n`);
    expect(onBase.source).not.toBe(onEthereum.source);
  });
});

describe("rewriteProtocolAccessors: qualified ancestor reference", () => {
  it("Base.AaveV3.getUserAccountData inside an Optimism-enclosing body inlines the BASE address, not Optimism's", () => {
    const source = `function main() { Base.AaveV3.getUserAccountData(ctx.self()); }`;
    const { source: out } = rewriteProtocolAccessors(source, OPTIMISM);
    expect(out).toContain(`${BigInt(BASE_AAVE_POOL)}n`);

    const enclosing = rewriteProtocolAccessors(
      `function main() { AaveV3.getUserAccountData(ctx.self()); }`,
      OPTIMISM,
    );
    expect(enclosing.source).not.toContain(`${BigInt(BASE_AAVE_POOL)}n`);
  });

  it("nesting rebinds for free: a child compiled for a different destination resolves its own chain's address", () => {
    const onOptimism = rewriteProtocolAccessors(
      `function main(){ AaveV3.getUserAccountData(ctx.self()); }`,
      OPTIMISM,
    );
    const onBase = rewriteProtocolAccessors(
      `function main(){ AaveV3.getUserAccountData(ctx.self()); }`,
      BASE,
    );
    expect(onOptimism.source).not.toEqual(onBase.source);
  });
});

describe("rewriteProtocolAccessors: bare pot -> ctx.self()", () => {
  it("rewrites a bare `pot` read, byte-identical to hand-written ctx.self()", () => {
    const source = `function main() { return pot; }`;
    const { source: out, rewrote, potSites } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(potSites).toBe(1);
    expect(out).toContain("return ctx.self();");

    const a = compile(out);
    const b = compile(`function main() { return ctx.self(); }`);
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
  });

  it("skips a member property named pot (x.pot), an object-literal key, and a declared pot", () => {
    const source = `function main() { let x = 1n; return x.pot + { pot: 1n }.pot; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
  });

  it("a declared `pot` is the program's where it is in scope", () => {
    const source = `function main() { let pot = 5n; return pot; }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("an inner block's `pot` is that block's: outside it, and before it, `pot` is the Pot", () => {
    const HOLDER = "0x6666666666666666666666666666666666666666";
    const program = (inner: string, outer: string) =>
      `function main(c: bool): Address {\n  const before = ${outer};\n` +
      `  if (c) { const pot = ${HOLDER}; return ${inner}; }\n  return ${outer};\n}`;
    const source = program("pot", "pot");
    expect(rewriteProtocolAccessors(source, BASE).source).toBe(program("pot", "ctx.self()"));
    expect(Array.from(route("base", source).compiled.bytecode[0]!)).toEqual(
      Array.from(route("base", program("pot", "ctx.self()")).compiled.bytecode[0]!),
    );
    // A helper's own `pot` leaves another function's bare `pot` the Pot.
    const helper = `function held(): Address { const pot = ${HOLDER}; return pot; }\n`;
    expect(
      rewriteProtocolAccessors(`${helper}function main(): Address { return pot; }`, BASE).source,
    ).toBe(`${helper}function main(): Address { return ctx.self(); }`);
  });

  it("an inner block's `self` is that block's: outside it, `self` is refused", () => {
    expect(() =>
      rewriteProtocolAccessors(
        "function main(c: bool): Uint256 { if (c) { const self = 1; return self; } return self; }",
        BASE,
      ),
    ).toThrow("`self`: the Pot is `pot`, not `self`");
  });

  it("potSugar: false opts out", () => {
    const source = `function main() { return pot; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE, { potSugar: false });
    expect(rewrote).toBe(false);
  });
});

describe("rewriteProtocolAccessors: an import's names are never a read of the Pot", () => {
  const constants = {
    resolve: (path: string) =>
      path === "./constants.js"
        ? new TextEncoder().encode("export const pot = 7;\nexport const self = 8;")
        : undefined,
  };

  it.each([
    ["pot", 7],
    ["self", 8],
  ])("`import { %s as held }` reads the module's value", (name, value) => {
    const source = `import { ${name} as held } from "./constants.js";\nfunction main(): Uint256 { return held; }`;
    expect(rewriteProtocolAccessors(source, BASE).source).toBe(source);
    expect(Array.from(route("base", source, constants).compiled.bytecode[0]!)).toEqual(
      Array.from(
        route("base", `function main(): Uint256 { return ${value}; }`).compiled.bytecode[0]!,
      ),
    );
  });
});

describe("rewriteProtocolAccessors: a binder is never a read of the Pot", () => {
  const bytes = (source: string) => Array.from(route("base", source).compiled.bytecode[0]!);

  it.each([
    [
      "a destructured element",
      "function main(): Uint256 { const t = { amount: 7 }; const [pot] = t; return pot; }",
    ],
    [
      "a destructured element after a hole",
      "function main(): Uint256 { const t = { a: 7, b: 8 }; const [, pot] = t; return pot; }",
    ],
    [
      "a catch clause's parameter",
      "function main(): Uint256 { try { return 1; } catch (pot) { return pot.length; } }",
    ],
  ])("%s named pot or self is the program's own", (_form, written) => {
    for (const name of ["pot", "self"]) {
      const source = written.replaceAll("pot", name);
      expect(rewriteProtocolAccessors(source, BASE).source).toBe(source);
      expect(bytes(source)).toEqual(bytes(written.replaceAll("pot", "held")));
    }
  });

  it("a destructured object's binder is left as written", () => {
    for (const source of [
      "function main(): Uint256 { const t = { pot: 7 }; const { pot } = t; return pot; }",
      "function main(): Uint256 { const t = { a: 7 }; const { a: pot } = t; return pot; }",
    ]) {
      expect(rewriteProtocolAccessors(source, BASE).source).toBe(source);
    }
  });

  it("outside the binder's scope `pot` is the Pot", () => {
    const program = (outside: string) =>
      "function main(c: bool): Address {\n" +
      "  if (c) { const t = { amount: 7 }; const [pot] = t; require(pot == 7); }\n" +
      "  try { require(c); } catch (pot) { require(pot.length > 0); }\n" +
      `  return ${outside};\n}`;
    expect(rewriteProtocolAccessors(program("pot"), BASE).source).toBe(program("ctx.self()"));
  });

  it("on Solana, a PDA destructured into pot leaves the program as written", () => {
    const source =
      "function main(program: Address): Uint256 {\n" +
      "  const [pot, bump] = crypto.findPDA(program, [hex`01`]);\n  return bump;\n}\n";
    expect(compileSauceProgram("solana", source).source).toBe(source);
  });
});

describe("rewriteProtocolAccessors: bare self, the Pot's old name, is refused", () => {
  const message =
    "`self`: the Pot is `pot`, not `self`: write `pot` (`pot` is the Pot's address, " +
    "`pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).";

  it.each([
    `function main() { return self; }`,
    `function main(to: Address) { require(to != self); }`,
    `function helper(): Address { return self; }\nfunction main() { return helper(); }`,
    `function main() { return self.owner; }`,
  ])("refuses `%s`, with the sugar on or off", (source) => {
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(message);
    expect(() => rewriteProtocolAccessors(source, BASE, { potSugar: false })).toThrow(message);
  });

  it("leaves a program's own `self` alone, and `self` as a member or a key", () => {
    for (const source of [
      `function main() { let self = 5n; return self; }`,
      `function main(self: Address) { return self; }`,
      `function main() { let x = 1n; return x.self + { self: 1n }.self + ctx.self(); }`,
    ]) {
      expect(() => rewriteProtocolAccessors(source, BASE)).not.toThrow();
    }
  });
});

describe("rewriteProtocolAccessors: fallback / named errors", () => {
  it("an unowned head is left silently untouched", () => {
    const source = `function main() { SomeRandomThing.Contract.method(1n); }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("a shadowed namespace head is left silently untouched", () => {
    const source = `function main() { let Uniswap = 1n; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).not.toThrow();
    const { rewrote } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
  });

  it("known protocol, unknown contract -> named error", () => {
    const source = `function main() { Uniswap.NotAContract.method(1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/Unknown contract 'NotAContract'/);
  });

  it("known contract, not deployed on this chain -> named error", () => {
    // AaveV3 has no descriptor entry on linea in the starter set.
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    expect(() => rewriteProtocolAccessors(source, requireChain("linea"))).toThrow(
      /is not deployed on 'linea'/,
    );
  });

  // No registry ABI is widened any more (the registry-abi suite pins every selector against the
  // deployed code), so the gate is exercised by marking a real descriptor widened for one test.
  function whileWidened<T>(protocol: string, contract: string, run: () => T): T {
    const coverage = getDescriptor(protocol, contract)!.coverage as {
      typeFidelity: "exact" | "widened";
      caveats: readonly string[];
    };
    const saved = { typeFidelity: coverage.typeFidelity, caveats: coverage.caveats };
    coverage.typeFidelity = "widened";
    coverage.caveats = ["synthetic: computed selectors do not match the deployed contract"];
    try {
      return run();
    } finally {
      Object.assign(coverage, saved);
    }
  }

  it("a widened-selector descriptor is refused by default, with a named error quoting the caveat", () => {
    const source = `function main() { UniswapV4.PoolManager.initialize(1n); }`;
    whileWidened("uniswap-v4", "PoolManager", () =>
      expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/widened.*synthetic/),
    );
  });

  it("allowWidenedSelectors opts in", () => {
    const source = `function main() { UniswapV4.PoolManager.initialize(1n); }`;
    const { rewrote } = whileWidened("uniswap-v4", "PoolManager", () =>
      rewriteProtocolAccessors(source, BASE, { allowWidenedSelectors: true }),
    );
    expect(rewrote).toBe(true);
  });

  it("an exact descriptor needs no opt-in: UniswapV4.PoolManager now carries the deployed types", () => {
    const source = `function main() { UniswapV4.PoolManager.initialize(1n); }`;
    expect(rewriteProtocolAccessors(source, BASE).rewrote).toBe(true);
  });

  it("a family-ambiguous contract -> named error", () => {
    const source = `function main() { Uniswap.Factory.method(1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/ambiguous/);
  });

  it("an interface descriptor (Erc20.ERC20) -> named error", () => {
    const source = `function main() { Erc20.ERC20.transfer(ctx.self(), 1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/interface descriptor/);
  });

  it("an address-only descriptor (AaveV3.PoolAddressesProvider) -> named error", () => {
    const source = `function main() { AaveV3.PoolAddressesProvider.method(1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/no ABI vendored/);
  });

  it("a method not in the vendored ABI -> named error", () => {
    const source = `function main() { AaveV3.Pool.nope(1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(
      /'nope' is not in .*Pool's vendored ABI/,
    );
  });

  it("a binding-name collision with an existing user identifier -> named error", () => {
    const source = `function main() { let IUniswapV4_UniversalRouter = 1n; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    // Uniswap is not shadowed, IUniswapV4_UniversalRouter is a different, unrelated identifier that collides post-rewrite.
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/collides with an identifier/);
  });

  it("an svm destination throws via compileSauceRoute -- every starter-set descriptor is EVM-only, so it fails closed on 'not deployed' before an accessor site could ever resolve", () => {
    expect(() => route("solana", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`)).toThrow(
      /not deployed on 'solana'/,
    );
  });

  it("accessors: false makes an svm destination unaffected by the rewrite entirely (falls through to the compiler's own error)", () => {
    expect(() =>
      route("solana", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`, {
        accessors: false,
      }),
    ).toThrow();
  });
});

describe("rewriteProtocolAccessors: negative controls -- isolation", () => {
  it("U4's ERC20 rewrite stays byte-identical and unaffected", () => {
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
    const source = `function main() { USDC.transfer(${USDC}, 5n); }`;
    const before = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(before.rewrote).toBe(true);
    expect(before.source).toContain(`__sauce_transfer(USDC, ${USDC}, 5n)`);
  });

  it("a body with zero accessor/self sites compiles byte-identically with accessors on and off", () => {
    const built1 = route("base", `function main() { return 5n; }`, { accessors: true });
    const built2 = route("base", `function main() { return 5n; }`, { accessors: false });
    expect(built1.calls[0]!.data).toEqual(built2.calls[0]!.data);
  });

  it("accessors: false opts out entirely even when the body has a recognizable accessor shape", () => {
    // Left untouched -> the base compiler throws its own generic property-access error.
    expect(() =>
      route("base", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`, {
        accessors: false,
      }),
    ).toThrow();
  });
});

const BASE_CCTP_TOKEN_MESSENGER = 232410083228790048339504449763962118892241342301n; // Cctp.TokenMessenger on base

describe("rewriteProtocolAccessors: VALUE position -- an accessor used as an address, not a call", () => {
  it("Cctp.TokenMessenger (Protocol.Contract) resolves to the SAME address literal the underscore define uses", () => {
    const source = `function main() { return Cctp.TokenMessenger; }`;
    const { source: out, rewrote, valueAccessSites } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(valueAccessSites).toBe(1);
    expect(out).toContain(`${BASE_CCTP_TOKEN_MESSENGER}n`);
    expect(out).not.toContain("Cctp.TokenMessenger");
  });

  it("Base.Uniswap.UniversalRouter (Chain.Protocol.Contract) resolves to that chain's address as a value", () => {
    const source = `function main() { return Base.Uniswap.UniversalRouter; }`;
    const { source: out, valueAccessSites } = rewriteProtocolAccessors(source, ETHEREUM); // enclosing chain ignored -- Base wins
    expect(valueAccessSites).toBe(1);
    expect(out).toContain(`${BigInt(BASE_UNIVERSAL_ROUTER)}n`);
  });

  it("chain-qualified value resolves per the NAMED chain (Base vs Ethereum AaveV3 differ)", () => {
    const onBase = rewriteProtocolAccessors(`function main() { return Base.AaveV3; }`, OPTIMISM);
    const onEth = rewriteProtocolAccessors(`function main() { return Ethereum.AaveV3; }`, OPTIMISM);
    expect(onBase.source).toContain(`${BigInt(BASE_AAVE_POOL)}n`);
    expect(onEth.source).toContain(`${BigInt(ETHEREUM_AAVE_POOL)}n`);
  });

  it("a call AND a value of the same accessor coexist -- call -> binding, value -> address, no double-rewrite", () => {
    const source = `function main() { AaveV3.getUserAccountData(address.self); return AaveV3.Pool; }`;
    const { source: out, accessorSites, valueAccessSites } = rewriteProtocolAccessors(source, BASE);
    expect(accessorSites).toBe(1); // the call
    expect(valueAccessSites).toBe(1); // the value
    expect(out).toContain(`IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}n).getUserAccountData`);
    expect(out).toContain(`return ${BigInt(BASE_AAVE_POOL)}n;`);
  });

  it("ISOLATION: a non-namespace member value (foo.bar) is left completely untouched", () => {
    const source = `function main() { let foo = 0n; return foo.bar; }`;
    const { rewrote, valueAccessSites, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(valueAccessSites).toBe(0);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("tells onContract each reference it resolves: as written, with its chain and address", () => {
    const heard: Array<[string, string, string, string]> = [];
    rewriteProtocolAccessors(
      `function main() {
        Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);
        USDC.approve(Cctp.TokenMessenger, 1n);
        Ethereum.AaveV3.Pool.supply(1n, 2n, 3n, 0n);
      }`,
      BASE,
      {
        onContract: (reference, target) =>
          heard.push([reference, target.protocol, target.chain.slug, target.address.toLowerCase()]),
      },
    );
    expect(heard).toEqual(
      expect.arrayContaining([
        ["Uniswap.UniversalRouter", "uniswap-v4", "base", BASE_UNIVERSAL_ROUTER],
        ["Ethereum.AaveV3.Pool", "aave-v3", "ethereum", ETHEREUM_AAVE_POOL.toLowerCase()],
        ["Cctp.TokenMessenger", "cctp", "base", expect.stringMatching(/^0x[0-9a-f]{40}$/)],
      ]),
    );
    expect(heard).toHaveLength(3);
  });

  it("END TO END: USDC.approve(Cctp.TokenMessenger, x) compiles as a route (dot form as a spender)", () => {
    const built = route("base", `function main() { USDC.approve(Cctp.TokenMessenger, 1000000n); }`);
    expect(built.calls).toHaveLength(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("rewriteProtocolAccessors: every registry protocol, every contract kind", () => {
  it("a formerly unlinked protocol resolves like any other: PancakeswapV3.Factory on Base", () => {
    const source = `function main() { return PancakeswapV3.Factory.getPool(1n, 2n, 500n); }`;
    const { source: rewritten, contracts } = rewriteProtocolAccessors(source, BASE);
    const factory = getDescriptor("pancakeswap-v3", "Factory")!.perChainAddress[8453]!;
    expect(rewritten).toContain(`IPancakeswapV3_Factory.view(${BigInt(factory)}n).getPool`);
    expect(Object.keys(contracts)).toEqual(["IPancakeswapV3_Factory"]);
    expect(compile(rewritten, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("Uniswap V4's StateView and PoolManager.extsload read pool state, on every V4 chain", () => {
    const source = `function main() {
      const poolId = 0x1234n;
      const [sqrtPriceX96, tick, protocolFee, lpFee] = UniswapV4.StateView.getSlot0(poolId);
      const raw = UniswapV4.PoolManager.extsload(poolId);
      return sqrtPriceX96 + UniswapV4.StateView.getLiquidity(poolId) + raw;
    }`;
    for (const slug of getDescriptor("uniswap-v4", "StateView")!.chains) {
      const { source: rewritten, contracts } = rewriteProtocolAccessors(source, requireChain(slug));
      expect(Object.keys(contracts).sort()).toEqual([
        "IUniswapV4_PoolManager",
        "IUniswapV4_StateView",
      ]);
      expect(compile(rewritten, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
    }
    expect(getDescriptor("uniswap-v4", "StateView")!.chains).toEqual(
      getDescriptor("uniswap-v4", "PoolManager")!.chains,
    );
  });

  it("shape E: an interface is called at the address the program supplies", () => {
    const source = `function main() { return Erc4626.Vault.at(0x1234n).deposit(1n, ctx.self()); }`;
    const { source: rewritten, contracts } = rewriteProtocolAccessors(source, BASE);
    expect(rewritten).toBe(
      `function main() { return IErc4626_Vault.at(0x1234n).deposit(1n, ctx.self()); }`,
    );
    expect(Object.keys(contracts)).toEqual(["IErc4626_Vault"]);
    expect(compile(rewritten, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("shape E: a deployed contract's ABI reaches another deployment, still bound .view for a view", () => {
    const source = `function main() { return UniswapV3.Factory.at(0x1234n).getPool(1n, 2n, 500n); }`;
    expect(rewriteProtocolAccessors(source, BASE).source).toBe(
      `function main() { return IUniswapV3_Factory.view(0x1234n).getPool(1n, 2n, 500n); }`,
    );
  });

  it("shape E needs a method in the same expression, and one address", () => {
    expect(() =>
      rewriteProtocolAccessors(`function main() { const v = Erc4626.Vault.at(1n); }`, BASE),
    ).toThrow(/is not a value — call a method on it/);
    expect(() =>
      rewriteProtocolAccessors(
        `function main() { Erc4626.Vault.at(1n, 2n).deposit(1n, 1n); }`,
        BASE,
      ),
    ).toThrow(/takes exactly one argument/);
    expect(() =>
      rewriteProtocolAccessors(
        `function main() { AaveV3.PoolAddressesProvider.at(1n).getPool(); }`,
        BASE,
      ),
    ).toThrow(/there is nothing to bind/);
  });

  it("an interface without an address is refused with the spelling that works", () => {
    expect(() =>
      rewriteProtocolAccessors(`function main() { Erc4626.Vault.deposit(1n, 1n); }`, BASE),
    ).toThrow(/Erc4626\.Vault\(<address>\)\.<method>\(\.\.\.\)/);
  });

  it("shape F: an interface called with an address is shape E, byte for byte", () => {
    const called = `function main(pool: Address): Uint256 { return UniswapV3.Pool(pool).liquidity(); }`;
    const bound = `function main(pool: Address): Uint256 { return UniswapV3.Pool.at(pool).liquidity(); }`;
    const viaCall = rewriteProtocolAccessors(called, BASE);
    const viaAt = rewriteProtocolAccessors(bound, BASE);
    expect(viaCall.source).toBe(
      `function main(pool: Address): Uint256 { return IUniswapV3_Pool.view(pool).liquidity(); }`,
    );
    expect(viaCall.source).toBe(viaAt.source);
    expect(Object.keys(viaCall.contracts)).toEqual(["IUniswapV3_Pool"]);
    expect(compile(viaCall.source, { contracts: viaCall.contracts }).bytecode[0]).toEqual(
      compile(viaAt.source, { contracts: viaAt.contracts }).bytecode[0],
    );
  });

  it("shape F takes a chain qualifier, a family alias, a nonpayable method and one output", () => {
    expect(
      rewriteProtocolAccessors(
        `function main() { return Base.Erc4626.Vault(0x1234n).deposit(1n, ctx.self()); }`,
        BASE,
      ).source,
    ).toBe(`function main() { return IErc4626_Vault.at(0x1234n).deposit(1n, ctx.self()); }`);
    expect(
      rewriteProtocolAccessors(`function main() { return Uniswap.Pool(0x1234n).fee(); }`, BASE)
        .source,
    ).toBe(`function main() { return IUniswapV3_Pool.view(0x1234n).fee(); }`);
    const { source, contracts } = rewriteProtocolAccessors(
      `function main(pool: Address): Uint256 { return AerodromeSlipstream.Pool(pool).slot0().sqrtPriceX96; }`,
      BASE,
    );
    expect(compile(source, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("shape F needs a method in the same expression, and one address", () => {
    expect(() =>
      rewriteProtocolAccessors(`function main() { const v = UniswapV3.Pool(1n); }`, BASE),
    ).toThrow(/'UniswapV3\.Pool\(\.\.\.\)' binds a contract to an address, which is not a value/);
    expect(() =>
      rewriteProtocolAccessors(`function main() { UniswapV3.Pool(1n, 2n).fee(); }`, BASE),
    ).toThrow(/takes exactly one argument/);
  });

  it("a deployed contract's name is never called with an address: .at binds another deployment", () => {
    expect(() =>
      rewriteProtocolAccessors(
        `function main() { return UniswapV3.Factory(0x1234n).getPool(1n, 2n, 500n); }`,
        BASE,
      ),
    ).toThrow(
      /'UniswapV3\.Factory\(\.\.\.\)' calls a deployed contract's name: .*'UniswapV3\.Factory\.at\(<address>\)\.<method>\(\.\.\.\)'/,
    );
  });

  it("a program's own function named like an interface is its own", () => {
    const source = `function Pool(a: Uint256): Uint256 { return a; }\nfunction main() { return Pool(1n); }`;
    expect(rewriteProtocolAccessors(source, BASE).rewrote).toBe(false);
  });

  it("an address-only contract is its address in value position", () => {
    const source = `function main() { return AaveV3.PoolAddressesProvider; }`;
    const provider = getDescriptor("aave-v3", "PoolAddressesProvider")!.perChainAddress[8453]!;
    expect(rewriteProtocolAccessors(source, BASE).source).toBe(
      `function main() { return ${BigInt(provider)}n; }`,
    );
  });
});
