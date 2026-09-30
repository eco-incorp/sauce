import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { sauceBodyToSource } from "../src/routes/closure.js";

const cctpSource = `
  Cctp.TokenMessenger.depositForBurn(1n, 3n, 1n, USDC, 0n, 0n, 1000n);
  return 1n;
`;

const tokenWritesSource = `
  USDC.approve(Uniswap.UniversalRouter, 1n);
  USDC.transfer(1n, 1n);
  return USDC.balanceOf(1n);
`;

describe("source globals match the Sauce contract model", () => {
  it("accepts scalar bytes32 CCTP arguments and excludes source-unavailable accessors", () => {
    const sdkDir = resolve(process.cwd());
    const config = ts.readConfigFile(join(sdkDir, "tsconfig.json"), ts.sys.readFile);
    if (config.error) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkDir);
    const probeDir = mkdtempSync(join(tmpdir(), "sauce-source-review-"));
    const probePath = join(probeDir, "probe.ts");
    writeFileSync(
      probePath,
      `
        function body() { ${cctpSource} }
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
        // @ts-expect-error Address-only descriptors cannot be referenced in compiled source.
        const provider: bigint = AaveV3.PoolAddressesProvider;
        // @ts-expect-error Address-only descriptors cannot be referenced through their protocol.
        const bundler: bigint = MorphoBlue.Bundler3;
        // @ts-expect-error An unbound interface has no concrete destination address.
        const token: unknown = Erc20;
        // @ts-expect-error Factory is ambiguous across Uniswap versions.
        const factory: unknown = Uniswap.Factory;
        // @ts-expect-error Even a single-member family alias requires the contract name.
        Compound.balanceOf(1n);
        export {};
      `,
    );
    try {
      const program = ts.createProgram({
        rootNames: [...parsed.fileNames, probePath],
        options: { ...parsed.options, noEmit: true },
      });
      const probe = program.getSourceFile(probePath);
      if (probe === undefined) throw new Error("typecheck probe was not loaded");
      const diagnostics = [
        ...program.getSyntacticDiagnostics(probe),
        ...program.getSemanticDiagnostics(probe),
      ];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual(
        [],
      );
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
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
