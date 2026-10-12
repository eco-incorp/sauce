/**
 * `Chain.hop({ send, receive, refundee, … }).then(...)` typechecks where it is written: inside a
 * typed closure, three levels deep, with an item or a list of them; and on the host, where it builds
 * the intent. A field missing, misspelled or of the wrong shape, and a step out of place, is a type
 * error, as is a host intent awaited; a hop that stops before its body is a statement TypeScript
 * accepts, and is refused when it compiles. A hop's hooks, `before` and `after`, take one closure
 * or a list of them, in a closure and as the generated `SauceHopConfig` declares them.
 *
 * The chain is the imported chain export in both: its `hop` (`host-intent.ts#ChainHop`) takes a
 * token as an address or as a SauceScript value, so a closure's
 * `Arbitrum.hop({ send: { token: USDC, amount }, refundee })` typechecks beside the host's own,
 * and `.then(body)` returns the `HostIntent`: the program and its cook. A chain's `Portal` is the
 * eco-routes Portal contract, which opens nothing.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const ROOT = JSON.stringify(resolve(SDK, "src/index.ts"));

/** Three levels, opened inside a host closure: an item or a list, arithmetic, a measured value,
 *  every field, a handler naming what the body reverted with. */
const NESTED = `
import { Arbitrum, Base, Ethereum, Optimism } from ${ROOT};

const built = Base.hop({
  source: Ethereum,
  send: [{ token: Ethereum.USDC.address, amount: 1_010_000n }, { native: 1n }],
  refundee: "0x4444444444444444444444444444444444444444",
  fee: 1_000n,
}).then(() => {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.hop({
    send: [{ token: USDC, amount }],
    receive: { token: USDC, amount: (amount * 99n) / 100n },
    refundee: 0x4444444444444444444444444444444444444444n,
    deadline: ctx.timestamp() + 3_600n,
    rewardDeadline: ctx.timestamp() + 604_800n,
    prover: 0x5555555555555555555555555555555555555555n,
    salt: 1n,
  }).then(() => {
    const arrived = USDC.balanceOf(ctx.self());
    USDC.transfer(0x6666666666666666666666666666666666666666n, arrived / 2n);
    Optimism.hop({
      send: [{ token: USDC, amount: arrived / 2n }, { native: 1n }],
      receive: [{ token: USDT, amount: arrived / 4n }, { token: USDC, amount: arrived / 4n }],
      refundee: 0x4444444444444444444444444444444444444444n,
      fee: 7n,
    })
      .then(() => {
        USDT.transfer(0x6666666666666666666666666666666666666666n, arrived / 2n);
      })
      .catch((e) => {
        USDC.transfer(0x6666666666666666666666666666666666666666n, e.length);
      });
  });
});
export const source: string = built.source;
`;

/** The host form: addresses for tokens, every field, the intent from `.then`. */
const HOST = `
import { Base, type routes } from ${ROOT};

const built: routes.HostIntent = Base.hop({
  source: "ethereum",
  send: [{ token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: 1_010_000n }, { native: 1n }],
  receive: [{ token: Base.USDC.address, amount: 1_000_000n }],
  refundee: "0x4444444444444444444444444444444444444444",
  deadline: 2_000_000_000n,
  rewardDeadline: 2_000_604_800n,
  prover: "0x5555555555555555555555555555555555555555",
  salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
  fee: 1_000n,
  compile: { intents: { salt: "0x01" } },
}).then("");
export const cook: { to: string; data: string; value: bigint } = built.cook(
  { owner: "0x4444444444444444444444444444444444444444" },
  0n,
);
`;

/** Each refusal: no reward, no refundee, a misspelled field, an item with no amount, a step after
 *  the body or before it, the chained form on a chain's `Portal`, and an awaited host intent. */
