/**
 * A registry call's result, called straight on: `UniswapV3.Factory.getPool(...).liquidity()`. See
 * `src/routes/contract-results.ts`. Each chained spelling must compile to exactly the program its
 * explicit spelling does, on more than one chain, because the rewrite writes the explicit one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { requireChain } from "../src/chains/canonical.js";
import { RETURNED_CONTRACTS } from "../src/descriptors/links.js";
import { DESCRIPTORS } from "../src/descriptors/registry.js";
import { NAMESPACE_KEYS } from "../src/routes/accessor-index.js";
import { pascalOfSlug } from "../src/routes/builder.js";
import { rewriteContractResults, VALUE_METHODS } from "../src/routes/contract-results.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const BASE = requireChain("base");
const BUILTINS = JSON.parse(
  readFileSync(resolve(process.cwd(), "../skills/sauce-script/references/builtins.json"), "utf8"),
) as { intrinsics: readonly { name: string; group: string }[] };

/** Both spellings compile, on each chain, to the same bytes. */
function sameProgram(chained: string, explicit: string, chains: readonly string[]): void {
  for (const chain of chains) {
    const a = compileSauceProgram(chain, chained);
    const b = compileSauceProgram(chain, explicit);
    expect({ chain, bytecode: Array.from(a.bytecode) }).toEqual({
      chain,
      bytecode: Array.from(b.bytecode),
    });
    expect(a.bytecode.length).toBeGreaterThan(0);
  }
}

