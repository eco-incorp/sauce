/**
 * The protocol names a program writes, and the pass that lowers what a module cannot hold.
 *
 * A contract of a protocol (`Uniswap.UniversalRouter.execute(...)`, `Base.Uniswap.UniversalRouter`,
 * `Cctp.TokenMessenger` as an address) is declared by the chain's `@sauce/chain` module, so the
 * compiler resolves it with no source rewrite: those tests compile the program and hold it to the
 * program written with the binding or the address spelled out. What `rewriteProtocolAccessors`
 * still lowers -- `<Protocol>.<method>(...)` through the default contract, a contract bound to
 * another address (`<…>.<Contract>.at(addr)`, `<…>.<Interface>(addr)`), bare `pot` -> `ctx.self()`
 * and the refusal of `self` -- is tested on the pass itself. See `src/routes/protocol-rewrite.ts`
 * and `src/routes/absent-names.ts`.
 */
import { compileProgram as compile } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import {
  compileSauceProgram,
  compileSauceRoute,
  type SauceProgramOptions,
} from "../src/routes/sauce-route.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { rewriteTokenMembers } from "../src/routes/token-rewrite.js";

const BASE = requireChain("base");
const OPTIMISM = requireChain("optimism");

const BASE_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const BASE_AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const ETHEREUM_AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const BASE_CCTP_TOKEN_MESSENGER = 232410083228790048339504449763962118892241342301n; // Cctp.TokenMessenger on base

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

/** The bytes `source` compiles to for `chain`, names and all. */
const bytes = (chain: string, source: string, options: SauceProgramOptions = {}): number[] =>
  Array.from(compileSauceProgram(chain, source, options).bytecode);

/** The ABI of a registry contract, as a `contracts` entry named `name`. */
const binding = (name: string, protocol: string, contract: string) => ({
  [name]: { abi: getDescriptor(protocol, contract)!.abi },
});

/** The address a registry contract is deployed at on `chain`, as a SauceScript integer. */
const deployedAt = (protocol: string, contract: string, chain: { readonly id: number }): string =>
  BigInt(getDescriptor(protocol, contract)!.perChainAddress[chain.id]!).toString();

