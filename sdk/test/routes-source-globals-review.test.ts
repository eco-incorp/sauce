import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { sauceBodyToSource } from "../src/routes/closure.js";

const cctpSource = `function main() {
  Cctp.TokenMessenger.depositForBurn(1n, 3n, 1n, USDC, 0n, 0n, 1000n);
  return 1n;
}`;

const tokenWritesSource = `function main() {
  USDC.approve(Uniswap.UniversalRouter, 1n);
  USDC.transfer(1n, 1n);
  return USDC.balanceOf(1n);
}`;

/**
 * The diagnostics of a TypeScript probe in the SDK's own project, whose options are `strict`:
 * `noImplicitAny` is on, so an undeclared key of a host closure's contract is an error.
 */
function probeDiagnostics(probe: string): string[] {
  const sdkDir = resolve(process.cwd());
  const config = ts.readConfigFile(join(sdkDir, "tsconfig.json"), ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkDir);
  expect(parsed.options.strict).toBe(true);
  const probeDir = mkdtempSync(join(tmpdir(), "sauce-source-review-"));
  const probePath = join(probeDir, "probe.ts");
  writeFileSync(probePath, probe);
  try {
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, probePath],
      options: { ...parsed.options, noEmit: true },
    });
    const sourceFile = program.getSourceFile(probePath);
    if (sourceFile === undefined) throw new Error("typecheck probe was not loaded");
    return [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

describe("source globals match the Sauce contract model", () => {
  it("accepts scalar bytes32 CCTP arguments and excludes source-unavailable accessors", () => {
    expect(
      probeDiagnostics(`
        ${cctpSource}
        // TokenMessengerV2.depositForBurn returns nothing.
        const burned: void = Cctp.depositForBurn(1n, 3n, 1n, USDC, 0n, 0n, 1000n);
        // ERC-20 writes have SafeERC20 semantics: each reverts unless the token accepted it, so
        // there is no ABI boolean to return.
        const approved: void = USDC.approve(Uniswap.UniversalRouter, 1n);
        const transferred: void = USDC.transfer(1n, 1n);
        const pulled: void = USDC.transferFrom(1n, 1n, 1n);
        // @ts-expect-error A token write returns nothing, not the typed call's bool.
        const ok: boolean = USDC.transfer(1n, 1n);
        // Dynamic bytes use hex string source literals.
        Uniswap.UniversalRouter.execute("0x", [], 2000n);
        const amounts = UniswapV2.Router.getAmountsOut(1n, [USDC, WETH]);
        const count: bigint = amounts.length;
        const first: bigint = amounts[0];
        const liquidity = Aave.Pool.getUserAccountData(1n);
        const debt: bigint = liquidity.totalDebtBase;

        // @ts-expect-error Fixed bytes32 is a Sauce scalar, not dynamic bytes.
        Cctp.depositForBurn(1n, 3n, "0x01", USDC, 0n, 0n, 1000n);
        // @ts-expect-error ERC-20 source addresses are Sauce scalars, not byte strings.
        USDC.approve("0x1111111111111111111111111111111111111111", 1n);
        // @ts-expect-error ERC-20 transfer recipients are Sauce scalars too.
        USDC.transfer("0x1111111111111111111111111111111111111111", 1n);
        // @ts-expect-error ERC-20 balance owners are Sauce scalars too.
        USDC.balanceOf("0x1111111111111111111111111111111111111111");
        // An address-only contract is its address: no ABI, so no methods.
        const provider: bigint = Paraswap.AugustusV6;
        const bundler: bigint = MorphoBlue.Bundler3;
        // @ts-expect-error An address-only contract has no methods to call.
        Paraswap.AugustusV6.getPool();
        // An interface has no address of its own: it is called at one the program supplies.
        const shares: bigint = Erc4626.Vault.at(1n).deposit(1n, 1n);
        // @ts-expect-error An unbound interface is not an address.
        const vault: bigint = Erc4626.Vault;
        // A deployed contract's ABI reaches another deployment the same way.
        const other: bigint = UniswapV3.Factory.at(1n).getPool(USDC, WETH, 500n);
        // A namespace for every registry protocol, not only the formerly linked ones.
        const pancake: bigint = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
        const clPool: bigint = AerodromeSlipstream.CLFactory.getPool(USDC, WETH, 100n);
        // A name is tested itself, decided when the program compiles: a contract or a token.
        const has: boolean = PancakeswapV3.Factory != 0n && USDT != 0n;
        // @ts-expect-error There is no presence call: a program tests the name itself.
        available(PancakeswapV3.Factory);
        // @ts-expect-error Factory is ambiguous across Uniswap versions.
        const factory: unknown = Uniswap.Factory;
        // @ts-expect-error Even a single-member family alias requires the contract name.
        Compound.balanceOf(1n);
        export {};
      `),
    ).toEqual([]);
  });

  it("types a function called by its canonical signature in a strict host closure", () => {
    expect(
      probeDiagnostics(`
        const GET_POOL = "getPool(address,address,uint24)";
        // An ordinary function, by its signature: on the contract, at another address, through a const.
        const pool: bigint = UniswapV3.Factory["getPool(address,address,uint24)"](USDC, WETH, 500n);
        const liquidity: bigint = UniswapV3.Factory["getPool(address,address,uint24)"](USDC, WETH, 500n).liquidity();
        const other: bigint = UniswapV3.Factory.at(1n)["getPool(address,address,uint24)"](USDC, WETH, 500n);
        const factory = UniswapV3.Factory;
        const aliased: bigint = factory["getPool(address,address,uint24)"](USDC, WETH, 500n);
        const keyed: bigint = UniswapV3.Factory[GET_POOL](USDC, WETH, 500n);
        // A function the ABI leaves out by arity, by its signature only.
        Permit2.Permit2["permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"](
          { permitted: [{ token: USDC, amount: 1n }], nonce: 0n, deadline: 0n },
          [{ to: 1n, requestedAmount: 1n }],
          1n,
          "0x",
        );
        // @ts-expect-error An address argument is a Sauce scalar, not a byte string.
        UniswapV3.Factory["getPool(address,address,uint24)"](USDC, WETH, "0x01");
        // @ts-expect-error getPool takes three arguments.
        UniswapV3.Factory["getPool(address,address,uint24)"](USDC, WETH);
        // @ts-expect-error No function of the factory has this signature.
        UniswapV3.Factory["getPool(address,address,uint32)"](USDC, WETH, 500n);
        export {};
      `),
    ).toEqual([]);
  });

  it("compiles the same scalar bytes32 call through the actual route compiler", () => {
    const result = compileSauceRoute("base", cctpSource, {
      pot: "0x1111111111111111111111111111111111111111",
      engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    expect(result.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("compiles token writes and reads identically from a typed closure and source text", () => {
    const body = () => {
      USDC.approve(Uniswap.UniversalRouter, 1n);
      USDC.transfer(1n, 1n);
      return USDC.balanceOf(1n);
    };
    const execution = {
      pot: "0x1111111111111111111111111111111111111111" as const,
      engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const,
    };
    const closure = compileSauceRoute("base", sauceBodyToSource(body), execution);
    const source = compileSauceRoute("base", tokenWritesSource, execution);
    expect(closure.compiled.bytecode).toEqual(source.compiled.bytecode);
  });
});