describe("a method called on a registry call's result", () => {
  it("names the pool a factory returns: byte-identical to the explicit interface call", () => {
    const chained = `function main(): Uint256 {
  return UniswapV3.Factory.getPool(WETH, USDC, 500).liquidity();
}`;
    const explicit = `function main(): Uint256 {
  return UniswapV3.Pool(UniswapV3.Factory.getPool(WETH, USDC, 500)).liquidity();
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base", "ethereum"]);
  });

  it("through a const, which stays the address", () => {
    const chained = `function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no pool");
  return pool.liquidity() + pool.fee();
}`;
    const explicit = `function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no pool");
  return UniswapV3.Pool(pool).liquidity() + UniswapV3.Pool(pool).fee();
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base", "ethereum"]);
  });

  it("nests: a pool's token is a token, and its reads are the ERC-20 ABI's", () => {
    const chained = `function main(): Uint256 {
  return UniswapV3.Factory.getPool(WETH, USDC, 500).token0().decimals();
}`;
    const explicit = `function main(): Uint256 {
  return Erc20.ERC20(UniswapV3.Pool(UniswapV3.Factory.getPool(WETH, USDC, 500)).token0()).decimals();
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base", "ethereum"]);
  });

  it("a token's writes are Token(...)'s, SafeERC20, never the ABI's unchecked transfer", () => {
    const chained = `function main(vault: Address, to: Address, amount: Uint256) {
  Erc4626.Vault(vault).asset().transfer(to, amount);
  const asset = Erc4626.Vault(vault).asset();
  asset.approve(to, amount);
}`;
    const explicit = `function main(vault: Address, to: Address, amount: Uint256) {
  Token(Erc4626.Vault(vault).asset()).transfer(to, amount);
  const asset = Erc4626.Vault(vault).asset();
  Token(asset).approve(to, amount);
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base", "ethereum"]);
    // The token pass then lowers both to `@sauce/token`'s writes.
    const lowered = compileSauceProgram("base", chained).source;
    expect(lowered).toContain("__sauce_transfer(IErc4626_Vault.view(vault).asset(), to, amount)");
    expect(lowered).toContain("__sauce_approve(asset, to, amount)");
  });

  it("a field of the record a call returns: the pair Trader Joe's factory records", () => {
    const chained = `function main(x: Address, y: Address): Uint256 {
  return TraderJoe.LBFactory.getLBPairInformation(x, y, 10).LBPair.getActiveId();
}`;
    const explicit = `function main(x: Address, y: Address): Uint256 {
  return TraderJoe.LBPair(TraderJoe.LBFactory.getLBPairInformation(x, y, 10).LBPair).getActiveId();
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["arbitrum", "avalanche"]);
  });

  it("a field through a const, and a named output of several", () => {
    const chained = `function main(pid: Uint256, who: Address): Uint256 {
  const info = Convex.Booster.poolInfo(pid);
  return info.crvRewards.earned(who) + Convex.Booster.poolInfo(pid).lptoken.balanceOf(who);
}`;
    const explicit = `function main(pid: Uint256, who: Address): Uint256 {
  const info = Convex.Booster.poolInfo(pid);
  return Convex.BaseRewardPool(info.crvRewards).earned(who) + Erc20.ERC20(Convex.Booster.poolInfo(pid).lptoken).balanceOf(who);
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["ethereum"]);
  });

  it("an element of a destructured result", () => {
    const chained = `function main(pid: Uint256, who: Address): Uint256 {
  const [lptoken, token] = Convex.Booster.poolInfo(pid);
  return lptoken.balanceOf(who) + token.balanceOf(who);
}`;
    const explicit = `function main(pid: Uint256, who: Address): Uint256 {
  const [lptoken, token] = Convex.Booster.poolInfo(pid);
  return Erc20.ERC20(lptoken).balanceOf(who) + Erc20.ERC20(token).balanceOf(who);
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["ethereum"]);
  });

  it("a deployed contract's ABI at the address returned: `.at(...)`", () => {
    const chained = `function main(): Uint256 {
  return AerodromeSlipstream.NonfungiblePositionManager.factory().tickSpacingToFee(100);
}`;
    const explicit = `function main(): Uint256 {
  return AerodromeSlipstream.CLFactory.at(AerodromeSlipstream.NonfungiblePositionManager.factory()).tickSpacingToFee(100);
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base"]);
  });

  it("a chain-qualified factory, and a bound contract's result", () => {
    const chained = `function main(pool: Address): Uint256 {
  return Base.UniswapV3.Factory.getPool(WETH, USDC, 500).fee() + UniswapV3.Pool(pool).token1().totalSupply();
}`;
    const explicit = `function main(pool: Address): Uint256 {
  return UniswapV3.Pool(Base.UniswapV3.Factory.getPool(WETH, USDC, 500)).fee() + Erc20.ERC20(UniswapV3.Pool(pool).token1()).totalSupply();
}`;
    expect(rewriteContractResults(chained, BASE).source).toBe(explicit);
    sameProgram(chained, explicit, ["base"]);
  });

  it("composes with a holder's balance read, which stays the token pass's", () => {
    const chained = `function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  return pool.liquidity() + pool.USDC + UniswapV3.Factory.getPool(WETH, USDC, 500).token0().WETH;
}`;
    const explicit = `function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  return UniswapV3.Pool(pool).liquidity() + USDC.balanceOf(pool) + WETH.balanceOf(UniswapV3.Pool(UniswapV3.Factory.getPool(WETH, USDC, 500)).token0());
}`;
    sameProgram(chained, explicit, ["base", "ethereum"]);
  });

  it("leaves the language's value methods, members that are not called, and the rest alone", () => {
    const source = `function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  const word = pool.toBytesBe(32);
  require(word.length == 32);
  return UniswapV3.Factory.getPool(WETH, USDC, 500).catch(() => { return 0; }) + pot.USDC;
}`;
    expect(rewriteContractResults(source, BASE)).toEqual({ source, rewrote: false, sites: 0 });
    expect(compileSauceProgram("base", source).bytecode.length).toBeGreaterThan(0);
  });

  it("knows every value method the language has", () => {
    const methods = BUILTINS.intrinsics
      .filter((builtin) => builtin.group === "method" && builtin.name !== ".length")
      .map((builtin) => builtin.name.slice(1));
    expect([...VALUE_METHODS].sort()).toEqual([...methods, "catch"].sort());
  });
});

describe("what the rewrite refuses", () => {
  const refusal = (source: string, chain = "base"): string => {
    try {
      compileSauceProgram(chain, source);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("compiled");
  };

  it("an address the registry does not know the contract of, naming the explicit spelling", () => {
    const message = refusal(
      `function main(): Uint256 { return Curve.AddressProvider.get_registry().pool_count(); }`,
      "ethereum",
    );
    expect(message).toContain("'Curve.AddressProvider.get_registry(...).pool_count(...)'");
    expect(message).toContain("the registry does not record which contract it is");
    expect(message).toContain("'IAbi.at(<address>).pool_count(...)'");
    // Where registry contracts have the method, their spellings are named.
    expect(
      refusal(
        `function main(): Uint256 { return Curve.AddressProvider.get_registry().liquidity(); }`,
        "ethereum",
      ),
    ).toMatch(/Name the contract at it: '\w+\.\w+\(<address>\)\.liquidity\(\.\.\.\)'/);
  });

  it("a method the contract's ABI does not have", () => {
    expect(
      refusal(
        `function main(): Uint256 { return UniswapV3.Factory.getPool(WETH, USDC, 500).liquidty(); }`,
      ),
    ).toContain("is a UniswapV3.Pool, whose ABI has no 'liquidty' (its methods: slot0, liquidity");
  });

  it("a let, which the program may reassign", () => {
    expect(
      refusal(`function main(): Uint256 {
  let pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  return pool.liquidity();
}`),
    ).toContain("declare it 'const', or name the contract 'UniswapV3.Pool(pool).liquidity(...)'");
  });

  it("a name the program declares more than once", () => {
    expect(
      refusal(`function helper(pool: Address): Uint256 {
  return pool;
}
function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  return helper(pool) + pool.liquidity();
}`),
    ).toContain("is declared more than once in the program: rename one");
  });

  it("a program that declares the name the contract would be called by", () => {
    expect(
      refusal(`function main(to: Address) {
  const Token = 1;
  UniswapV3.Factory.getPool(WETH, USDC, 500).token0().transfer(to, Token);
}`),
    ).toContain("the program declares its own 'Token'");
  });
});

describe("the table the rewrite reads", () => {
  it("names a registry contract with an ABI for every output", () => {
    const namespaces = new Set(NAMESPACE_KEYS);
    for (const link of RETURNED_CONTRACTS) {
      expect(namespaces.has(pascalOfSlug(link.returns.protocol))).toBe(true);
      const target = DESCRIPTORS.find(
        (d) => d.protocol === link.returns.protocol && d.contract === link.returns.contract,
      );
      expect(target?.kind === "interface" || target?.kind === "singleton").toBe(true);
      // And each descriptor of the function's ABI carries it on the method.
      const owners = DESCRIPTORS.filter(
        (d) => d.protocol === link.protocol && d.abiExport === link.abiExport,
      );
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) {
        const method = owner.methods.find((m) => m.signature === link.signature);
        expect(method?.returns).toContainEqual({ path: link.path, ...link.returns });
      }
    }
  });
});
