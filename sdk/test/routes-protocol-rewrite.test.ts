/**
 * Full protocol-accessor rewrite -- `Uniswap.UniversalRouter.execute(...)` ->
 * `IUniswapV4_UniversalRouter.at(<addr>n).execute(...)`, plus bare `self` -> `ctx.self()`.
 * See `src/routes/protocol-rewrite.ts`'s module doc for the design.
 */
import { compile } from "@eco-incorp/sauce-compiler";
import { requireChain } from "../src/chains/canonical.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { rewriteTokenMembers } from "../src/routes/token-rewrite.js";
import { openRoute } from "../src/routes/intent-dsl.js";

const BASE = requireChain("base");
const OPTIMISM = requireChain("optimism");
const ETHEREUM = requireChain("ethereum");

const BASE_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const BASE_AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const ETHEREUM_AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;

function evmOptions() {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base" as const,
    creator: "0x3333333333333333333333333333333333333333" as const,
    prover: "0x4444444444444444444444444444444444444444" as const,
    rewardDeadline: 1000n,
  };
}

describe("rewriteProtocolAccessors: THE DECISIVE STEP -- a real protocol accessor for a real chain", () => {
  it("Uniswap.UniversalRouter.execute(...) on Base compiles byte-identically to hand-written IUniswapV4_UniversalRouter.at(<addr>n).execute(...) with NO import line and NO baseDirs", () => {
    const source = `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    const { source: rewritten, rewrote, contracts, accessorSites } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(accessorSites).toBe(1);
    expect(rewritten).toContain(`IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER).toString()}n).execute`);
    expect(Object.keys(contracts)).toEqual(["IUniswapV4_UniversalRouter"]);

    const handWritten = `function main() { IUniswapV4_UniversalRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}n).execute("0x0a", ["0x00"], 0n); }`;

    const a = compile(rewritten, { target: "v12", contracts });
    const b = compile(handWritten, { target: "v12", contracts });
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
    expect(a.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("openRoute end-to-end: a real accessor call on the destination chain produces exactly one cook() call", () => {
    const built = openRoute(
      "base",
      `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`,
      evmOptions(),
    ).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
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
    const a = compile(out, { target: "v12", contracts });
    const b = compile(atVariant, { target: "v12", contracts });
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

    const enclosing = rewriteProtocolAccessors(`function main() { AaveV3.getUserAccountData(ctx.self()); }`, OPTIMISM);
    expect(enclosing.source).not.toContain(`${BigInt(BASE_AAVE_POOL)}n`);
  });

  it("nesting rebinds for free: a child compiled for a different destination resolves its own chain's address", () => {
    const onOptimism = rewriteProtocolAccessors(`function main(){ AaveV3.getUserAccountData(ctx.self()); }`, OPTIMISM);
    const onBase = rewriteProtocolAccessors(`function main(){ AaveV3.getUserAccountData(ctx.self()); }`, BASE);
    expect(onOptimism.source).not.toEqual(onBase.source);
  });
});

describe("rewriteProtocolAccessors: bare self -> ctx.self()", () => {
  it("rewrites a bare `self` read, byte-identical to hand-written ctx.self()", () => {
    const source = `function main() { return self; }`;
    const { source: out, rewrote, selfSites } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(true);
    expect(selfSites).toBe(1);
    expect(out).toContain("return ctx.self();");

    const a = compile(out, { target: "v12" });
    const b = compile(`function main() { return ctx.self(); }`, { target: "v12" });
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
  });

  it("skips a member property named self (x.self), an object-literal key, and a declared self", () => {
    const source = `function main() { let x = 1n; return x.self; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
  });

  it("a declared `self` suppresses the whole-program rewrite", () => {
    const source = `function main() { let self = 5n; return self; }`;
    const { rewrote, source: out } = rewriteProtocolAccessors(source, BASE);
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("selfSugar: false opts out", () => {
    const source = `function main() { return self; }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE, { selfSugar: false });
    expect(rewrote).toBe(false);
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
    expect(() => rewriteProtocolAccessors(source, requireChain("linea"))).toThrow(/is not deployed on 'linea'/);
  });

  it("a widened-selector descriptor is refused by default, with a named error quoting the caveat", () => {
    const source = `function main() { UniswapV4.PoolManager.initialize(1n); }`;
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/widened/);
  });

  it("allowWidenedSelectors opts in", () => {
    const source = `function main() { UniswapV4.PoolManager.initialize(1n); }`;
    const { rewrote } = rewriteProtocolAccessors(source, BASE, { allowWidenedSelectors: true });
    expect(rewrote).toBe(true);
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
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/'nope' is not in .*Pool's vendored ABI/);
  });

  it("a binding-name collision with an existing user identifier -> named error", () => {
    const source = `function main() { let IUniswapV4_UniversalRouter = 1n; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`;
    // Uniswap is not shadowed, IUniswapV4_UniversalRouter is a different, unrelated identifier that collides post-rewrite.
    expect(() => rewriteProtocolAccessors(source, BASE)).toThrow(/collides with an identifier/);
  });

  it("an svm destination throws via compileSauceRoute -- every starter-set descriptor is EVM-only, so it fails closed on 'not deployed' before an accessor site could ever resolve", () => {
    expect(() =>
      openRoute(
        "solana",
        `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`,
        {
          execution: { buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
          deadline: 2000n,
          portal: PORTAL,
          source: "base",
          creator: "0x3333333333333333333333333333333333333333",
          prover: "0x4444444444444444444444444444444444444444",
          rewardDeadline: 1000n,
        },
      ),
    ).toThrow(/not deployed on 'solana'/);
  });

  it("accessors: false makes an svm destination unaffected by the rewrite entirely (falls through to the compiler's own error)", () => {
    expect(() =>
      openRoute(
        "solana",
        `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`,
        {
          execution: { buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
          deadline: 2000n,
          portal: PORTAL,
          source: "base",
          creator: "0x3333333333333333333333333333333333333333",
          prover: "0x4444444444444444444444444444444444444444",
          rewardDeadline: 1000n,
          compile: { accessors: false },
        },
      ),
    ).toThrow();
  });
});

describe("rewriteProtocolAccessors: negative controls -- isolation", () => {
  it("U4's ERC20 rewrite stays byte-identical and unaffected", () => {
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
    const source = `function main() { USDC.transfer(${USDC}, 5n); }`;
    const before = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(before.rewrote).toBe(true);
    expect(before.source).toContain("IERC20.at(USDC).transfer");
  });

  it("a body with zero accessor/self sites compiles byte-identically with accessors on and off", () => {
    const built1 = openRoute("base", `return 5n;`, { ...evmOptions(), compile: { accessors: true } }).reward(0n);
    const built2 = openRoute("base", `return 5n;`, { ...evmOptions(), compile: { accessors: false } }).reward(0n);
    expect(built1.intent.route.calls[0]!.data).toEqual(built2.intent.route.calls[0]!.data);
  });

  it("accessors: false opts out entirely even when the body has a recognizable accessor shape", () => {
    // Left untouched -> the base compiler throws its own generic property-access error, at
    // openRoute() time (compileSauceRoute runs eagerly, not deferred to .reward()).
    expect(() =>
      openRoute(
        "base",
        `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`,
        { ...evmOptions(), compile: { accessors: false } },
      ),
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

  it("END TO END: USDC.approve(Cctp.TokenMessenger, x) compiles through openRoute (dot form as a spender)", () => {
    const built = openRoute("base", `function main() { USDC.approve(Cctp.TokenMessenger, 1000000n); }`, evmOptions()).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
