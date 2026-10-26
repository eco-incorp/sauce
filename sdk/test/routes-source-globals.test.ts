import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { Base } from "../src/index.js";
import { CONTRACT_LINKS } from "../src/descriptors/links.js";
import { NAMESPACE_KEYS } from "../src/routes/accessor-index.js";
import { SVM_VENUE_NAMESPACES } from "../src/routes/svm-venue-methods.js";
import { TOKEN_REGISTRY } from "../src/routes/token-registry.js";
import { sauceBodyToSource } from "../src/routes/closure.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

/** A typed closure's program, compiled for Base with Base's names. */
const onBase = (body: string | (() => unknown)): Uint8Array =>
  compileSauceProgram("base", typeof body === "string" ? body : sauceBodyToSource(body)).bytecode;

function diagnostics(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "sauce-source-types-"));
  try {
    const file = join(dir, "consumer.ts");
    // A NAMED import of `Token`, not a bare one: `Token` is an ordinary export now, while the
    // route-body names below it (`USDC`, `Uniswap`, `chainId`) are ambient and ride along on the
    // module merely being in the program. Unused in probes that don't call it, which draws no
    // diagnostic here (`noUnusedLocals` is off).
    writeFileSync(
      file,
      `import { Token } from ${JSON.stringify(resolve("src/index.ts"))};\n${source}`,
    );
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      // The probe imports `src/index.ts` by absolute path; a VALUE import of a `.ts` path needs
      // this (a bare side-effect import did not), and `noEmit` above is what makes it legal.
      allowImportingTsExtensions: true,
    });
    return program
      .getSemanticDiagnostics(program.getSourceFile(file))
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("token/protocol closures compile identically to the same source text", () => {
  const closure = onBase(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  });
  const text = onBase("USDC.approve(Uniswap.UniversalRouter, 1_000_000n);");
  expect(closure).toEqual(text);
  // These names have compile-time meaning only. Importing typings must not
  // invent global runtime clients or eagerly bind them to one chain.
  expect(Object.hasOwn(globalThis, "USDC")).toBe(false);
  expect(Object.hasOwn(globalThis, "Uniswap")).toBe(false);
  // Nor does the HOST surface land there: `Base`/`Token` are imports, not globals.
  expect(Object.hasOwn(globalThis, "Base")).toBe(false);
  expect(Object.hasOwn(globalThis, "Token")).toBe(false);
});

test("ABI-derived protocol methods, address values, and ambient chain identity typecheck", () => {
  expect(
    diagnostics(`
    const routeBody = () => {
      USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
      Token(USDC).transfer(0x1234n, 1n);
      UniswapV4.UniversalRouter.execute("0x0a", ["0x00"], 2_000_000_000n);
      Cctp.TokenMessenger.depositForBurn(1n, 6n, 0x1234n, USDC, 0n, 0n, 1000n);
      const address: bigint = Uniswap.UniversalRouter;
      const balance: bigint = USDC.balanceOf(address);
      const account = AaveV3.getUserAccountData(address);
      const debt: bigint = account.totalDebtBase;
      const indexed: bigint = account[1];
      return balance + debt + indexed + chainId + CHAIN_ID;
    };
    export {};
  `),
  ).toEqual([]);
});

test("an output the registry knows the contract of is typed as that contract", () => {
  expect(
    diagnostics(`
    const routeBody = () => {
      const liquidity: bigint = UniswapV3.Factory.getPool(USDC, WETH, 500n).liquidity();
      const pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
      const decimals: bigint = pool.token0().decimals();
      pool.token1().transfer(0x1234n, 1n);
      const active: bigint = TraderJoe.LBFactory.getLBPairInformation(USDC, WETH, 10n).LBPair.getActiveId();
      const earned: bigint = Convex.Booster.poolInfo(9n).crvRewards.earned(pool);
      const fee: bigint = AerodromeSlipstream.NonfungiblePositionManager.factory().tickSpacingToFee(100n);
      return liquidity + decimals + active + earned + fee + pool;
    };
    export {};
  `),
  ).toEqual([]);
  // A method the contract lacks, a token write's result (SafeERC20 returns nothing), and a method on
  // an address the registry does not know the contract of.
  const errors = diagnostics(`
    UniswapV3.Factory.getPool(USDC, WETH, 500n).liquidty();
    const sent: boolean = UniswapV3.Pool(0x1234n).token0().transfer(0x1234n, 1n);
    Curve.AddressProvider.get_registry().pool_count();
    export {};
  `);
  expect(errors).toHaveLength(3);
});

test("unsupported names and ABI argument shapes remain TypeScript errors", () => {
  const errors = diagnostics(`
    USDC.aproove(0x1234n, 1n);
    USDC.approve(0x1234n);
    UniswapV3.UniversalRouter.execute("0x", [], 1n);
    Uniswap.Factory;
    Uniswap.UniversalRouter.exactIn(1n);
    Uniswap.UniversalRouter.execute("0x", ["0x"], "tomorrow");
    Uniswap.UniversalRouter.at("0x1234");
    AaveV3.Pool.supply(USDC, 1n, 0x1234n, false);
    AaveV3.PoolAddressesProvider.getPool();
    MorphoBlue.Bundler3.at(0x1234n);
    PancakeswapV3.Factory.getPool(USDC, WETH);
    Erc4626.Vault.deposit(1n, 1n);
    export {};
  `);
  expect(errors).toHaveLength(12);
});

