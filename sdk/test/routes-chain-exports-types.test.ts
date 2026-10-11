/**
 * The TYPE side of the chain accessors: they resolve through an IMPORT and
 * through nothing else. A probe that names `Base` bare is a real compile
 * error now (TS2304) — the ambient `declare global { const Base: ... }` this
 * file used to prove is gone, along with the runtime install that matched it.
 *
 * Deliberately still here, as the negative control's positive twin: the
 * SOURCE-only names a route BODY sees (`USDC`, `Uniswap`, `chainId` —
 * `routes/source-globals.generated.ts`) are a different mechanism and remain
 * ambient, so this file also pins that the two did not get removed together.
 *
 * This test runs the real `typescript` compiler (the same version this repo
 * builds with) over this repo's own `src/**` program, PLUS one extra probe
 * file, using `sdk/tsconfig.json`'s own compilerOptions -- so it exercises the
 * actual chain a consumer gets, not a hand-rolled subset of it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK_DIR = resolve(process.cwd());
const TSCONFIG_PATH = resolve(SDK_DIR, "tsconfig.json");
/** What the probe imports to stand in for `from "@eco-incorp/sauce"`. */
const ROOT = JSON.stringify(resolve(SDK_DIR, "src", "index.js"));

function typecheckProbe(probeSource: string): readonly ts.Diagnostic[] {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (configFile.error)
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, SDK_DIR);

  const probeDir = mkdtempSync(join(tmpdir(), "routes-chain-exports-"));
  const probePath = join(probeDir, "probe.ts");
  writeFileSync(probePath, probeSource);

  try {
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, probePath],
      options: { ...parsed.options, noEmit: true },
    });
    const probeSourceFile = program.getSourceFile(probePath);
    if (probeSourceFile === undefined)
      throw new Error("probe file was not included in the program");
    return [
      ...program.getSyntacticDiagnostics(probeSourceFile),
      ...program.getSemanticDiagnostics(probeSourceFile),
    ];
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

