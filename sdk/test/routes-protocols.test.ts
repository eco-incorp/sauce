/**
 * Protocol namespaces in a program — `Uniswap.UniversalRouter.execute(...)`, `Cctp.TokenMessenger`,
 * `Base.AaveV3.Pool` — resolved by the compiler from the extensions manifest (`extensions.ts`).
 *
 * The claims are byte claims against the program written out by hand: a namespace call compiles to
 * exactly the ABI-bound call at the chain's address, and a namespace value to that address. Each
 * reference the registry cannot honour is refused with the registry's reason, where it is written.
 */
import { getDescriptor } from "../src/descriptors/query.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceRoute, type SauceCompileOptions } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;

const BASE_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const BASE_AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const ETHEREUM_AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

const bytecode = (chain: string, source: string, options: SauceCompileOptions = {}): string =>
  Buffer.from(
    compileSauceRoute(chain, source, { pot: POT, engine: ENGINE }, options).compiled.bytecode[0]!,
  ).toString("hex");

/** `source` on `chain`, with the descriptor `protocol`/`contract`'s ABI bound as `binding` — the
 *  program a namespace reference is held to. */
function handWritten(
  chain: string,
  source: string,
  binding: string,
  protocol: string,
  contract: string,
): string {
  const abi = getDescriptor(protocol, contract)!.abi as never;
  return bytecode(chain, source, { contracts: { [binding]: { abi } } });
}

/** The last located message of a refused program, and the text it covers. */
function refusal(
  chain: string,
  source: string,
  options: SauceCompileOptions = {},
): { message: string; covers: string } {
  try {
    bytecode(chain, source, options);
  } catch (error) {
    const located = (
      error as {
        diagnostics?: { message: string; start: { offset: number }; end: { offset: number } }[];
      }
    ).diagnostics?.at(-1);
    if (located === undefined) throw error;
    return {
      message: located.message,
      covers: source.slice(located.start.offset, located.end.offset),
    };
  }
  throw new Error(`\`${source}\` compiled`);
}

describe("a namespace call is the ABI-bound call at the chain's address", () => {
  it("Uniswap.UniversalRouter.execute(...) on Base, as written out by hand", () => {
    expect(
      bytecode(
        "base",
        `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`,
      ),
    ).toBe(
      handWritten(
        "base",
        `function main() { IRouter.at(${BigInt(BASE_UNIVERSAL_ROUTER)}n).execute("0x0a", ["0x00"], 0n); }`,
        "IRouter",
        "uniswap-v4",
        "UniversalRouter",
      ),
    );
  });

  it("openRoute end to end: one cook() call", () => {
    const built = openRoute("base", `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`, {
      pot: POT,
      engine: ENGINE,
      deadline: 2000n,
      portal: "0x2222222222222222222222222222222222222222",
      source: "base",
      creator: "0x3333333333333333333333333333333333333333",
      prover: "0x4444444444444444444444444444444444444444",
      rewardDeadline: 1000n,
    }).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
  });

  it("<Protocol>.<method> calls the protocol's one deployed contract", () => {
    expect(
      bytecode("base", "function main() { return AaveV3.getUserAccountData(ctx.self()); }"),
    ).toBe(
      handWritten(
        "base",
        `function main() { return IPool.at(${BigInt(BASE_AAVE_POOL)}n).getUserAccountData(ctx.self()); }`,
        "IPool",
        "aave-v3",
        "Pool",
      ),
    );
  });

  it("a chain-qualified reference reaches the named chain's deployment, from any chain", () => {
    const onEthereum = handWritten(
      "optimism",
      `function main() { return IPool.at(${BigInt(ETHEREUM_AAVE_POOL)}n).getUserAccountData(ctx.self()); }`,
      "IPool",
      "aave-v3",
      "Pool",
    );
    expect(
      bytecode(
        "optimism",
        "function main() { return Ethereum.AaveV3.Pool.getUserAccountData(ctx.self()); }",
      ),
    ).toBe(onEthereum);
    expect(
      bytecode(
        "optimism",
        "function main() { return Ethereum.AaveV3.getUserAccountData(ctx.self()); }",
      ),
    ).toBe(onEthereum);
  });

  it("the same reference is a different address on another chain", () => {
    const program = "function main() { return AaveV3.Pool.getUserAccountData(ctx.self()); }";
    expect(bytecode("base", program)).not.toBe(bytecode("ethereum", program));
  });

  it("an interface is called at the address the program supplies", () => {
    expect(
      bytecode(
        "base",
        "function main() { return Erc4626.Vault.at(0x1234n).deposit(1n, ctx.self()); }",
      ),
    ).toBe(
      handWritten(
        "base",
        "function main() { return IVault.at(0x1234n).deposit(1n, ctx.self()); }",
        "IVault",
        "erc4626",
        "Vault",
      ),
    );
  });
});

