/**
 * `Chain.Portal.send(...)[modifiers].receive(...)[modifiers].then(...)` typechecks where it is
 * written: inside a typed closure, three levels deep, with items as arguments, one list of them or
 * none; and on the host, where it builds the intent. A step left out or taken out of order, and a modifier
 * repeated or after the wrong step, is a type error — each step's type drops the modifiers already
 * given — as is a host intent awaited; one that stops before its body is a statement TypeScript
 * accepts, and is refused when it compiles.
 *
 * The chain is the imported chain export in both: its `Portal` (`intent-dsl.ts#ChainPortal`) takes a
 * token as an address or as a SauceScript value, so a closure's `Arbitrum.Portal.send({ token: USDC,
 * amount })` typechecks beside the host's own, and `.then(body)` returns the `BuiltIntent`. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const ROOT = JSON.stringify(resolve(SDK, "src/index.ts"));

/** Three levels, opened inside a host closure: items as arguments, a list, none, arithmetic, a
 *  measured value, modifiers in any order. */
const NESTED = `
import { Arbitrum, Base, Ethereum, Optimism } from ${ROOT};

const built = Base.Portal.send({ token: Ethereum.USDC.address, amount: 1_010_000n }, { native: 1n })
  .source(Ethereum)
  .creator("0x4444444444444444444444444444444444444444")
  .receive()
  .fee(1_000n)
  .then(() => {
    const amount = USDC.balanceOf(ctx.self());
    Arbitrum.Portal.send([{ token: USDC, amount }])
      .creator(0x4444444444444444444444444444444444444444n)
      .deadline(ctx.timestamp() + 604_800n)
      .prover(0x5555555555555555555555555555555555555555n)
      .receive([{ token: USDC, amount: (amount * 99n) / 100n }])
      .salt(1n)
      .deadline(ctx.timestamp() + 3_600n)
      .then(() => {
        const arrived = USDC.balanceOf(ctx.self());
        USDC.transfer(0x6666666666666666666666666666666666666666n, arrived / 2n);
        Optimism.Portal.send({ token: USDC, amount: arrived / 2n }, { native: 1n })
          .creator(0x4444444444444444444444444444444444444444n)
          .receive({ token: USDT, amount: arrived / 4n }, { token: USDC, amount: arrived / 4n })
          .fee(7n)
          .then(() => {
            USDT.transfer(0x6666666666666666666666666666666666666666n, arrived / 2n);
          });
      });
  });
export const hash: string = built.hash().intentHash;
`;

/** The host form: addresses for tokens, every modifier, the intent from `.then`. */
const HOST = `
import { Base, Ethereum, type routes } from ${ROOT};

const built: routes.BuiltIntent = Base.Portal.send([
  { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: 1_010_000n },
  { native: 1n },
])
  .creator("0x4444444444444444444444444444444444444444")
  .deadline(2_000_604_800n)
  .source("ethereum")
  .prover("0x5555555555555555555555555555555555555555")
  .receive([{ token: Base.USDC.address, amount: 1_000_000n }])
  .fee(1_000n)
  .deadline(2_000_000_000n)
  .salt("0x0000000000000000000000000000000000000000000000000000000000000001")
  .nest((on) =>
    Ethereum.Portal.send([]).source(on).creator("0x44").receive([]).fee(0n).then("function main() {}"),
  )
  .then("function main() {}");
export const all = [built.hash().intentHash];
`;

/** Each refusal: no `.receive`, steps out of order, a modifier repeated or in the wrong stage, an
 *  entry with no amount, a SauceScript intent's result used, and an awaited host one. */
const WRONG = `
import { Arbitrum, Base } from ${ROOT};

export function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).receive({ token: USDC, amount: 1n });
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).then(() => {});
  Arbitrum.Portal.receive({ token: USDC, amount: 1n });
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).creator(1n).creator(2n);
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).receive([]).deadline(1n).deadline(2n);
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).salt(1n);
  Arbitrum.Portal.send({ token: USDC }).receive({ token: USDC, amount: 1n }).then(() => {});
  return 0n;
}

export async function awaited() {
  return await Base.Portal.send([]).source("ethereum").creator("0x44").receive([]).fee(0n);
}
`;

const PROBES = { NESTED, HOST, WRONG } as const;
type Probe = keyof typeof PROBES;

const dir = mkdtempSync(join(tmpdir(), "sauce-intent-portal-types-"));
const files = Object.fromEntries(
  Object.entries(PROBES).map(([name, source]) => {
    const file = join(dir, `${name}.ts`);
    writeFileSync(file, source);
    return [name, file];
  }),
) as Record<Probe, string>;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let program: ts.Program | undefined;
function diagnostics(probe: Probe): readonly ts.Diagnostic[] {
  program ??= ts.createProgram(Object.values(files), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    lib: ["lib.es2022.d.ts"],
    types: [],
  });
  return program.getSemanticDiagnostics(program.getSourceFile(files[probe]));
}
const messages = (probe: Probe) =>
  diagnostics(probe).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
/** The line a diagnostic is on, 1-based. */
const lineOf = (d: ts.Diagnostic) => d.file!.getLineAndCharacterOfPosition(d.start!).line + 1;

describe("Chain.Portal.send(...).receive(...).then(...)", () => {
  afterAll(() => {
    program = undefined;
  });

  it("typechecks in a strict closure, three levels deep, with items as arguments or a list", () => {
    expect(messages("NESTED")).toEqual([]);
  });

  it("builds the intent on the host, with every modifier and a nested child", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("refuses a step left out, out of order, repeated or misplaced, and an awaited intent", () => {
    // [line, code]: no `.then` (2339), `.receive` first (2339), `.creator` twice (2339), the
    // route's `.deadline` twice (2339), `.salt` after `.send` (2339), an entry with no amount
    // (2345), and a host intent returned from an async function (1058) and awaited (1320). The
    // expression on line 5, which stops before its body, is a statement TypeScript accepts;
    // compiling it is refused (`routes-intent-portal.test.ts`).
    expect(diagnostics("WRONG").map((d) => [lineOf(d), d.code])).toEqual([
      [6, 2339],
      [7, 2339],
      [8, 2339],
      [9, 2339],
      [10, 2339],
      [11, 2345],
      [15, 1058],
      [16, 1320],
    ]);
  });
});