describe("chain accessors: the names resolve through an import, and only through one", () => {
  it("a bare `Base`/`Solana`/`chain`/`Token` with no import is a real compile error — the ambient globals are GONE", () => {
    // The whole point of the change: the host surface is imports. Note the SDK is still in this
    // program (its own src/** is), so this is not passing for want of the declarations being
    // loaded — the test below proves the source-only ambients in the same program still resolve.
    //
    // 2304 "Cannot find name" or 2552 "Cannot find name X. Did you mean Y?" — `chain` gets the
    // latter, because `chainId` IS still declared (by source-globals, the mechanism that stays).
    for (const name of ["Base", "Solana", "chain", "Token"]) {
      const diagnostics = typecheckProbe(`
        const probe: unknown = ${name};
        export {};
      `);
      expect(diagnostics.some((d) => d.code === 2304 || d.code === 2552)).toBe(true);
    }
  });

  it("the SOURCE-only route-body names are still ambient in the same program (the two mechanisms are separate)", () => {
    const diagnostics = typecheckProbe(`
      const routeBody = () => {
        require(Uniswap.UniversalRouter);
        USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
        return chainId;
      };
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an UNKNOWN name is a real compile error (the harness itself can fail)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = TotallyNotARealGlobalName;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2304)).toBe(true);
  });

  it("`import { Base }` typechecks: Base.Portal builds an intent whose program and cook are typed, not `any`", () => {
    const diagnostics = typecheckProbe(`
      import { Base, Ethereum } from ${ROOT};
      const intent = Base.hop({ source: Ethereum, send: { token: "0x1111111111111111111111111111111111111111", amount: 2n }, refundee: "0x3333333333333333333333333333333333333333", fee: 0n })
        .then(() => {});
      const bytecode: Uint8Array = intent.program.bytecode;
      const cook: { to: string; data: string; value: bigint } = intent.cook({ owner: "0x3333333333333333333333333333333333333333" }, 0n);
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: the removed Base(body).reward(...) form does not typecheck", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const x: unknown = Base("function main() { return 1n; }", {});
      const y: unknown = Base.route;
      export {};
    `);
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  // --- the native contract-accessor tree rides on the SAME import ---

  it("the imported Base ALSO carries the native accessor tree alongside .Portal -- both capabilities, one name", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const canonical: unknown = Base.UniswapV4.UniversalRouter;
      const alias: unknown = Base.Uniswap.UniversalRouter;
      const portal: unknown = Base.Portal;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an ambiguous family contract name is excluded from the imported type too (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const x: unknown = Base.Uniswap.Factory;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true); // TS2339: Property does not exist
  });

  // --- every registry protocol, typed from its ABI ---

  it("a formerly unlinked namespace is typed from its ABI: arguments, and what read() resolves to", () => {
    const diagnostics = typecheckProbe(`
      import { Base, Unichain } from ${ROOT};
      // Any viem client; the probe has no viem of its own to import the type from.
      const client = undefined as never;
      export async function probe() {
        const pool: \`0x\${string}\` = await Base.PancakeswapV3.Factory
          .getPool(Base.USDC.address, Base.WETH.address, 500)
          .read(client);
        const [sqrtPriceX96, tick, protocolFee, lpFee] = await Unichain.UniswapV4.StateView
          .getSlot0("0x0000000000000000000000000000000000000000000000000000000000001234")
          .read(client);
        const total: bigint = sqrtPriceX96;
        const fees: number = tick + protocolFee + lpFee;
        const slot: \`0x\${string}\` = await Base.UniswapV4.PoolManager.extsload("0x00").read(client);
        const hash: \`0x\${string}\` = await Base.UniswapV3.SwapRouter02.exactInputSingle({
          tokenIn: Base.USDC.address,
          tokenOut: Base.WETH.address,
          fee: 500,
          recipient: Base.USDC.address,
          amountIn: 1n,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }).write(client);
        const shares = Base.Erc4626.Vault.at(Base.USDC.address).deposit(1n, Base.USDC.address);
        return [pool, total, fees, slot, hash, shares.data] as const;
      }
    `);
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual(
      [],
    );
  });

  it("negative control: wrong argument types, a view's write, and an unbound interface are type errors", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const client = undefined as never;
      export function probe() {
        Base.PancakeswapV3.Factory.getPool(Base.USDC.address, Base.WETH.address, "500");
        Base.PancakeswapV3.Factory.getPool(Base.USDC.address, Base.WETH.address, 500).write(client);
        Base.Erc4626.Vault.deposit(1n, Base.USDC.address);
        Base.AaveV3.PoolAddressesProvider.getPool();
      }
    `);
    expect(diagnostics).toHaveLength(4);
  });

  // --- the chain's registry tokens ---

  it("Base.USDC is typed { address, decimals, symbol, chain }", () => {
    const diagnostics = typecheckProbe(`
      import { Base, Arc } from ${ROOT};
      const address: \`0x\${string}\` = Base.USDC.address;
      const decimals: number = Base.WETH.decimals;
      const symbol: string = Arc.EURC.symbol;
      const id: number = Base.USDC.chain.id;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: a token the chain has no registry row for is a type error (TS2339)", () => {
    const diagnostics = typecheckProbe(`
      import { Base, Celo } from ${ROOT};
      const usdt: unknown = Base.USDT;
      const usdc: unknown = Celo.USDC;
      export {};
    `);
    expect(diagnostics.filter((d) => d.code === 2339)).toHaveLength(2);
  });

  // --- the universal Token export ---

  it("`import { Token }` keeps the host object API, and .transfer(...).source(...) is real, not `any`", () => {
    const diagnostics = typecheckProbe(`
      import { Token } from ${ROOT};
      const call = Token.transfer({
        token: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount: 1n,
      });
      const src: string = call.source("evm");
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("the imported Token is CALLABLE — the `Token(addr)` route-body spelling typechecks in a TYPED closure, not only as source text", () => {
    // The wrapper is the headline spelling, and the `TokenFactory` intersection exists so a TYPED
    // CLOSURE body typechecks. Without it `Token` would be the object-only `TokenApi` and this is
    // TS2349 "has no call signatures" — so the rewrite would only ever fire for bodies supplied as
    // strings, and the typed form would be rejected by tsc before `rewriteTokenFactory` saw it.
    const diagnostics = typecheckProbe(`
      import { Token } from ${ROOT};
      const spender = 0x1111111111111111111111111111111111111111n;
      const addr = 0x2222222222222222222222222222222222222222n;
      Token(addr).approve(spender, 5n);
      Token(addr).transfer(spender, 5n);
      const bal: bigint = Token(addr).balanceOf(spender);
      const bound = Token(addr);
      bound.approve(spender, 5n);
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: `Token(addr)` is not `any` — an unknown method on the result is a real TS2339", () => {
    // Without this, the test above would pass just as happily if the call returned `any`.
    const diagnostics = typecheckProbe(`
      import { Token } from ${ROOT};
      const x: unknown = Token(0x1111111111111111111111111111111111111111n).nope(1n);
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true);
  });

  it("Token keeps its object API alongside the call signature — both capabilities, one export", () => {
    const diagnostics = typecheckProbe(`
      import { Token } from ${ROOT};
      const viaCall: unknown = Token(0x1111111111111111111111111111111111111111n).approve(0x2n, 1n);
      const viaApi: unknown = Token.transfer({ token: "0x1", to: "0x2", amount: 1n });
      const constant: bigint = Token.TOKEN_PROGRAM;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an unknown property on Token is a real error (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      import { Token } from ${ROOT};
      const x: unknown = Token.transfer({ token: "0x1", to: "0x2", amount: 1n }).nope;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true);
  });

  // --- the svm venue accessor tree rides on Solana's export only ---

  it("the imported Solana ALSO carries the svm venue accessor tree, alongside .Portal", () => {
    const diagnostics = typecheckProbe(`
      import { Solana } from ${ROOT};
      const programId: unknown = Solana.RaydiumCpSwap.programId;
      const swap: unknown = Solana.MeteoraDammV2.swap;
      const portal: unknown = Solana.Portal;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an EVM chain has no svm venue namespace at the TYPE level (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const x: unknown = Base.RaydiumCpSwap;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true); // TS2339: Property does not exist
  });

  it("negative control: a method the vendored ABI does not have is a real error too (never invented, never `any`)", () => {
    const diagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const x: unknown = Base.UniswapV4.UniversalRouter.exactIn;
      export {};
    `);
    // The method surface is typed from the ABI, so a name it lacks is TS2339, not `unknown`.
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true);
    const namespaceDiagnostics = typecheckProbe(`
      import { Base } from ${ROOT};
      const x: unknown = Base.UniswapV4.NotARealContract;
      export {};
    `);
    expect(namespaceDiagnostics.some((d) => d.code === 2339)).toBe(true);
  });
});