describe("a namespace value is the contract's address", () => {
  it("Cctp.TokenMessenger is the address the underscore spelling gives", () => {
    expect(bytecode("base", "function main(): Uint256 { return Cctp.TokenMessenger; }")).toBe(
      bytecode("base", "function main(): Uint256 { return Cctp_TokenMessenger; }"),
    );
  });

  it("Base.Uniswap.UniversalRouter is Base's address, from another chain", () => {
    expect(
      bytecode("ethereum", "function main(): Uint256 { return Base.Uniswap.UniversalRouter; }"),
    ).toBe(bytecode("ethereum", `function main(): Uint256 { return ${BASE_UNIVERSAL_ROUTER}; }`));
  });

  it("an address-only contract is its address", () => {
    const address = getDescriptor("aave-v3", "PoolAddressesProvider")!.perChainAddress[8453]!;
    expect(
      bytecode("base", "function main(): Uint256 { return AaveV3.PoolAddressesProvider; }"),
    ).toBe(bytecode("base", `function main(): Uint256 { return ${address}; }`));
  });
});

describe("what the registry cannot honour is refused where it is written", () => {
  it("a contract the protocol does not have", () => {
    const { message, covers } = refusal(
      "base",
      "function main() { UniswapV3.NotAContract.method(1n); }",
    );
    expect(message).toMatch(/`UniswapV3` has no `NotAContract`/);
    expect(covers).toBe("NotAContract");
  });

  it("a contract this chain does not deploy, with the chains that do", () => {
    expect(
      refusal("linea", "function main() { AaveV3.getUserAccountData(ctx.self()); }").message,
    ).toBeDefined();
    expect(
      refusal("optimism", "function main(): Uint256 { return PancakeswapV3.Factory; }").message,
    ).toMatch(/^Contract 'Factory' \(pancakeswap-v3\) is not deployed on 'optimism' \(available: /);
  });

  it("an ambiguous family name", () => {
    expect(refusal("base", "function main() { Uniswap.Factory.method(1n); }").message).toMatch(
      /"Factory" is ambiguous under Uniswap/,
    );
  });

  it("a method the vendored ABI does not have", () => {
    expect(() => bytecode("base", "function main() { AaveV3.Pool.nope(1n); }")).toThrow(
      /`AaveV3.Pool` has no method named `nope`/,
    );
  });

  it("a protocol on an svm destination", () => {
    expect(
      refusal(
        "solana",
        `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`,
      ).message,
    ).toMatch(/not deployed on 'solana'/);
  });

  it("accessors: false gives the program no protocol names at all", () => {
    expect(
      refusal(
        "base",
        `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`,
        {
          accessors: false,
        },
      ),
    ).toEqual({ message: "`Uniswap` is not a declared variable", covers: "Uniswap" });
  });

  it("a name the program declares is the program's", () => {
    expect(() =>
      bytecode("base", "function main(): Uint256 { const Uniswap = 7n; return Uniswap; }"),
    ).not.toThrow();
  });
});

describe("a widened ABI", () => {
  // No registry ABI is widened any more, so the gate is exercised by marking a real descriptor
  // widened. The manifest is built per set of options, so each case asks with options no earlier
  // compile used (a distinct token override), and reads the descriptor as it is now.
  function whileWidened<T>(run: () => T): T {
    const coverage = getDescriptor("uniswap-v4", "PoolManager")!.coverage as {
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
  const program = "function main() { UniswapV4.PoolManager.initialize(1n); }";

  it("is refused by default, quoting its caveat", () => {
    whileWidened(() =>
      expect(
        refusal("base", program, {
          tokens: { WIDENED_A: "0x0000000000000000000000000000000000000001" },
        }).message,
      ).toMatch(/widened.*synthetic/),
    );
  });

  it("allowWidenedSelectors calls it anyway", () => {
    whileWidened(() =>
      expect(
        () =>
          bytecode("base", program, {
            tokens: { WIDENED_B: "0x0000000000000000000000000000000000000001" },
            accessors: { allowWidenedSelectors: true },
          }),
        // Past the gate: what is left is the call's own arity.
      ).toThrow(/expects 2 argument\(s\)/),
    );
  });

  it("an exact descriptor needs no opt-in", () => {
    expect(() => bytecode("base", program)).toThrow(/expects 2 argument\(s\)/);
  });
});

describe("a bare self", () => {
  it("is the account the program runs as", () => {
    expect(() =>
      bytecode("base", "function main(): Uint256 { return ctx.balance(self); }"),
    ).not.toThrow();
  });

  it("a declared self is the program's", () => {
    expect(bytecode("base", "function main(): Uint256 { const self = 7n; return self; }")).toBe(
      bytecode("base", "function main(): Uint256 { const other = 7n; return other; }"),
    );
  });

  it("selfSugar: false gives the program none", () => {
    expect(
      refusal("base", "function main(): Uint256 { return ctx.balance(self); }", {
        accessors: { selfSugar: false },
      }).message,
    ).toBe("`self` is not a declared variable");
  });
});
