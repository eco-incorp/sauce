import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { Base } from "../src/index.js";
import { CONTRACT_LINKS } from "../src/descriptors/links.js";
import { NAMESPACE_KEYS } from "../src/routes/accessor-index.js";
import { TOKEN_REGISTRY } from "../src/routes/token-registry.js";
import type { IntentOptions } from "../src/routes/intent-dsl.js";

const options: IntentOptions = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  deadline: 2_000_000_000n,
  portal: "0x2222222222222222222222222222222222222222",
  source: "ethereum",
  creator: "0x3333333333333333333333333333333333333333",
  prover: "0x4444444444444444444444444444444444444444",
  rewardDeadline: 2_000_003_600n,
};

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
  const closure = Base(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  }, options).reward(0n);
  const text = Base("USDC.approve(Uniswap.UniversalRouter, 1_000_000n);", options).reward(0n);
  expect(closure.compiled.bytecode).toEqual(text.compiled.bytecode);
  expect(closure.intent).toEqual(text.intent);
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

test("unsupported names and ABI argument shapes remain TypeScript errors", () => {
  const errors = diagnostics(`
    USDC.aproove(0x1234n, 1n);
    USDC.approve(0x1234n);
    UniswapV3.UniversalRouter.execute("0x", [], 1n);
    Uniswap.Factory;
    Uniswap.UniversalRouter.exactIn(1n);
    Uniswap.UniversalRouter.execute("0x", ["0x"], "tomorrow");
    Uniswap.UniversalRouter.at(0x1234n);
    AaveV3.Pool.supply(USDC, 1n, 0x1234n, false);
    AaveV3.PoolAddressesProvider;
    MorphoBlue.Bundler3;
    export {};
  `);
  expect(errors).toHaveLength(10);
});

test("declarations cover current registry tokens and only recognized protocol namespaces", () => {
  const generated = readFileSync(resolve("src/routes/source-globals.generated.ts"), "utf8");
  for (const symbol of new Set(
    Object.values(TOKEN_REGISTRY)
      .flat()
      .map((row) => row.symbol),
  ))
    expect(generated).toContain(`const ${symbol}: bigint & SauceTokenSource;`);
  const names = [...generated.matchAll(/^ {2}const (\w+): \w+Source;/gm)].map((match) => match[1]);
  for (const name of names) expect(NAMESPACE_KEYS.has(name)).toBe(true);
  for (const link of CONTRACT_LINKS) {
    if (link.kind === "interface") continue;
    const namespace = link.protocol
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");
    expect(names).toContain(namespace);
  }
});

test("generated source declarations are reproducible without a build", () => {
  execFileSync(process.execPath, [resolve("scripts/gen-source-globals.mjs"), "--check"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});
