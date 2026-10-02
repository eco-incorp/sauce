/**
 * `Chain.Portal.send(...).receive(...).then(...)` typechecks where it is written: inside a typed
 * closure, three levels deep, with one `{ token, amount }` or an array; and on the host, where it
 * builds the intent. A step left out or taken out of order is a type error, as is a host one
 * awaited; one that stops before its body is a statement TypeScript accepts, and is refused when it
 * compiles.
 *
 * In a closure, the chain is the imported chain export, whose `Portal` carries each SauceScript step
 * (`SauceIntentChain`, from `source-globals.generated.ts`, the same one a `.sauce.ts` file's chains
 * extend) ahead of the host's, so a SauceScript token value selects it. On the host the tokens are
 * addresses, which only the host's step takes, and `.then(body)` returns the `BuiltIntent`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const ROOT = JSON.stringify(resolve(SDK, "src/index.ts"));

/** Three levels, opened inside a host closure: one item, an array, arithmetic, a measured value. */
const NESTED = `
import { Arbitrum, Base, Optimism } from ${ROOT};

const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const AMOUNT = 1_000_000n;
const built = Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    Arbitrum.Portal.send([{ token: USDC, amount }])
      .receive([{ token: USDC, amount: (amount * 99n) / 100n }])
      .then(() => {
        const arrived = USDC.balanceOf(ctx.self());
        USDC.transfer(RECIPIENT, arrived / 2n);
        Optimism.Portal.send({ token: USDC, amount: arrived / 2n })
          .receive({ token: USDT, amount: AMOUNT })
          .then(() => {
            USDT.transfer(RECIPIENT, AMOUNT);
          });
      });
  },
  { deadline: 2_000_000_000n, defines: { RECIPIENT, AMOUNT } },
).reward({ source: "ethereum", creator: "0x4444444444444444444444444444444444444444" });
export const hash: string = built.hash().intentHash;
`;

/** The host form: addresses for tokens, the options beside each step, the intent from `.then`. */
const HOST = `
import { Base, type routes } from ${ROOT};

const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const built: routes.BuiltIntent = Base.Portal.send(
  { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: 1_010_000n },
  { source: "ethereum", creator: "0x4444444444444444444444444444444444444444" },
)
  .receive([{ token: usdc, amount: 1_000_000n }], { deadline: 2_000_000_000n })
  .then(() => {
    USDC.transfer(0x6666666666666666666666666666666666666666n, 1_000_000n);
  });
const fromSource: routes.BuiltIntent = Base.Portal.send([], { source: "ethereum" })
  .receive([], { deadline: 1n })
  .then("function main() {}");
export const all = [built.hash().intentHash, fromSource];
`;

/** Each refusal: no body, no delivery, steps out of order, a result used, and awaited. */
const WRONG = `
import { Arbitrum } from ${ROOT};

export function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).receive({ token: USDC, amount: 1n });
  Arbitrum.Portal.send({ token: USDC, amount: 1n }).then(() => {});
  Arbitrum.Portal.receive({ token: USDC, amount: 1n });
  Arbitrum.Portal.send({ token: USDC }).receive({ token: USDC, amount: 1n }).then(() => {});
  const used: bigint = Arbitrum.Portal.send({ token: USDC, amount: 1n })
    .receive({ token: USDC, amount: 1n })
    .then(() => {});
  return used;
}

export async function awaited() {
  return await Arbitrum.Portal.send({ token: "0x01", amount: 1n }).receive([], { deadline: 1n });
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

  it("typechecks in a strict closure, three levels deep, with an item or an array", () => {
    expect(messages("NESTED")).toEqual([]);
  });

  it("builds the intent on the host, its options beside each step", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("refuses an expression missing a step, out of order, used as a value, or awaited", () => {
    // [line, code]: no `.receive` (2339), `.receive` first (2339), an entry with no amount (2769),
    // a SauceScript intent's result used (2322), and a host one returned from an async function
    // (1058) and awaited (1320). The expression on line 5, which stops before its body, is a
    // statement TypeScript accepts; compiling it is refused (`routes-intent-portal.test.ts`).
    expect(diagnostics("WRONG").map((d) => [lineOf(d), d.code])).toEqual([
      [6, 2339],
      [7, 2339],
      [8, 2769],
      [9, 2322],
      [15, 1058],
      [16, 1320],
    ]);
  });
});