test("declarations cover every registry token and every protocol namespace, in both languages", () => {
  const generated = readFileSync(resolve("src/routes/source-globals.generated.ts"), "utf8");
  for (const symbol of new Set(
    Object.values(TOKEN_REGISTRY)
      .flat()
      .map((row) => row.symbol),
  ))
    expect(generated).toContain(`const ${symbol}: bigint & SauceTokenSource;`);
  // Compiled source: one global per namespace the rewrite resolves, and one per Solana venue
  // protocol that is no namespace, no more and no fewer.
  const names = [...generated.matchAll(/^ {2}const (\w+): (\w+)Source;/gm)]
    .filter((match) => !match[2]!.endsWith("SvmVenues"))
    .map((match) => match[1]);
  expect(new Set(names)).toEqual(new Set(NAMESPACE_KEYS));
  // Each Solana venue, its protocol then its program: a field of its protocol's own global, or of
  // the namespace or family of that name (`Pancakeswap.CLMM`), typed for an exact input where its
  // swap is one (`Meteora.DLMM`), else with its `pool` by the key it finds pools by (`Phoenix.Market`
  // has none), a whirlpool's taking its fee tier after its tick spacing.
  for (const [venue, { exact, key, refinement }] of Object.entries(SVM_VENUE_NAMESPACES)) {
    const [protocol, program] = venue.split(".") as [string, string];
    const global = new RegExp(`^ {2}const ${protocol}: (\\w+)Source;`, "m").exec(generated);
    expect(global).not.toBeNull();
    const fields = new RegExp(`export interface ${global![1]}Source[^{]*\\{([^}]*)\\}`).exec(
      generated,
    )![1];
    const type = exact
      ? "Exact"
      : key === "fee"
        ? "Fee"
        : refinement === "feeTierIndex"
          ? "Tier"
          : key === "tick spacing"
            ? "Spacing"
            : "";
    expect(fields).toContain(`readonly ${program}: SauceSvm${type}VenueSource;`);
  }
  for (const link of CONTRACT_LINKS) {
    const namespace = link.protocol
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");
    expect(names).toContain(namespace);
  }
  // TypeScript host: the same namespaces on `ChainContracts`, as the runtime tree has them.
  const host = readFileSync(resolve("src/descriptors/contracts.generated.ts"), "utf8");
  const tree = /export interface ChainContracts \{\n([\s\S]*?)\n\}/.exec(host)![1]!;
  const hostNames = [...tree.matchAll(/^ {2}readonly (\w+): \w+;/gm)].map((match) => match[1]);
  expect(new Set(hostNames)).toEqual(new Set(NAMESPACE_KEYS));
  expect(new Set(Object.keys(Base).filter((key) => NAMESPACE_KEYS.has(key)))).toEqual(
    new Set(NAMESPACE_KEYS),
  );
});

test("a typed closure over a formerly unlinked namespace typechecks and compiles", () => {
  const body = `
      let pool = 0n;
      if (PancakeswapV3.Factory) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
      }
      const [sqrtPriceX96, tick] = UniswapV4.StateView.getSlot0(0x1234n);
      return pool + sqrtPriceX96 + AerodromeSlipstream.CLFactory.getPool(USDC, WETH, 100n);
  `;
  expect(diagnostics(`const routeBody = () => {${body}};\nexport {};`)).toEqual([]);
  // The same body as a closure, compiled for a chain with every name in it.
  const closure = onBase(() => {
    let pool = 0n;
    if (PancakeswapV3.Factory) {
      pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
    }
    const [sqrtPriceX96] = UniswapV4.StateView.getSlot0(0x1234n);
    return pool + sqrtPriceX96 + AerodromeSlipstream.CLFactory.getPool(USDC, WETH, 100n);
  });
  // Each contract is called at Base's address for it, which the bytecode carries.
  const bytecode = Buffer.from(closure).toString("hex");
  for (const contract of [Base.PancakeswapV3.Factory, Base.AerodromeSlipstream.CLFactory]) {
    expect(bytecode).toContain(contract.address!.slice(2).toLowerCase());
  }
});

test("the global declarations do not collide with the DOM and ES libraries a consumer loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "sauce-source-libs-"));
  try {
    const file = join(dir, "consumer.ts");
    writeFileSync(file, `import ${JSON.stringify(resolve("src/index.ts"))};\nexport {};\n`);
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      noEmit: true,
      strict: true,
      allowImportingTsExtensions: true,
    });
    const generatedFile = program.getSourceFile(resolve("src/routes/source-globals.generated.ts"));
    expect(generatedFile).toBeDefined();
    expect(
      program
        .getSemanticDiagnostics(generatedFile)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    ).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generated source declarations are reproducible without a build", () => {
  execFileSync(process.execPath, [resolve("scripts/gen-source-globals.mjs"), "--check"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});