describe("protocol accessors: THE DECISIVE STEP -- a real protocol accessor for a real chain", () => {
  it("Uniswap.UniversalRouter.execute(...) on Base compiles byte-identically to hand-written IUniswapV4_UniversalRouter.at(<addr>).execute(...) with NO import line and NO baseDirs", () => {
    const source = `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0); }`;
    const handWritten = `function main() { IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}).execute("0x0a", ["0x00"], 0); }`;

    const a = bytes("base", source);
    const b = bytes("base", handWritten, {
      contracts: binding("IUniswapV4_UniversalRouter", "uniswap-v4", "UniversalRouter"),
    });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);

    // The module holds the name: the pass has nothing to rewrite.
    const pass = rewriteProtocolAccessors(source, BASE);
    expect(pass.rewrote).toBe(false);
    expect(pass.source).toBe(source);
    expect(pass.contracts).toEqual({});
  });

  it("end-to-end: a real accessor call on the destination chain produces exactly one cook() call", () => {
    const built = route("base", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0);`);
    expect(built.calls).toHaveLength(1);
  });
});

describe("protocol accessors: shape coverage (A-D)", () => {
  it("shape A: <Protocol>.<Contract>.<method> on the enclosing chain", () => {
    const source = `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0); }`;
    const handWritten = (chain: { readonly id: number }) =>
      `function main() { IUniswapV4_UniversalRouter.at(${deployedAt("uniswap-v4", "UniversalRouter", chain)}).execute("0x0a", ["0x00"], 0); }`;
    const contracts = binding("IUniswapV4_UniversalRouter", "uniswap-v4", "UniversalRouter");

    // Each chain's own deployment: the enclosing chain decides.
    expect(bytes("optimism", source)).toEqual(
      bytes("optimism", handWritten(OPTIMISM), { contracts }),
    );
    expect(bytes("base", source)).toEqual(bytes("base", handWritten(BASE), { contracts }));
    expect(bytes("optimism", source)).not.toEqual(bytes("base", source));
  });

  it("shape B: <Protocol>.<method> uses the protocol's single default contract", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    const {
      rewrote,
      source: out,
      contracts,
      defaultSites,
      accessorSites,
    } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(out).toBe(`function main() { AaveV3.Pool.getUserAccountData(ctx.self()); }`);
    expect(defaultSites).toBe(1);
    expect(accessorSites).toBe(0);
    expect(contracts).toEqual({});

    const handWritten = `function main() { IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}).getUserAccountData(ctx.self()); }`;
    expect(bytes("base", source)).toEqual(
      bytes("base", handWritten, { contracts: binding("IAaveV3_Pool", "aave-v3", "Pool") }),
    );
  });

  it("shape C: <Chain>.<Protocol>.<Contract>.<method> reaches the NAMED chain", () => {
    const source = `function main() { Base.Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0); }`;
    const handWritten = `function main() { IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}).execute("0x0a", ["0x00"], 0); }`;
    const contracts = binding("IUniswapV4_UniversalRouter", "uniswap-v4", "UniversalRouter");

    expect(bytes("optimism", source)).toEqual(bytes("optimism", handWritten, { contracts }));
    expect(rewriteProtocolAccessors(source, OPTIMISM).rewrote).toBe(false);
  });

  it("shape D: <Chain>.<Protocol>.<method> reaches the NAMED chain's default contract", () => {
    const source = `function main() { Base.AaveV3.getUserAccountData(ctx.self()); }`;
    const {
      rewrote,
      source: out,
      defaultSites,
      accessorSites,
    } = rewriteProtocolAccessors(source, OPTIMISM);
    expect(rewrote).toBe(true);
    expect(out).toBe(`function main() { Base.AaveV3.Pool.getUserAccountData(ctx.self()); }`);
    expect(defaultSites).toBe(1);
    expect(accessorSites).toBe(0);

    const handWritten = `function main() { IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}).getUserAccountData(ctx.self()); }`;
    expect(bytes("optimism", source)).toEqual(
      bytes("optimism", handWritten, { contracts: binding("IAaveV3_Pool", "aave-v3", "Pool") }),
    );
  });
});

describe("protocol accessors: .view vs .at binding", () => {
  it("a view/pure method compiles byte-identically through .view(), .at() and the default contract", () => {
    const contracts = binding("IAaveV3_Pool", "aave-v3", "Pool");
    const call = (op: "view" | "at") =>
      `function main() { IAaveV3_Pool.${op}(${BigInt(BASE_AAVE_POOL)}).getUserAccountData(ctx.self()); }`;
    const viaView = bytes("base", call("view"), { contracts });
    const viaAt = bytes("base", call("at"), { contracts });
    expect(viaView).toEqual(viaAt);
    expect(bytes("base", `function main() { AaveV3.getUserAccountData(ctx.self()); }`)).toEqual(
      viaView,
    );
  });

  it("a nonpayable method compiles byte-identically to .at()", () => {
    const source = `function main() { AaveV3.Pool.supply(ctx.self(), 1, ctx.self(), 0); }`;
    const handWritten = `function main() { IAaveV3_Pool.at(${BigInt(BASE_AAVE_POOL)}).supply(ctx.self(), 1, ctx.self(), 0); }`;
    expect(bytes("base", source)).toEqual(
      bytes("base", handWritten, { contracts: binding("IAaveV3_Pool", "aave-v3", "Pool") }),
    );
  });
});

describe("protocol accessors: chain-scoped addresses differ", () => {
  it("the same protocol accessor resolves to a DIFFERENT address on Base vs Ethereum", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    const contracts = binding("IAaveV3_Pool", "aave-v3", "Pool");
    const handWritten = (pool: string) =>
      `function main() { IAaveV3_Pool.view(${BigInt(pool)}).getUserAccountData(ctx.self()); }`;

    const onBase = bytes("base", source);
    const onEthereum = bytes("ethereum", source);
    expect(onBase).toEqual(bytes("base", handWritten(BASE_AAVE_POOL), { contracts }));
    expect(onEthereum).toEqual(bytes("ethereum", handWritten(ETHEREUM_AAVE_POOL), { contracts }));
    expect(onBase).not.toEqual(onEthereum);
  });
});

describe("protocol accessors: qualified ancestor reference", () => {
  it("Base.AaveV3.getUserAccountData inside an Optimism-enclosing body reaches the BASE address, not Optimism's", () => {
    const contracts = binding("IAaveV3_Pool", "aave-v3", "Pool");
    const handWritten = (pool: string) =>
      `function main() { IAaveV3_Pool.view(${BigInt(pool)}).getUserAccountData(ctx.self()); }`;

    const named = bytes(
      "optimism",
      `function main() { Base.AaveV3.getUserAccountData(ctx.self()); }`,
    );
    const enclosing = bytes(
      "optimism",
      `function main() { AaveV3.getUserAccountData(ctx.self()); }`,
    );
    expect(named).toEqual(bytes("optimism", handWritten(BASE_AAVE_POOL), { contracts }));
    expect(enclosing).toEqual(
      bytes("optimism", handWritten(deployedAt("aave-v3", "Pool", OPTIMISM)), { contracts }),
    );
    expect(named).not.toEqual(enclosing);
  });

  it("nesting rebinds for free: a child compiled for a different destination resolves its own chain's address", () => {
    const source = `function main(){ AaveV3.getUserAccountData(ctx.self()); }`;
    expect(bytes("optimism", source)).not.toEqual(bytes("base", source));
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
    const source = `function main() { let x = 1; return x.pot + { pot: 1 }.pot; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
  });

  it("a declared `pot` suppresses the whole-program rewrite", () => {
    const source = `function main() { let pot = 5; return pot; }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("potSugar: false opts out", () => {
    const source = `function main() { return pot; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE, { potSugar: false });
    expect(rewrote).toBe(false);
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
      `function main() { let self = 5; return self; }`,
      `function main(self: Address) { return self; }`,
      `function main() { let x = 1; return x.self + { self: 1 }.self + ctx.self(); }`,
    ]) {
      expect(() => rewriteProtocolAccessors(source, BASE)).not.toThrow();
    }
  });
});

