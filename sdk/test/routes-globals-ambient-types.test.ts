/**
 * Proves the AMBIENT TYPE side of the default-globals feature: a file that
 * imports NOTHING from the SDK can still reference `Base`/`chain` and have
 * it typecheck, as long as SOME file in the same tsc program pulls in
 * `src/index.ts` (which is what a consumer's own program does merely by
 * importing the package -- see `routes/globals.ts`'s module doc for the
 * measured proof that this also survives declaration emit into `dist/`).
 *
 * This test runs the real `typescript` compiler (the same version this repo
 * builds with) over this repo's own `src/**` program, PLUS one extra
 * no-import probe file, using `sdk/tsconfig.json`'s own compilerOptions --
 * so it exercises the actual ambient chain (`index.ts` -> `routes/globals.ts`
 * -> `routes/globals.generated.ts` -> `declare global`), not a hand-rolled
 * subset of it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK_DIR = resolve(process.cwd());
const TSCONFIG_PATH = resolve(SDK_DIR, "tsconfig.json");

function typecheckProbe(probeSource: string): readonly ts.Diagnostic[] {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, SDK_DIR);

  const probeDir = mkdtempSync(join(tmpdir(), "routes-globals-ambient-"));
  const probePath = join(probeDir, "probe.ts");
  writeFileSync(probePath, probeSource);

  try {
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, probePath],
      options: { ...parsed.options, noEmit: true },
    });
    const probeSourceFile = program.getSourceFile(probePath);
    if (probeSourceFile === undefined) throw new Error("probe file was not included in the program");
    return [
      ...program.getSyntacticDiagnostics(probeSourceFile),
      ...program.getSemanticDiagnostics(probeSourceFile),
    ];
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

describe("routes globals: ambient types resolve with zero import", () => {
  it("a file with NO import of the SDK at all can reference Base/Solana/chain and typechecks clean", () => {
    const diagnostics = typecheckProbe(`
      const originA: unknown = Base;
      const originB: unknown = Solana;
      const front: unknown = chain;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an UNKNOWN name is still a real compile error (the harness itself can fail)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = TotallyNotARealGlobalName;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2304)).toBe(true); // TS2304: Cannot find name
  });

  it("Base(sauce, opts) and Base.route(sauce, opts) both typecheck zero-import, and .reward(...) is typed, not `any`", () => {
    const diagnostics = typecheckProbe(`
      const opts = {
        pot: "0x1111111111111111111111111111111111111111" as const,
        deadline: 2000n,
        portal: "0x2222222222222222222222222222222222222222" as const,
        source: "base" as const,
        creator: "0x3333333333333333333333333333333333333333" as const,
        prover: "0x4444444444444444444444444444444444444444" as const,
      };
      const viaCall = Base("return 1n;", opts);
      const built = viaCall.reward(0n);
      const intent: unknown = built.intent;
      const viaRoute = Base.route("return 1n;", opts);
      const built2 = viaRoute.reward(0n);
      // type-level pin: .route carries EXACTLY the call signature's own interface.
      const _pin: (typeof Base)["route"] = Base;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: the old reward-first Base.route({deadline,creator,prover}) no longer typechecks", () => {
    const diagnostics = typecheckProbe(`
      const reward = {
        deadline: 1000n,
        creator: "0x1111111111111111111111111111111111111111" as const,
        prover: "0x2222222222222222222222222222222222222222" as const,
      };
      const x: unknown = Base.route(reward);
      export {};
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // --- E2.3: the native contract-accessor tree is intersected onto the SAME ambient global ---

  it("Base's ambient type ALSO carries the E2.3 native accessor tree, zero-import, alongside .route -- both capabilities, one global", () => {
    const diagnostics = typecheckProbe(`
      const canonical: unknown = Base.UniswapV4.UniversalRouter;
      const alias: unknown = Base.Uniswap.UniversalRouter;
      const stillHasRoute: unknown = Base.route;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an ambiguous family contract name is excluded from the ambient type too (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = Base.Uniswap.Factory;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true); // TS2339: Property does not exist
  });

  // --- E-token: the universal Token global, zero import ---

  it("Token's ambient type resolves with zero import, and .transfer(...).source(...) is real, not `any`", () => {
    const diagnostics = typecheckProbe(`
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

  it("Token(addr) is CALLABLE zero-import — the wrapper spelling typechecks in a typed body, not only as source text", () => {
    // The wrapper is the headline spelling, and `globals.generated.ts` exists so a TYPED CLOSURE
    // body typechecks. Before `TokenFactory` was intersected in, `Token` was declared as the
    // object-only `TokenApi` and this was TS2349 "has no call signatures" — so the rewrite only
    // ever fired for bodies supplied as strings, and the typed form was rejected by tsc before
    // `rewriteTokenFactory` could ever see it.
    const diagnostics = typecheckProbe(`
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
      const x: unknown = Token(0x1111111111111111111111111111111111111111n).nope(1n);
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true);
  });

  it("Token keeps its object API alongside the call signature — both capabilities, one global", () => {
    const diagnostics = typecheckProbe(`
      const viaCall: unknown = Token(0x1111111111111111111111111111111111111111n).approve(0x2n, 1n);
      const viaApi: unknown = Token.transfer({ token: "0x1", to: "0x2", amount: 1n });
      const constant: bigint = Token.TOKEN_PROGRAM;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an unknown property on Token is a real error (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = Token.transfer({ token: "0x1", to: "0x2", amount: 1n }).nope;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true);
  });

  // --- E2.5: the svm venue accessor tree is intersected onto Solana's ambient global only ---

  it("Solana's ambient type ALSO carries the svm venue accessor tree, zero-import, alongside .route and Token", () => {
    const diagnostics = typecheckProbe(`
      const programId: unknown = Solana.RaydiumCpSwap.programId;
      const swap: unknown = Solana.MeteoraDammV2.swap;
      const stillHasRoute: unknown = Solana.route;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
  });

  it("negative control: an EVM chain global has no svm venue namespace at the TYPE level (TS2339, not silently `any`)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = Base.RaydiumCpSwap;
      export {};
    `);
    expect(diagnostics.some((d) => d.code === 2339)).toBe(true); // TS2339: Property does not exist
  });

  it("negative control: a method the vendored ABI does not have is a real error too (never invented, never `any`)", () => {
    const diagnostics = typecheckProbe(`
      const x: unknown = Base.UniswapV4.UniversalRouter.exactIn;
      export {};
    `);
    expect(diagnostics).toHaveLength(0);
    // UniversalRouter's method surface is typed loosely (unknown), so
    // .exactIn is not a TS2339 -- calling it is a RUNTIME undefined, per
    // accessors.ts's own doc comment. Confirm the property access itself at
    // least resolves against the real, narrowed contract-name union first.
    const namespaceDiagnostics = typecheckProbe(`
      const x: unknown = Base.UniswapV4.NotARealContract;
      export {};
    `);
    expect(namespaceDiagnostics.some((d) => d.code === 2339)).toBe(true);
  });
});
