/**
 * A typed closure that opens a nested intent typechecks.
 *
 * `Base(() => { ... Ethereum(() => { ... }).reward({ ... }) })` is TypeScript the host compiles before
 * the SDK reads the closure's text, so the inner `Ethereum(...)` has to mean something to `tsc`. It
 * means the imported chain export, which carries the SauceScript call that opens an intent
 * (`SauceIntentChain`, from `source-globals.generated.ts`, the same one a `.sauce.ts` file's chains
 * extend) ahead of its host signature — as the imported `Token` carries `Token(addr)`. Nothing is
 * declared globally: a chain named in a closure comes from the same import as the host calls
 * (`routes-chain-exports-types.test.ts` pins that a bare one is an error), and the host calls keep
 * resolving to the host signature, `Parameters` and `ReturnType` included.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const ROOT = JSON.stringify(resolve(SDK, "src/index.ts"));

/** The nested-intents guide's shape, three levels deep: a measured reward and a delivery. */
const NESTED = `
import { Base, Ethereum } from ${ROOT};

const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const AMOUNT = 1_000_000n;
const built = Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    Ethereum(() => {
      USDC.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: USDC, amount }] });
    Ethereum(
      () => {
        const arrived = USDC.balanceOf(ctx.self());
        Base(() => {
          USDC.transfer(RECIPIENT, arrived);
        }).reward({ tokens: [{ token: USDC, amount: arrived }], nativeAmount: 0n });
      },
      { tokens: [{ token: USDC, amount: AMOUNT }] },
    ).reward({ tokens: [{ token: 0x4200000000000000000000000000000000000006n, amount }] });
  },
  { deadline: 2_000_000_000n, creator: "0x4444444444444444444444444444444444444444", defines: { RECIPIENT, AMOUNT } },
).reward({ source: "ethereum", deadline: 2_000_003_600n });
export const hash: string = built.hash().intentHash;
`;

/** A closure that reads a value with a registry binding and nests on it. */
const MEASURED = `
import { Base, Ethereum } from ${ROOT};

Base(
  () => {
    const got: bigint = Erc20.ERC20(USDC).balanceOf(ctx.self());
    Ethereum(() => {
      USDC.transfer(0x1n, got);
    }).reward({ tokens: [{ token: USDC, amount: got }] });
  },
  { deadline: 1n },
);
`;

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

/** What the SauceScript call refuses, as the lowering does; and its result is no host value. */
const WRONG = `
import { Ethereum, type routes } from ${ROOT};

const pending: routes.PendingSauceRoute = Ethereum(() => {});

Ethereum(() => {}).reward({ tokens: [{ token: USDC, amount: 1n }], deadline: 1n });
Ethereum(() => {}).reward({ tokens: [{ token: USDC }] });
Ethereum(() => {}, {}).reward({ tokens: [{ token: USDC, amount: 1n }] });
Ethereum(() => {}).reward({ tokens: [{ token: USDC, amount: 1n }] }).hash();
`;

/** A chain the closure does not import is not declared: the host surface is imports. */
const NOT_IMPORTED = `
import { Base } from ${ROOT};

Base(
  () => {
    Ethereum(() => {}).reward({ tokens: [{ token: USDC, amount: 1n }] });
  },
  { deadline: 1n },
);
`;

const PROBES = { NESTED, MEASURED, HOST, WRONG, NOT_IMPORTED } as const;
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

describe("a typed closure opening a nested intent", () => {
  afterAll(() => {
    program = undefined;
  });

  it("typechecks, three levels deep, with a measured reward and a delivery", () => {
    expect(messages("NESTED")).toEqual([]);
  });

  it("typechecks a value read in the closure as the nested intent's amount", () => {
    expect(messages("MEASURED")).toEqual([]);
  });

  it("leaves every host call on the host signature, its Parameters and its ReturnType", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("refuses what the lowering refuses, and a SauceScript intent used as a host one", () => {
    // A deadline in the reward, an entry with no amount, an empty delivery, a result used, and the
    // closure's call taken for a host route.
    expect(diagnostics("WRONG")).toHaveLength(5);
  });

  it("needs the chain imported: nothing is declared globally", () => {
    expect(diagnostics("NOT_IMPORTED").map((d) => d.code)).toEqual([2304]);
  });
});