describe("protocol accessors: fallback / named errors", () => {
  it("an unowned head is left silently untouched", () => {
    const source = `function main() { SomeRandomThing.Contract.method(1); }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("a shadowed namespace head is left silently untouched", () => {
    const source = `function main() { let Uniswap = 1; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).not.toThrow();
    const { rewrote } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
  });

  it("known protocol, unknown contract -> located error naming the contracts it has", () => {
    const source = `function main() { Uniswap.NotAContract.method(1); }`;
    expect(() => compileSauceProgram("base", source)).toThrow(
      /`Uniswap\.NotAContract` is not a contract of Uniswap: it has .*UniversalRouter/,
    );
    expect(() => compileSauceProgram("base", source)).toThrow(/--> main\.js:1:19/);
  });

  it("known contract, not deployed on this chain -> located error naming the chain and the test that allows it", () => {
    // AaveV3 has no descriptor entry on linea in the starter set.
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); }`;
    expect(() => compileSauceProgram("linea", source)).toThrow(
      /`AaveV3\.getUserAccountData\(…\)` calls AaveV3\.Pool, which is not deployed on linea\. A contract the chain lacks is zero there, and only a test of it may use it/,
    );
    const named = `function main() { AaveV3.Pool.getUserAccountData(ctx.self()); }`;
    expect(() => compileSauceProgram("linea", named)).toThrow(
      /`AaveV3\.Pool` is not deployed on linea/,
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

  // A chain's names are built once and kept for every later compile on it, so a descriptor marked
  // widened for one compile stays refused on that chain: the compile-level tests mark a contract on
  // a chain no other test here reads it on (PancakeswapV3.Factory on bsc).
  const PANCAKE_GET_POOL = `function main() { return PancakeswapV3.Factory.getPool(1, 2, 500); }`;

  it("a widened-selector descriptor is refused by default, with a located error quoting the caveat", () => {
    whileWidened("pancakeswap-v3", "Factory", () =>
      expect(() => compileSauceProgram("bsc", PANCAKE_GET_POOL)).toThrow(
        /pancakeswap-v3\.Factory's vendored ABI is "widened".*synthetic.*pass accessors: \{ allowWidenedSelectors: true \}/,
      ),
    );
    // Bound to another address (shape E), the pass refuses it the same way.
    const bound = `function main() { return UniswapV4.PoolManager.at(0x1234).extsload(1); }`;
    whileWidened("uniswap-v4", "PoolManager", () =>
      expect(() => rewriteProtocolAccessors(bound, BASE)).toThrow(/widened.*synthetic/),
    );
  });

  it("allowWidenedSelectors opts in", () => {
    const compiled = whileWidened("pancakeswap-v3", "Factory", () =>
      compileSauceProgram("bsc", PANCAKE_GET_POOL, {
        accessors: { allowWidenedSelectors: true },
      }),
    );
    expect(compiled.bytecode.length).toBeGreaterThan(0);
    const bound = `function main() { return UniswapV4.PoolManager.at(0x1234).extsload(1); }`;
    const { rewrote } = whileWidened("uniswap-v4", "PoolManager", () =>
      rewriteProtocolAccessors(bound, BASE, { allowWidenedSelectors: true }),
    );
    expect(rewrote).toBe(true);
  });

  it("an exact descriptor needs no opt-in: UniswapV4.PoolManager now carries the deployed types", () => {
    const source = `function main() { UniswapV4.PoolManager.extsload(0x1234); }`;
    expect(bytes("base", source).length).toBeGreaterThan(0);
    const bound = `function main() { return UniswapV4.PoolManager.at(0x1234).extsload(1); }`;
    expect(rewriteProtocolAccessors(bound, BASE).rewrote).toBe(true);
  });

  it("a family-ambiguous contract -> located error naming the members", () => {
    const source = `function main() { Uniswap.Factory.method(1); }`;
    expect(() => compileSauceProgram("base", source)).toThrow(
      /`Uniswap\.Factory` is ambiguous under Uniswap \(uniswap-v2, uniswap-v3\): write `UniswapV2\.Factory` or `UniswapV3\.Factory`/,
    );
  });

  it("an interface descriptor (Erc20.ERC20) -> located error", () => {
    const source = `function main() { Erc20.ERC20.transfer(ctx.self(), 1); }`;
    expect(() => compileSauceProgram("base", source)).toThrow(
      /`Erc20\.ERC20` is an interface, with no address of its own: give it the address, `Erc20\.ERC20\(<address>\)\.transfer`/,
    );
  });

  it("an address-only descriptor (AaveV3.PoolAddressesProvider) -> located error", () => {
    const source = `function main() { AaveV3.PoolAddressesProvider.method(1); }`;
    expect(() => compileSauceProgram("base", source)).toThrow(
      /aave-v3\.PoolAddressesProvider has an address but no ABI vendored for this role \(kind: "address-only"\)/,
    );
  });

  it("a method not in the vendored ABI -> the compiler's error naming the method", () => {
    const source = `function main() { AaveV3.Pool.nope(1); }`;
    expect(() => compileSauceProgram("base", source)).toThrow(/has no method named `nope`/);
  });

  it("a binding-name collision with an existing user identifier -> named error", () => {
    const source = `function main() { let IUniswapV3_Pool = 1; UniswapV3.Pool(0x1234).fee(); }`;
    // UniswapV3 is not shadowed, IUniswapV3_Pool is a different, unrelated identifier that collides post-rewrite.
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/collides with an identifier/);
  });

  it("a name of a program's own that looks like a binding is no collision for a contract the module holds", () => {
    const source = `function main() { let IUniswapV4_UniversalRouter = 1; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0); }`;
    expect(() => compileSauceProgram("base", source)).not.toThrow();
  });

  it("an svm destination is refused by name -- every starter-set descriptor is EVM-only, so it fails closed on 'not deployed' before an accessor site could ever resolve", () => {
    expect(() => route("solana", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0);`)).toThrow(
      /`Uniswap\.UniversalRouter` is not deployed on solana/,
    );
  });

  it("accessors: false makes an svm destination unaffected by the rewrite entirely (falls through to the compiler's own error)", () => {
    expect(() =>
      route("solana", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0);`, {
        accessors: false,
      }),
    ).toThrow();
  });

  it("a chain outside accessors.chainScope is refused, naming the chain", () => {
    const source = `function main() { return Optimism.UniswapV3.Factory; }`;
    expect(() =>
      compileSauceProgram("base", source, { accessors: { chainScope: ["base"] } }),
    ).toThrow(
      /chain 'optimism' \(referenced as 'Optimism\.\.\.\.'\) is outside the allowed chainScope/,
    );
    expect(() => compileSauceProgram("base", source)).not.toThrow();
  });
});

describe("protocol accessors: negative controls -- isolation", () => {
  it("U4's ERC20 rewrite stays byte-identical and unaffected", () => {
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
    const source = `function main() { USDC.transfer(${USDC}, 5); }`;
    const before = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(before.rewrote).toBe(true);
    expect(before.source).toContain(`__sauce_transfer(USDC, ${USDC}, 5)`);
  });

  it("a body with zero accessor/self sites compiles byte-identically with accessors on and off", () => {
    const built1 = route("base", `function main() { return 5; }`, { accessors: true });
    const built2 = route("base", `function main() { return 5; }`, { accessors: false });
    expect(built1.calls[0]!.data).toEqual(built2.calls[0]!.data);
  });

  it("accessors: false opts out entirely even when the body has a recognizable accessor shape", () => {
    // Left untouched -> the base compiler throws its own generic property-access error.
    expect(() =>
      route("base", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0);`, {
        accessors: false,
      }),
    ).toThrow();
  });
});