const WRONG = `
import { Arbitrum, Base } from ${ROOT};

export function main() {
  Arbitrum.hop({ receive: { token: USDC, amount: 1n }, refundee: 1n }).then(() => {});
  Arbitrum.hop({ send: { token: USDC, amount: 1n } }).then(() => {});
  Arbitrum.hop({ send: { token: USDC, amount: 1n }, refundee: 1n, recieve: [] }).then(() => {});
  Arbitrum.hop({ send: { token: USDC }, refundee: 1n }).then(() => {});
  Arbitrum.hop({ send: { token: USDC, amount: 1n }, refundee: 1n }).then(() => {}).then(() => {});
  Arbitrum.hop({ send: { token: USDC, amount: 1n }, refundee: 1n }).catch(() => {});
  Arbitrum.Portal.send({ token: USDC, amount: 1n });
  Arbitrum.hop({ send: { token: USDC, amount: 1n }, refundee: 1n });
  return 0n;
}

export async function awaited() {
  return await Base.hop({ source: "ethereum", send: [], refundee: "0x44", fee: 0n });
}
`;

/** A hop's hooks: one closure, or a list, for `before` and `after` alike — in a typed closure, and
 *  read off the generated declaration itself, as a consumer of `SauceHopConfig` reads it. */
const HOOKS = `
import { Arbitrum, Base, Ethereum } from ${ROOT};
import type { SauceHopConfig } from ${JSON.stringify(resolve(SDK, "src/routes/source-globals.generated.ts"))};

export const before: SauceHopConfig["before"] = [() => 1, () => 2];
export const after: SauceHopConfig["after"] = [() => 1];
export const one: SauceHopConfig["before"] = () => 1;

Base.hop({
  source: Ethereum,
  send: [{ token: Ethereum.USDC.address, amount: 1_010_000n }],
  refundee: "0x4444444444444444444444444444444444444444",
  fee: 1_000n,
}).then(() => {
  Arbitrum.hop({
    send: { token: USDC, amount: 1n },
    refundee: 0x4444444444444444444444444444444444444444n,
    before: [
      () => Erc20.ERC20(USDT).approve(0x5555555555555555555555555555555555555555n, 0n),
      () => Erc20.ERC20(USDT).approve(0x5555555555555555555555555555555555555555n, 5n),
    ],
    after: [() => evm.call(0x7777777777777777777777777777777777777777n, 7n, hex\`\`)],
  }).then(() => {});
  Arbitrum.hop({
    send: { token: USDC, amount: 1n },
    refundee: 0x4444444444444444444444444444444444444444n,
    before: () => Erc20.ERC20(USDC).approve(0x5555555555555555555555555555555555555555n, 5n),
    after: () => evm.call(0x7777777777777777777777777777777777777777n, 7n, hex\`\`),
  }).then(() => {});
});
`;

const PROBES = { NESTED, HOST, WRONG, HOOKS } as const;
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

describe("Chain.hop({ send, receive, refundee }).then(...)", () => {
  afterAll(() => {
    program = undefined;
  });

  it("typechecks in a strict closure, three levels deep, with an item or a list", () => {
    expect(messages("NESTED")).toEqual([]);
  });

  it("builds the intent on the host, with every field, and its cook", () => {
    expect(messages("HOST")).toEqual([]);
  });

  it("takes a hook as one closure or a list, for before and after, as the declaration says", () => {
    expect(messages("HOOKS")).toEqual([]);
  });

  it("refuses a field missing, misspelled or misshapen, a step out of place, and an awaited intent", () => {
    // [line, code]: no reward (2345), no refundee (2345), `recieve` (2561, "did you mean"), an item
    // with no amount (2322), `.then` after `.then` (2339), `.catch` before it (2339), the chained
    // form on the Portal contract (2339), and a host intent returned from an async function (1058)
    // and awaited (1320). The hop on line 12, which stops before its body, is a statement
    // TypeScript accepts; compiling it is refused (`routes-intent-portal.test.ts`).
    expect(diagnostics("WRONG").map((d) => [lineOf(d), d.code])).toEqual([
      [5, 2345],
      [6, 2345],
      [7, 2561],
      [8, 2322],
      [9, 2339],
      [10, 2339],
      [11, 2339],
      [16, 1058],
      [17, 1320],
    ]);
  });
});
