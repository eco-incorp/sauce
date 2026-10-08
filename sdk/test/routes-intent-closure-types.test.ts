/**
 * A typed closure's chains are the imported chain exports, and the host calls keep resolving to the
 * host signature: `hop` and the `HostIntent` its `then` returns. Nothing is declared globally: a
 * chain named in a closure comes from the same import as the host calls
 * (`routes-chain-exports-types.test.ts` pins that a bare one is an error). An intent a closure
 * opens, `Ethereum.hop({ send, refundee }).then(...)`, typechecks through the export's `hop`:
 * `routes-intent-portal-types.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const ROOT = JSON.stringify(resolve(SDK, "src/index.ts"));

/** Every host form still resolves to the host signature, and its types are the host's. */
const HOST = `
import { Base, Ethereum, type routes } from ${ROOT};

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const hop: Equal<typeof Base.hop, routes.ChainHop> = true;

const received = Base.hop({ source: Ethereum, send: { token: "0x4444444444444444444444444444444444444444", amount: 1n }, refundee: "0x4444444444444444444444444444444444444444", compile: { defines: { RECIPIENT: 1n } } });
const fromSource: routes.HostIntent = received.then("USDC.transfer(RECIPIENT, 1);");
const fromClosure: routes.HostIntent = Base.hop({ source: "ethereum", send: [], receive: { token: "0x4444444444444444444444444444444444444444", amount: 1n }, refundee: "0x4444444444444444444444444444444444444444", fee: 0n })
  .then(() => {});
export const all = [fromSource, fromClosure, hop];
`;

/** A chain the closure does not import is not declared: the host surface is imports. */
const NOT_IMPORTED = `
import { Base } from ${ROOT};

Base.hop({ source: "base", send: [], refundee: "0x4444444444444444444444444444444444444444" })
  .then(() => {
    Ethereum.hop({ send: { token: USDC, amount: 1n }, refundee: 0x44n }).then(() => {});
  });
`;

const PROBES = { HOST, NOT_IMPORTED } as const;
type Probe = keyof typeof PROBES;

const dir = mkdtempSync(join(tmpdir(), "sauce-intent-closure-types-"));
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

describe("a typed closure's chains", () => {
  afterAll(() => {
    program = undefined;
  });

  it("leaves every host call on the host signature: the hop and the intent it builds", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("needs the chain imported: nothing is declared globally", () => {
    expect(diagnostics("NOT_IMPORTED").map((d) => d.code)).toEqual([2304]);
  });
});