describe("protocol accessors: VALUE position -- an accessor used as an address, not a call", () => {
  it("Cctp.TokenMessenger (Protocol.Contract) is the SAME address literal the underscore define uses", () => {
    const source = `function main() { return Cctp.TokenMessenger; }`;
    expect(bytes("base", source)).toEqual(
      bytes("base", `function main() { return ${BASE_CCTP_TOKEN_MESSENGER}; }`),
    );
    expect(BASE_CCTP_TOKEN_MESSENGER).toBe(BigInt(deployedAt("cctp", "TokenMessenger", BASE)));

    // The names module holds it: the pass has nothing to rewrite.
    const pass = rewriteProtocolAccessors(source, BASE);
    expect(pass.rewrote).toBe(false);
    expect(pass.source).toBe(source);
  });

  it("Base.Uniswap.UniversalRouter (Chain.Protocol.Contract) is that chain's address as a value, whatever the enclosing chain", () => {
    const source = `function main() { return Base.Uniswap.UniversalRouter; }`;
    expect(bytes("ethereum", source)).toEqual(
      bytes("ethereum", `function main() { return ${BigInt(BASE_UNIVERSAL_ROUTER)}; }`), // enclosing chain ignored -- Base wins
    );
  });

  it("chain-qualified value resolves per the NAMED chain (Base vs Ethereum AaveV3 differ)", () => {
    const asValue = (address: string) => `function main() { return ${BigInt(address)}; }`;
    const onBase = bytes("optimism", `function main() { return Base.AaveV3.Pool; }`);
    const onEth = bytes("optimism", `function main() { return Ethereum.AaveV3.Pool; }`);
    expect(onBase).toEqual(bytes("optimism", asValue(BASE_AAVE_POOL)));
    expect(onEth).toEqual(bytes("optimism", asValue(ETHEREUM_AAVE_POOL)));
    expect(onBase).not.toEqual(onEth);
  });

  it("a call AND a value of the same accessor coexist -- call -> default contract, value -> address, no double-rewrite", () => {
    const source = `function main() { AaveV3.getUserAccountData(ctx.self()); return AaveV3.Pool; }`;
    const pass = rewriteProtocolAccessors(source, BASE);
    expect(pass.defaultSites).toBe(1); // the call
    expect(pass.accessorSites).toBe(0); // the value is the module's
    expect(pass.source).toBe(
      `function main() { AaveV3.Pool.getUserAccountData(ctx.self()); return AaveV3.Pool; }`,
    );

    const handWritten = `function main() { IAaveV3_Pool.view(${BigInt(BASE_AAVE_POOL)}).getUserAccountData(ctx.self()); return ${BigInt(BASE_AAVE_POOL)}; }`;
    expect(bytes("base", source)).toEqual(
      bytes("base", handWritten, { contracts: binding("IAaveV3_Pool", "aave-v3", "Pool") }),
    );
  });

  it("ISOLATION: a non-namespace member value (foo.bar) is left completely untouched", () => {
    const source = `function main() { let foo = 0; return foo.bar; }`;
    const {
      rewrote,
      accessorSites,
      defaultSites,
      source: out,
    } = rewriteProtocolAccessors(source, BASE);
    expect(accessorSites).toBe(0);
    expect(defaultSites).toBe(0);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("shape G: a scalar method on a bound contract, or on a local holding one, reads the address", () => {
    // 2.6.0 takes `.toBytesBe`/`.toBytesLe` only on an address: "`ABI_0` has no method named
    // `toBytesBe`" on the binding the names module holds. Each spelling is the literal's bytes.
    const literal = bytes(
      "base",
      `function main(): Uint256 { return ${BASE_AAVE_POOL}.toBytesBe(32).toBe(); }`,
    );
    for (const body of [
      "return AaveV3.Pool.toBytesBe(32).toBe();",
      "const pool = AaveV3.Pool;\nreturn pool.toBytesBe(32).toBe();",
      "return Base.AaveV3.Pool.toBytesBe(32).toBe();",
    ]) {
      expect(bytes("base", `function main(): Uint256 {\n${body}\n}`)).toEqual(literal);
    }
    expect(
      bytes("base", "function main(): Uint256 { return AaveV3.Pool.toBytesLe(20).toLe(); }"),
    ).toEqual(
      bytes("base", `function main(): Uint256 { return ${BASE_AAVE_POOL}.toBytesLe(20).toLe(); }`),
    );
    const pass = rewriteProtocolAccessors(
      "function main() { const pool = AaveV3.Pool; return pool.toBytesBe(32); }",
      BASE,
    );
    expect(pass.source).toBe(
      "function main() { const pool = AaveV3.Pool; return pool.address.toBytesBe(32); }",
    );
    // An ABI method, a value of another kind, and Solana are left as they are.
    for (const source of [
      "function main() { return AaveV3.Pool.getUserAccountData(pot); }",
      "function main(x: Uint256) { return x.toBytesBe(32); }",
      "function main() { return AaveV3.PoolAddressesProvider.toBytesBe(32); }",
    ]) {
      expect(rewriteProtocolAccessors(source, BASE).source).not.toContain(".address");
    }
    expect(
      rewriteProtocolAccessors(
        "function main() { return AaveV3.Pool.toBytesBe(32); }",
        requireChain("solana"),
      ).source,
    ).not.toContain(".address");
  });

  it("tells onContract each contract a program uses: as written, with its chain and address -- and not a test of one", () => {
    const heard: Array<[string, string, string, string]> = [];
    compileSauceProgram(
      "base",
      `function main() {
        Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0);
        USDC.approve(Cctp.TokenMessenger, 1);
        Ethereum.AaveV3.Pool.supply(1, 2, 3, 0);
        let tested = 0;
        if (AaveV3.PoolAddressesProvider) { tested = 1; }
      }`,
      {
        accessors: {
          onContract: (reference, target) =>
            heard.push([
              reference,
              target.protocol,
              target.chain.slug,
              target.address.toLowerCase(),
            ]),
        },
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
    const built = route("base", `function main() { USDC.approve(Cctp.TokenMessenger, 1000000); }`);
    expect(built.calls).toHaveLength(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("protocol accessors: every registry protocol, every contract kind", () => {
  it("a formerly unlinked protocol resolves like any other: PancakeswapV3.Factory on Base", () => {
    const source = `function main() { return PancakeswapV3.Factory.getPool(1, 2, 500); }`;
    const factory = getDescriptor("pancakeswap-v3", "Factory")!.perChainAddress[8453]!;
    const handWritten = `function main() { return IPancakeswapV3_Factory.view(${BigInt(factory)}).getPool(1, 2, 500); }`;
    const a = bytes("base", source);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(
      bytes("base", handWritten, {
        contracts: binding("IPancakeswapV3_Factory", "pancakeswap-v3", "Factory"),
      }),
    );
  });

  it("Uniswap V4's StateView and PoolManager.extsload read pool state, on every V4 chain", () => {
    const program = (stateView: string, poolManager: string) => `function main() {
      const poolId = 0x1234;
      const [sqrtPriceX96, tick, protocolFee, lpFee] = ${stateView}.getSlot0(poolId);
      const raw = ${poolManager}.extsload(poolId);
      return sqrtPriceX96 + ${stateView}.getLiquidity(poolId) + raw;
    }`;
    const contracts = {
      ...binding("IUniswapV4_StateView", "uniswap-v4", "StateView"),
      ...binding("IUniswapV4_PoolManager", "uniswap-v4", "PoolManager"),
    };
    for (const slug of getDescriptor("uniswap-v4", "StateView")!.chains) {
      const chain = requireChain(slug);
      const handWritten = program(
        `IUniswapV4_StateView.at(${deployedAt("uniswap-v4", "StateView", chain)})`,
        `IUniswapV4_PoolManager.at(${deployedAt("uniswap-v4", "PoolManager", chain)})`,
      );
      const a = bytes(slug, program("UniswapV4.StateView", "UniswapV4.PoolManager"));
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(bytes(slug, handWritten, { contracts }));
    }
    expect(getDescriptor("uniswap-v4", "StateView")!.chains).toEqual(
      getDescriptor("uniswap-v4", "PoolManager")!.chains,
    );
  });

  it("shape E: an interface is called at the address the program supplies", () => {
    const source = `function main() { return Erc4626.Vault.at(0x1234).deposit(1, ctx.self()); }`;
    const { source: rewritten, contracts, accessorSites } = rewriteProtocolAccessors(source, BASE);
    expect(rewritten).toBe(
      `function main() { return IErc4626_Vault.at(0x1234).deposit(1, ctx.self()); }`,
    );
    expect(accessorSites).toBe(1);
    expect(Object.keys(contracts)).toEqual(["IErc4626_Vault"]);
    expect(compile(rewritten, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("shape E: a deployed contract's ABI reaches another deployment, still bound .view for a view", () => {
    const source = `function main() { return UniswapV3.Factory.at(0x1234).getPool(1, 2, 500); }`;
    expect(rewriteProtocolAccessors(source, BASE).source).toBe(
      `function main() { return IUniswapV3_Factory.view(0x1234).getPool(1, 2, 500); }`,
    );
  });

  it("shape E needs a method in the same expression, and one address", () => {
    expect(() =>
      rewriteProtocolAccessors(`function main() { const v = Erc4626.Vault.at(1); }`, BASE),
    ).toThrow(/is not a value — call a method on it/);
    expect(() =>
      rewriteProtocolAccessors(`function main() { Erc4626.Vault.at(1, 2).deposit(1, 1); }`, BASE),
    ).toThrow(/takes exactly one argument/);
    expect(() =>
      rewriteProtocolAccessors(
        `function main() { AaveV3.PoolAddressesProvider.at(1).getPool(); }`,
        BASE,
      ),
    ).toThrow(/there is nothing to bind/);
  });

  it("an interface without an address is refused with the spelling that works", () => {
    expect(() =>
      compileSauceProgram("base", `function main() { return Erc4626.Vault.deposit(1, 1); }`),
    ).toThrow(
      /`Erc4626\.Vault` is an interface, with no address of its own: give it the address, `Erc4626\.Vault\(<address>\)\.deposit`/,
    );
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
    expect(viaCall.accessorSites).toBe(1);
    expect(Object.keys(viaCall.contracts)).toEqual(["IUniswapV3_Pool"]);
    expect(compile(viaCall.source, { contracts: viaCall.contracts }).bytecode[0]).toEqual(
      compile(viaAt.source, { contracts: viaAt.contracts }).bytecode[0],
    );
  });

  it("shape F takes a chain qualifier, a family alias, a nonpayable method and one output", () => {
    expect(
      rewriteProtocolAccessors(
        `function main() { return Base.Erc4626.Vault(0x1234).deposit(1, ctx.self()); }`,
        BASE,
      ).source,
    ).toBe(`function main() { return IErc4626_Vault.at(0x1234).deposit(1, ctx.self()); }`);
    expect(
      rewriteProtocolAccessors(`function main() { return Uniswap.Pool(0x1234).fee(); }`, BASE)
        .source,
    ).toBe(`function main() { return IUniswapV3_Pool.view(0x1234).fee(); }`);
    const { source, contracts } = rewriteProtocolAccessors(
      `function main(pool: Address): Uint256 { return AerodromeSlipstream.Pool(pool).slot0().sqrtPriceX96; }`,
      BASE,
    );
    expect(compile(source, { contracts }).bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("shape F needs a method in the same expression, and one address", () => {
    expect(() =>
      rewriteProtocolAccessors(`function main() { const v = UniswapV3.Pool(1); }`, BASE),
    ).toThrow(/'UniswapV3\.Pool\(\.\.\.\)' binds a contract to an address, which is not a value/);
    expect(() =>
      rewriteProtocolAccessors(`function main() { UniswapV3.Pool(1, 2).fee(); }`, BASE),
    ).toThrow(/takes exactly one argument/);
  });

  it("a deployed contract's name is never called with an address: .at binds another deployment", () => {
    const source = `function main() { return UniswapV3.Factory(0x1234).getPool(1, 2, 500); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(
      /'UniswapV3\.Factory\(\.\.\.\)' calls a deployed contract's name: .*'UniswapV3\.Factory\.at\(<address>\)\.<method>\(\.\.\.\)'/,
    );
    expect(() => compileSauceProgram("base", source)).toThrow(
      /`UniswapV3\.Factory\(…\)` calls a deployed contract's name: .*`UniswapV3\.Factory\.at\(<address>\)\.<method>\(…\)`/,
    );
  });

  it("a program's own function named like an interface is its own", () => {
    const source = `function Pool(a: Uint256): Uint256 { return a; }\nfunction main() { return Pool(1); }`;
    expect(rewriteProtocolAccessors(source, BASE).rewrote).toBe(false);
  });

  it("an address-only contract is its address in value position", () => {
    const source = `function main() { return AaveV3.PoolAddressesProvider; }`;
    expect(bytes("base", source)).toEqual(
      bytes(
        "base",
        `function main() { return ${deployedAt("aave-v3", "PoolAddressesProvider", BASE)}; }`,
      ),
    );
  });
});
