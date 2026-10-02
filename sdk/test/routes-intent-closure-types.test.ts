/**
 * A typed closure's chains are the imported chain exports, and the host calls keep resolving to the
 * host signature, `Parameters` and `ReturnType` included. Nothing is declared globally: a chain
 * named in a closure comes from the same import as the host calls (`routes-chain-exports-types.
 * test.ts` pins that a bare one is an error). An intent a closure opens, `Ethereum.Portal.send(...)
 * ...then(...)`, typechecks through the export's `Portal`: `routes-intent-portal-types.test.ts`.
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
const hostParameters: Equal<Parameters<typeof Base>, Parameters<routes.ChainRoute>> = true;
const hostReturn: Equal<ReturnType<typeof Base>, routes.PendingSauceRoute> = true;

const options: routes.IntentOptions = { deadline: 1n };
const fromSource: routes.PendingSauceRoute = Base("function main() { return 1n; }", options);
const fromClosure: routes.PendingSauceRoute = Base(() => {}, options);
const withTokens: routes.PendingSauceRoute = Base(() => {}, {
  deadline: 1n,
  tokens: [{ token: "0x4444444444444444444444444444444444444444", amount: 1n }],
});
const nested = Base(() => {}, options)
  .nest((on) => Ethereum("function main() { return 1n; }", options).reward({ source: on }))
  .reward({ source: "ethereum", creator: "0x4444444444444444444444444444444444444444" });
const viaRoute: routes.PendingSauceRoute = Base.route(() => {}, options);
const parameter: Parameters<typeof Base>[1] = options;
const returned: ReturnType<typeof Base> = fromClosure;
export const all = [fromSource, withTokens, nested, viaRoute, parameter, returned, hostParameters, hostReturn];
`;

/** A chain the closure does not import is not declared: the host surface is imports. */
const NOT_IMPORTED = `
import { Base } from ${ROOT};

Base(
  () => {
    Ethereum.Portal.send({ token: USDC, amount: 1n }).creator(0x44n).receive().then(() => {});
  },
  { deadline: 1n },
);
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

  it("leaves every host call on the host signature, its Parameters and its ReturnType", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("needs the chain imported: nothing is declared globally", () => {
    expect(diagnostics("NOT_IMPORTED").map((d) => d.code)).toEqual([2304]);
  });
});
