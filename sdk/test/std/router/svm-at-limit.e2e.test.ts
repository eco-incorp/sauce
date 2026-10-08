/**
 * `@sauce/router`'s Solana arm at a pool's own limit, executed: each `try…AtLimit` and `…AtLimit`
 * function, each instruction-only `…Cpi`, and Manifest's, compiled into a program that calls it once
 * on one pool, staged and cooked through the released Kitchen on the harness Pot, against the venues'
 * own mainnet programs and the pools' mainnet accounts (`svm/venue-fixture.ts`). It proves what the
 * library's header says:
 *
 *   - for every swap eco-incorp/sauce-recipes builds for the fixture's pools
 *     (`fixtures/recipes-swap-templates.json`, both ways, the served window-bounded one and the plain
 *     one), the venue receives the same instruction, byte for byte and account for account, from the
 *     recipes' own hand-built CPI, from that CPI with `…Data`'s data, from `…Cpi` given that account
 *     list, and from `try…AtLimit` given the pool's slot — read back from the transaction's inner
 *     instructions — and all four move the same amounts; `…Cpi` returns what the paying account
 *     paid, `try…AtLimit` what the recipient received;
 *   - a `try…AtLimit` returns 0 having moved nothing for every skip its header names, its plain form
 *     reverts there, and a swap below its floor reverts, the venue's own floor first where it has one;
 *   - Raydium's bitmap extension is optional, a Crema slot of fewer arrays passes fewer, Phoenix and
 *     OpenBook trade at a price as well as at any, an adaptive-fee Orca pool trades at a limit, and
 *     Invariant's program refuses an input past its limit rather than stopping there;
 *   - and what each costs in compute beside the hand-built CPI, small and to the pool's window edge:
 *     printed as tables. `…Data` and `…Cpi` are compiled for the one trade, every argument but the
 *     amount a literal, as the hand-built CPI's own bytes carry them and as a router compiling one
 *     program per trade writes them.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { readFileSync } from "node:fs";
import { AccountRole, getAddressCodec, getCompiledTransactionMessageDecoder } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import type { TransactionMetadata } from "litesvm";

import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  routerSvmAccounts,
} from "../../../src/svm/index.js";
import {
  describeSvm,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  setTokenAccount,
  stageProgram,
  startEngine,
  tokenAmount,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import {
  allIn,
  BYTES,
  key,
  LAYOUT,
  le,
  loadVenues,
  manifest,
  MEMO,
  pool,
  restoreVenues,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
} from "../../svm/venue-fixture.js";
import type { Pool } from "../../svm/venue-fixture.js";
import {
  SVM_MORE,
  SVM_SLOT,
  svmCpiArguments,
  svmDataArguments,
  svmProgramCalling,
} from "./harness.js";

type Compiled = ReturnType<typeof compileSauceProgram>;
interface Meta {
  address: Address;
  role: AccountRole;
}
type Edit = { address: Address; offset: number; bytes: number[] };
/** The venue's own instruction, as the transaction carried it: its data and accounts, in order. */
interface Cpi {
  data: string;
  accounts: Address[];
}
type Outcome =
  | {
      ok: true;
      /** What `main` returned: the function's own count. */
      returned: bigint;
      /** What the recipient's balance gained, and the paying account's lost, read from the bank. */
      received: bigint;
      paid: bigint;
      /** The whole cook's compute, and the venue's own (its instruction and the CPIs it makes). */
      units: number;
      venueUnits: number;
      cpi?: Cpi;
      /** Every fixture account the cook changed. */
      changed: Address[];
    }
  | { ok: false; reason: string; logs: string[]; cpi?: Cpi };

interface Template {
  pool: string;
  venue: string;
  direction: string;
  builder: "buildSwapV2" | "buildBakedCpiSwap";
  programId: Address;
  prefix: string;
  suffix: string;
  divisor?: string;
  accounts: { ref: string; address: Address | null; writable: boolean; signer: boolean }[];
}
const TEMPLATES = (
  JSON.parse(
    readFileSync(new URL("./fixtures/recipes-swap-templates.json", import.meta.url), "utf8"),
  ) as { templates: Template[] }
).templates;

/** What the paying account holds beside the amount offered: never offered, never spent. */
const KEPT = 7n;
const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const leBytes = (value: bigint, width: number): string => {
  let out = "";
  for (let i = 0; i < width; i++)
    out += ((value >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0");
  return out;
};
const leHex = (hex: string, offset: number, width: number): bigint =>
  le(Buffer.from(hex, "hex"), offset, width);
const addressAt = (data: Uint8Array, offset: number): Address =>
  getAddressCodec().decode(data.subarray(offset, offset + 32));
const signed32 = (value: bigint): bigint => (value >= 1n << 31n ? value - (1n << 32n) : value);

/** Each venue's function name, where its pool keeps its two mints (the first paid by the first of
 *  its directions) and, a concentrated-liquidity pool, its current tick. */
const VENUE: Record<
  string,
  { fn: string; mints: [number, number]; tick?: number; price?: number; liquidity?: number }
> = {
  "raydium-clmm": { fn: "RaydiumClmm", mints: [73, 105], tick: 269, price: 253, liquidity: 237 },
  "pancakeswap-clmm": {
    fn: "PancakeswapClmm",
    mints: [73, 105],
    tick: 269,
    price: 253,
    liquidity: 237,
  },
  byreal: { fn: "Byreal", mints: [73, 105], tick: 269, price: 253, liquidity: 237 },
  "stabble-clmm": { fn: "StabbleClmm", mints: [73, 105], tick: 269, price: 253, liquidity: 237 },
  "orca-whirlpool": { fn: "OrcaWhirlpool", mints: [101, 181], tick: 81, price: 65, liquidity: 49 },
  cropper: { fn: "Cropper", mints: [101, 181], tick: 81, price: 65, liquidity: 49 },
  defituna: { fn: "Defituna", mints: [11, 43], tick: 183, price: 167, liquidity: 151 },
  crema: { fn: "Crema", mints: [40, 72], tick: 206, price: 190, liquidity: 174 },
  phoenix: { fn: "Phoenix", mints: [48, 128] },
  invariant: { fn: "Invariant", mints: [8, 40], tick: 218, price: 202, liquidity: 186 },
  manifest: { fn: "Manifest", mints: [16, 48] },
  "openbook-v2": { fn: "OpenbookV2", mints: [576, 608] },
};
const FIRST = new Set(["0to1", "aToB", "baseIn", "xToY"]);
const lower = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
const tryName = (venue: string): string =>
  venue === "manifest" ? "tryManifest" : `try${VENUE[venue]!.fn}AtLimit`;
const cpiName = (venue: string): string => `${lower(VENUE[venue]!.fn)}Cpi`;
/** A template's `…Data` function: Orca's classic `swap` takes eleven accounts, `swap_v2` fifteen. */
const dataName = (t: Template): string =>
  t.venue === "orca-whirlpool" && t.accounts.length !== 11
    ? "orcaWhirlpoolV2Data"
    : `${lower(VENUE[t.venue]!.fn)}Data`;
/** The direction arguments, written into a program compiled for one trade. */
const DIRECTIONS = new Set(["aToB", "xToY", "paysBase"]);

/** A pool's two mints, the one paid first. */
const pairOf = (p: Pool, direction: string): [Address, Address] => {
  const [a, b] = VENUE[p.venue]!.mints;
  const data = BYTES.get(p.pool)!;
  const mints: [Address, Address] = [addressAt(data, a), addressAt(data, b)];
  return FIRST.has(direction) ? mints : [mints[1], mints[0]];
};
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
/** An amount a pool trades well inside the tick arrays its slot carries: ten whole tokens, ten of
 *  BONK's thousand-token lots. */
const amountOf = (mint: Address): bigint =>
  mint === BONK ? 10n ** 9n : 10n * 10n ** BigInt(BYTES.get(mint)![44]!);

/** A template's role, without the recipes' slot prefix or a bounded swap's suffix. */
const role = (ref: string): string => ref.replace(/^s0:/, "").replace(/:bounded$/, "");
/**
 * The slot `@sauce/router` takes for a template's pool, read off the recipes' own account roles:
 * the nine, then any past them (Raydium's bitmap extension; Invariant's authority; OpenBook's
 * oracles). A role a template lacks is the System program.
 */
const slotOf = (t: Template): Address[] => {
  const by = new Map(t.accounts.map((a) => [role(a.ref), a.address!]));
  const at = (name: string): Address => by.get(name) ?? SYSTEM;
  const firstPays = FIRST.has(t.direction);
  switch (t.venue) {
    case "raydium-clmm":
    case "pancakeswap-clmm":
    case "byreal":
    case "stabble-clmm":
      return [
        t.programId,
        at("pool"),
        at("cfg"),
        at(firstPays ? "iv" : "ov"),
        at(firstPays ? "ov" : "iv"),
        at("obs"),
        at("ta0"),
        at("ta1"),
        at("ta2"),
        at("bmx"),
      ];
    case "orca-whirlpool":
    case "cropper":
      return [
        t.programId,
        at("pool"),
        SYSTEM,
        at("va"),
        at("vb"),
        at("orc"),
        at("ta0"),
        at("ta1"),
        at("ta2"),
      ];
    case "defituna":
      return [
        t.programId,
        at("pool"),
        SYSTEM,
        at("va"),
        at("vb"),
        SYSTEM,
        at("ta0"),
        at("ta1"),
        at("ta2"),
      ];
    case "crema":
      return [
        t.programId,
        at("pool"),
        at("cfg"),
        at("va"),
        at("vb"),
        at("tam"),
        at("ta0"),
        at("ta1"),
        at("ta2"),
      ];
    case "phoenix":
      return [
        t.programId,
        at("mkt"),
        at("log"),
        at("bv"),
        at("qv"),
        SYSTEM,
        SYSTEM,
        SYSTEM,
        SYSTEM,
      ];
    case "invariant":
      return [
        t.programId,
        at("pool"),
        at("state"),
        at("rx"),
        at("ry"),
        at("tickmap"),
        at("t0"),
        at("t1"),
        at("t2"),
        at("auth"),
      ];
    case "manifest":
      return [
        t.programId,
        at("mkt"),
        at("sys"),
        at("bv"),
        at("qv"),
        SYSTEM,
        SYSTEM,
        SYSTEM,
        SYSTEM,
      ];
    case "openbook-v2":
      return [
        t.programId,
        at("mkt"),
        at("auth"),
        at("bv"),
        at("qv"),
        at("eh"),
        at("bids"),
        at("asks"),
        at("sp"),
        at("oa"),
        at("ob"),
      ];
    default:
      throw new Error(`no slot for ${t.venue}`);
  }
};

/** What a template's instruction carries past its amount: its limit, floor and orders. */
const carried = (t: Template): { limit: bigint; floor: bigint; orders: bigint } => {
  const s = t.suffix;
  switch (t.venue) {
    case "phoenix":
      expect(t.prefix.slice(6, 8)).toBe("00"); // no price: the book at any price
      return { limit: 0n, floor: 0n, orders: 0n };
    case "invariant":
      return { limit: leHex(s, 1, 16), floor: 0n, orders: 0n };
    case "manifest":
      return { limit: 0n, floor: leHex(s, 0, 8), orders: 0n };
    case "openbook-v2":
      expect(s.slice(-4, -2)).toBe("03"); // a market order
      return { limit: 0n, floor: 0n, orders: BigInt(`0x${s.slice(-2)}`) };
    default:
      return { limit: leHex(s, 8, 16), floor: leHex(s, 0, 8), orders: 0n };
  }
};

describeSvm("@sauce/router's Solana arm at a pool's own limit", () => {
  const programs = new Map<string, Compiled>();
  const compiled = (source: string): Compiled => {
    let program = programs.get(source);
    if (program === undefined) {
      program = compileSauceProgram("solana", source);
      programs.set(source, program);
    }
    return program;
  };
  let harness: EngineHarness;
  let nonce = 0n;

  beforeAll(async () => {
    // A little after the latest read: a whirlpool refuses a clock before its last update, and the
    // pools added after the fixture's own slot were read later.
    const latest = Math.max(
      manifest.unixTimestamp,
      ...manifest.pools.map((p) => p.unixTimestamp ?? 0),
    );
    harness = await startEngine(BigInt(latest) + 60n);
    loadVenues(harness.svm);
  }, 120_000);

  /** The first inner instruction the cook made into `program`, its accounts read off the message. */
  const cpiInto = (
    meta: TransactionMetadata,
    messageBytes: Parameters<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>[0],
    tables: AddressesByLookupTableAddress,
    program: Address,
  ): Cpi | undefined => {
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as {
      staticAccounts: Address[];
      addressTableLookups?: {
        lookupTableAddress: Address;
        writableIndexes: number[];
        readonlyIndexes: number[];
      }[];
    };
    const lookups = message.addressTableLookups ?? [];
    const keys = [
      ...message.staticAccounts,
      ...lookups.flatMap((l) => l.writableIndexes.map((i) => tables[l.lookupTableAddress]![i]!)),
      ...lookups.flatMap((l) => l.readonlyIndexes.map((i) => tables[l.lookupTableAddress]![i]!)),
    ];
    for (const inner of meta.innerInstructions().flat()) {
      const ix = inner.instruction();
      if (keys[ix.programIdIndex()] !== program) continue;
      return { data: hexOf(ix.data()), accounts: [...ix.accounts()].map((i) => keys[i]!) };
    }
    return undefined;
  };

  /**
   * Cooks `program` with `named` accounts (by `main`'s names, each with the role the transaction
   * gives it) and `args`, from the fixture's state with `edit` applied: `source` holding `amountIn`
   * and `KEPT` of `pay`, `recipient` none of `buy`, both the Pot's, under `main`'s names `source` and
   * `recipient` unless `named` says otherwise.
   */
  const cook = async (
    program: Compiled,
    order: {
      named: Record<string, Meta>;
      args: bigint[];
      pay: Address;
      buy: Address;
      amountIn: bigint;
      venue: Address;
      source: Address;
      recipient: Address;
      edit?: Edit;
    },
  ): Promise<Outcome> => {
    restoreVenues(harness.svm, order.edit);
    setTokenAccount(harness, order.source, order.pay, harness.pot, order.amountIn + KEPT);
    setTokenAccount(harness, order.recipient, order.buy, harness.pot, 0n);
    const resolved: Record<string, Meta> = {
      source: { address: order.source, role: AccountRole.WRITABLE },
      recipient: { address: order.recipient, role: AccountRole.WRITABLE },
      ...order.named,
    };
    const tail = program.manifest!.accounts.map((entry) => {
      if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
      const meta = resolved[entry.name];
      if (meta === undefined) throw new Error(`no account for ${entry.name}`);
      return meta;
    });
    const encoded = encodeEntryArguments(program, order.args);
    const payload = new Uint8Array(program.bytecode.length + encoded.length);
    payload.set(program.bytecode);
    payload.set(encoded, program.bytecode.length);
    nonce += 1n;
    // Staged, its accounts through a lookup table: as `sauce run` cooks a program past one
    // transaction.
    const staged = await stageProgram(harness, payload, nonce);
    const instructions: Instruction[] = [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      buildCookFromAccountInstruction({
        kitchen: harness.kitchen,
        owner: harness.payer.address,
        codeBuffer: staged.codeBuffer,
        code: staged.code,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        feeConfig: harness.feeConfig,
        maxExecutionFee: 0n,
        tail,
      }),
    ];
    const keys = [
      ...new Set([
        harness.kitchen,
        harness.programId,
        harness.pot,
        harness.feeConfig,
        staged.codeBuffer,
        staged.code,
        ...tail.map((meta) => meta.address),
      ]),
    ].filter((at) => at !== harness.payer.address);
    const lookupTables = fabricateAlt(harness, keys);
    harness.svm.expireBlockhash();
    const transaction = await buildExecuteTransaction({
      payer: harness.payer,
      instructions,
      latestBlockhash: {
        blockhash: harness.svm.latestBlockhash(),
        lastValidBlockHeight: 1_000_000n,
      },
      lookupTables,
    });
    const result = harness.svm.sendTransaction(transaction);
    if (result instanceof FailedTransactionMetadata) {
      const meta = result.meta();
      return {
        ok: false,
        reason: new TextDecoder().decode(meta.returnData().data()),
        logs: meta.logs(),
        cpi: cpiInto(meta, transaction.messageBytes, lookupTables, order.venue),
      };
    }
    const returned = BigInt(
      `0x${Buffer.from(result.returnData().data().subarray(0, 32)).toString("hex")}`,
    );
    // The venue's own instruction finishes last of its invocations (a venue's CPIs into itself,
    // Phoenix's log, finish first).
    const consumed = result
      .logs()
      .map((line) => line.match(new RegExp(`^Program ${order.venue} consumed (\\d+) of`)))
      .filter((match) => match !== null);
    const changed = [...BYTES].flatMap(([at, data]) => {
      const now = harness.svm.getAccount(at);
      return now.exists && Buffer.from(now.data).equals(Buffer.from(data)) ? [] : [at];
    });
    return {
      ok: true,
      returned,
      received: tokenAmount(harness, order.recipient),
      paid: order.amountIn + KEPT - tokenAmount(harness, order.source),
      units: Number(result.computeUnitsConsumed()),
      venueUnits: consumed.length === 0 ? 0 : Number(consumed.at(-1)![1]),
      cpi: cpiInto(result, transaction.messageBytes, lookupTables, order.venue),
      changed,
    };
  };

  const succeeded = (outcome: Outcome): Extract<Outcome, { ok: true }> => {
    if (!outcome.ok)
      throw new Error(`the cook failed: ${outcome.reason}\n${outcome.logs.join("\n")}`);
    return outcome;
  };
  const failed = (outcome: Outcome): Extract<Outcome, { ok: false }> => {
    if (outcome.ok) throw new Error("the cook succeeded; expected a refusal");
    return outcome;
  };
  /** The venue's own failure, as its program logged it. */
  const venueFailure = (outcome: Outcome, venue: Address): string[] =>
    outcome.ok ? [] : outcome.logs.filter((line) => line.startsWith(`Program ${venue} failed:`));

  /**
   * The four ways a template's swap is sent, from one state: the recipes' own hand-built CPI, the
   * same CPI with `…Data`'s data, `…Cpi` on the template's account list, and `try…AtLimit` on the
   * pool's slot (Manifest: `tryManifest`), each with `amountIn` of the mint the template's direction
   * pays. The two instruction-only forms are compiled for the one trade, as the hand-built one is:
   * every argument but the amount a literal.
   */
  const ways = (t: Template, amountIn: bigint) => {
    const p = pool(t.pool);
    const [pay, buy] = pairOf(p, t.direction);
    const source = randomAddress();
    const recipient = randomAddress();
    const owner = harness.pot;
    const accountAt = (a: Template["accounts"][number]): Address =>
      a.ref === "user:owner"
        ? owner
        : a.ref === "user:in"
          ? source
          : a.ref === "user:out"
            ? recipient
            : a.address!;
    const roleOf = (a: Template["accounts"][number]): AccountRole =>
      a.writable ? AccountRole.WRITABLE : AccountRole.READONLY;
    const { limit, floor, orders } = carried(t);
    const first = FIRST.has(t.direction) ? 1n : 0n;
    const order = { pay, buy, amountIn, venue: t.programId, source, recipient };
    const expected: Cpi = {
      data: `${t.prefix}${leBytes(amountIn / BigInt(t.divisor ?? "1"), 8)}${t.suffix}`,
      accounts: t.accounts.map(accountAt),
    };
    const listed = {
      program: { address: t.programId, role: AccountRole.READONLY },
      ...Object.fromEntries(
        t.accounts.map((a, i) => [`a${i}`, { address: accountAt(a), role: roleOf(a) }]),
      ),
    };

    // The recipes' own CPI, hand-built from the template: its fixed bytes around the amount, its
    // accounts as main's.
    const names = t.accounts.map((_, i) => `a${i}`);
    const payIndex = t.accounts.findIndex((a) => a.ref === "user:in");
    const hand = (edit?: Edit) =>
      cook(
        compiled(
          `function main(\n  program: Account,\n${names.map((n) => `  ${n}: Account<Writable>,`).join("\n")}\n  amountIn: Uint256,\n): Uint256 {\n` +
            `  const prefix = hex\`${t.prefix}\`;\n  const suffix = hex\`${t.suffix}\`;\n` +
            `  const amount = amountIn / ${t.divisor ?? "1"};\n` +
            `  const data = prefix.concat(amount.toBytesLe(8), suffix);\n` +
            `  const before = svm.sload(a${payIndex}, 64, 8).toLe();\n` +
            `  svm.call(program, [${names.join(", ")}], data);\n` +
            `  return before - svm.sload(a${payIndex}, 64, 8).toLe();\n}\n`,
        ),
        { ...order, args: [amountIn], named: listed, edit },
      );

    // `…Data` and `…Cpi` on the same account list. A book's lot sizes are its market's.
    const market = BYTES.get(p.pool)!;
    const value = (arg: string, minOut: bigint, lim = limit): bigint =>
      ({
        amountIn,
        limit: lim,
        ticks: 0n,
        priceLots: 0n,
        orders,
        minOut,
        lot: BigInt(t.divisor ?? "1"),
        baseLot: t.venue === "openbook-v2" ? le(market, 456, 8) : 0n,
        quoteLot: t.venue === "openbook-v2" ? le(market, 448, 8) : 0n,
      })[arg]!;
    // Compiled for the one trade: every argument but the amount written into the program, as the
    // template's own bytes carry them.
    const instructionOnly = (name: string, args: string[], minOut: bigint, lim = limit) =>
      cook(
        compiled(
          svmProgramCalling(
            name,
            t.accounts.length,
            Object.fromEntries(
              args
                .filter((arg) => arg !== "amountIn")
                .map((arg) => [
                  arg,
                  DIRECTIONS.has(arg) ? String(first === 1n) : String(value(arg, minOut, lim)),
                ]),
            ),
          ),
        ),
        { ...order, args: [amountIn], named: listed },
      );
    const fn = cpiName(t.venue);
    const viaCpi = (minOut = floor, lim = limit) =>
      instructionOnly(fn, svmCpiArguments(fn), minOut, lim);
    const viaData = (minOut = floor, lim = limit) =>
      instructionOnly(dataName(t), svmDataArguments(dataName(t)), minOut, lim);
    // OpenBook's data in lots, divided as a program compiled for the one trade divides them: the side
    // paid from the amount by its lot size, the other the most an order may take, each a literal but
    // the amount.
    const viaLotsData = () => {
      const most = 0x7fffffffffffffffn;
      const [baseLot, quoteLot] = [value("baseLot", floor), value("quoteLot", floor)];
      const names = t.accounts.map((_, i) => `a${i}`);
      const lots =
        first === 1n
          ? `amountIn / ${baseLot}, ${most / quoteLot}`
          : `${most / baseLot}, amountIn / ${quoteLot}`;
      return cook(
        compiled(
          `import { openbookV2LotsData } from "@sauce/router";\n` +
            `function main(\n  program: Account,\n  source: Account<Writable>,\n` +
            names.map((n) => `  ${n}: Account<Writable>,\n`).join("") +
            `  amountIn: Uint256,\n): Uint256 {\n` +
            `  const data = openbookV2LotsData(${lots}, 0, ${orders}, ${first === 1n});\n` +
            `  const held = svm.sload(source, 64, 8).toLe();\n` +
            `  svm.call(program, [${names.join(", ")}], data);\n` +
            `  return held - svm.sload(source, 64, 8).toLe();\n}\n`,
        ),
        { ...order, args: [amountIn], named: listed },
      );
    };

    // `try…AtLimit` on the pool's slot, each account with the role the recipes give it.
    const slot = slotOf(t);
    const writable = new Set(t.accounts.filter((a) => a.writable).map(accountAt));
    const tryArgs =
      t.venue === "manifest"
        ? [amountIn, floor]
        : t.venue === "openbook-v2"
          ? [amountIn, 0n, orders, floor]
          : [amountIn, limit, floor];
    const viaTry = (
      overrides: {
        name?: string;
        slot?: Address[];
        args?: bigint[];
        edit?: Edit;
        buyMint?: Address;
      } = {},
    ) => {
      const s = overrides.slot ?? slot;
      const metaOf = (address: Address): Meta => ({
        address,
        role: writable.has(address) ? AccountRole.WRITABLE : AccountRole.READONLY,
      });
      return cook(compiled(svmProgramCalling(overrides.name ?? tryName(t.venue), s.length - 9)), {
        ...order,
        args: overrides.args ?? tryArgs,
        edit: overrides.edit,
        named: {
          ...Object.fromEntries(
            [...SVM_SLOT, ...SVM_MORE].slice(0, s.length).map((name, j) => [name, metaOf(s[j]!)]),
          ),
          authority: metaOf(owner),
          payMint: { address: pay, role: AccountRole.READONLY },
          buyMint: { address: overrides.buyMint ?? buy, role: AccountRole.READONLY },
          tokenProgram: { address: TOKEN, role: AccountRole.READONLY },
          token2022: { address: TOKEN_2022, role: AccountRole.READONLY },
          memo: { address: MEMO, role: AccountRole.READONLY },
        },
      });
    };
    return {
      p,
      pay,
      buy,
      expected,
      hand,
      viaData,
      viaLotsData,
      viaCpi,
      viaTry,
      slot,
      tryArgs,
      limit,
      floor,
    };
  };

  // -----------------------------------------------------------------------------------------
  // Byte for byte, the recipes' own instruction, four ways
  // -----------------------------------------------------------------------------------------

  /** The compute of each template's swaps, for the tables, and the templates a venue refuses. */
  const units: {
    template: Template;
    size: string;
    ticks: string;
    venue: number;
    hand: number;
    data: number;
    cpi: number;
    tried: number;
    /** The same pool's `try<Venue>` at a price a few basis points past the pool's own. */
    priced?: number;
  }[] = [];
  const refusedByVenue: string[] = [];
  /** OpenBook's swaps through `openbookV2LotsData`, their cook's compute beside the hand-built one. */
  const lotsUnits: string[] = [];

  /** How far a concentrated-liquidity pool's tick moved in the last cook, read off the bank. */
  const tickMoved = (p: Pool): string => {
    const at = VENUE[p.venue]!.tick;
    const now = harness.svm.getAccount(p.pool);
    if (at === undefined || !now.exists) return "";
    const moved = signed32(le(now.data, at, 4)) - signed32(le(BYTES.get(p.pool)!, at, 4));
    return String(moved < 0n ? -moved : moved);
  };

  describe("each swap the recipes build reaches the venue byte for byte: by hand, with …Data, through …Cpi and through try…AtLimit", () => {
    it.each(TEMPLATES.map((t) => [`${t.pool} ${t.direction} ${t.builder}`, t] as const))(
      "%s",
      async (_, t) => {
        const amountIn = amountOf(pairOf(pool(t.pool), t.direction)[0]);
        const w = ways(t, amountIn);
        const theirs = await w.hand();
        const data = await w.viaData();
        const ours = await w.viaCpi();
        const tried = await w.viaTry();
        for (const outcome of [theirs, data, ours, tried]) expect(outcome.cpi).toEqual(w.expected);
        // A template the venue refuses for this pool's state (an unbounded walk past the slot's tick
        // arrays, a tick array that is not the pool's first, a limit on the wrong side) is refused
        // the same way, all four ways.
        if (!theirs.ok) {
          const failure = venueFailure(theirs, t.programId);
          expect(failure).toHaveLength(1);
          for (const outcome of [data, ours, tried])
            expect(venueFailure(outcome, t.programId)).toEqual(failure);
          refusedByVenue.push(`${t.pool} ${t.direction} ${t.builder}: ${failure[0]}`);
          return;
        }
        const [h, d, c, r] = [
          succeeded(theirs),
          succeeded(data),
          succeeded(ours),
          succeeded(tried),
        ];
        const ticks = tickMoved(w.p);
        expect(h.paid).toBeGreaterThan(0n);
        expect(h.paid).toBeLessThanOrEqual(amountIn);
        expect({
          d: [d.paid, d.received],
          c: [c.paid, c.received],
          r: [r.paid, r.received],
        }).toEqual({
          d: [h.paid, h.received],
          c: [h.paid, h.received],
          r: [h.paid, h.received],
        });
        expect(h.returned).toBe(h.paid);
        expect(d.returned).toBe(d.paid);
        expect(c.returned).toBe(c.paid); // …Cpi returns what was paid
        expect(r.returned).toBe(r.received); // try…AtLimit what was received
        // OpenBook's data in lots, divided beforehand: the same instruction and the same swap.
        if (t.venue === "openbook-v2") {
          const lots = succeeded(await w.viaLotsData());
          expect(lots.cpi).toEqual(w.expected);
          expect([lots.paid, lots.received]).toEqual([h.paid, h.received]);
          lotsUnits.push(
            `${t.pool} ${t.direction}: ${lots.units} (${lots.units - h.units >= 0 ? "+" : ""}${lots.units - h.units})`,
          );
        }
        // The arm's price-limited form on the same pool, a few basis points past its price, on a
        // slot of nine (it takes no bitmap extension's slot of its own past them).
        let priced: number | undefined;
        if (LAYOUT[t.venue] !== undefined && w.p.venue !== "invariant") {
          const maxPrice = (allIn(w.p, key(w.pay) < key(w.buy)) * 10005n) / 10000n;
          const atPrice = await w.viaTry({
            name: `try${VENUE[t.venue]!.fn}`,
            slot: w.slot.slice(0, 9),
            args: [amountIn, maxPrice, 0n],
          });
          // An adaptive-fee pool is one it skips.
          if (atPrice.ok && atPrice.paid > 0n) priced = atPrice.units;
        }
        units.push({
          template: t,
          size: "ten tokens",
          ticks,
          venue: c.venueUnits,
          hand: h.units,
          data: d.units,
          cpi: c.units,
          tried: r.units,
          priced,
        });
      },
      120_000,
    );
  });

  // -----------------------------------------------------------------------------------------
  // What a try…AtLimit skips, what reverts, and what each venue's own instruction takes
  // -----------------------------------------------------------------------------------------

  /** The swap a pool serves, one way: the window-bounded one where the recipes build it. */
  const served = (name: string, direction: string): Template =>
    TEMPLATES.find(
      (t) => t.pool === name && t.direction === direction && t.builder === "buildBakedCpiSwap",
    ) ?? TEMPLATES.find((t) => t.pool === name && t.direction === direction)!;
  const plainOf = (venue: string): string =>
    venue === "manifest" ? "manifest" : `${lower(VENUE[venue]!.fn)}AtLimit`;
  /** The concentrated-liquidity pools, each the way its window-bounded swap runs first. */
  const CLMM: [string, string][] = [
    ["raydium-clmm-sol-usdc", "0to1"],
    ["pancakeswap-clmm-sol-usdc", "1to0"],
    ["byreal-usdc", "0to1"],
    ["orca-whirlpool-sol-usdc", "bToA"],
    ["orca-whirlpool-adaptive", "bToA"],
    ["cropper-sol-usdc", "bToA"],
    ["defituna-sol-usdc", "aToB"],
    ["crema-sol-usdc", "bToA"],
    ["invariant-usdc-usdt", "xToY"],
  ];

  describe("a try…AtLimit skips, having moved nothing; its plain form reverts", () => {
    const skips: {
      why: string;
      pool: string;
      direction: string;
      edit?: (t: Template, p: Pool) => Edit | undefined;
      args?: (t: Template, w: ReturnType<typeof ways>) => bigint[];
      slot?: (s: Address[]) => Address[];
      amountIn?: bigint;
    }[] = [];
    for (const [name, direction] of CLMM) {
      skips.push({
        why: "a missing slot",
        pool: name,
        direction,
        slot: (s) => [SYSTEM, SYSTEM, ...s.slice(2)],
      });
      skips.push({ why: "no input", pool: name, direction, amountIn: 0n });
      skips.push({
        why: "a pool already at its limit",
        pool: name,
        direction,
        args: (t, w) => {
          const price = le(BYTES.get(w.p.pool)!, VENUE[t.venue]!.price!, 16);
          return [w.tryArgs[0]!, price, w.tryArgs[2]!];
        },
      });
      skips.push({
        why: "a pool with no liquidity at its price",
        pool: name,
        direction,
        edit: (t, p) => ({
          address: p.pool,
          offset: VENUE[t.venue]!.liquidity!,
          bytes: Array(16).fill(0),
        }),
      });
      // One atom buys under one unit at the pool's price once its fee is taken.
      skips.push({
        why: "an input too small to buy one unit",
        pool: name,
        direction,
        amountIn: 1n,
      });
    }
    for (const [name, direction] of CLMM.slice(0, 3))
      skips.push({
        why: "swaps switched off",
        pool: name,
        direction,
        edit: (_, p) => ({ address: p.pool, offset: 389, bytes: [16] }),
      });
    skips.push({
      why: "a paused pool",
      pool: "crema-sol-usdc",
      direction: "bToA",
      edit: (_, p) => ({ address: p.pool, offset: 747, bytes: [1] }),
    });
    for (const direction of ["baseIn", "quoteIn"]) {
      skips.push({
        why: "a missing slot",
        pool: "phoenix-sol-usdc",
        direction,
        slot: (s) => [SYSTEM, SYSTEM, ...s.slice(2)],
      });
      skips.push({ why: "no input", pool: "phoenix-sol-usdc", direction, amountIn: 0n });
      skips.push({
        why: "a market not open for taking",
        pool: "phoenix-sol-usdc",
        direction,
        edit: (_, p) => ({ address: p.pool, offset: 8, bytes: [2] }),
      });
      skips.push({
        why: "an input under one lot",
        pool: "phoenix-sol-usdc",
        direction,
        amountIn:
          direction === "baseIn" ? le(BYTES.get(pool("phoenix-sol-usdc").pool)!, 112, 8) - 1n : 0n,
      });
    }

    for (const name of ["manifest-sol-usdc", "openbook-v2-bonk-usdc"])
      for (const direction of ["baseIn", "quoteIn"]) {
        skips.push({
          why: "a missing slot",
          pool: name,
          direction,
          slot: (s) => [SYSTEM, SYSTEM, ...s.slice(2)],
        });
        skips.push({ why: "no input", pool: name, direction, amountIn: 0n });
      }

    it.each(skips.map((c) => [`${c.pool} ${c.direction}: ${c.why}`, c] as const))(
      "%s",
      async (_, c) => {
        const t = served(c.pool, c.direction);
        const amountIn = c.amountIn ?? amountOf(pairOf(pool(t.pool), t.direction)[0]);
        const w = ways(t, amountIn);
        const edit = c.edit?.(t, w.p);
        const args = c.args?.(t, w) ?? w.tryArgs;
        const slot = c.slot?.(w.slot) ?? w.slot;
        const outcome = succeeded(await w.viaTry({ slot, args, edit }));
        expect({
          returned: outcome.returned,
          received: outcome.received,
          paid: outcome.paid,
          changed: outcome.changed,
        }).toEqual({
          returned: 0n,
          received: 0n,
          paid: 0n,
          changed: edit === undefined ? [] : [edit.address],
        });
        expect(failed(await w.viaTry({ name: plainOf(t.venue), slot, args, edit })).reason).toBe(
          "nothing swapped",
        );
      },
      120_000,
    );

    // A Phoenix order and an OpenBook v2 order at a price no offer meets are placed and fill
    // nothing: 0, nothing paid. At a price every offer meets they take the book like an order at
    // any price.
    it.each([
      ["phoenix-sol-usdc", "quoteIn", 1n, 2n ** 64n - 1n],
      ["phoenix-sol-usdc", "baseIn", 2n ** 64n - 1n, 1n],
      ["openbook-v2-bonk-usdc", "quoteIn", 1n, 2n ** 63n - 1n],
      ["openbook-v2-bonk-usdc", "baseIn", 2n ** 63n - 1n, 1n],
    ] as const)(
      "%s %s: an order at a price none meets fills nothing",
      async (name, direction, none, any) => {
        const t = served(name, direction);
        const w = ways(t, amountOf(pairOf(pool(name), direction)[0]));
        const at = (price: bigint): bigint[] =>
          t.venue === "phoenix"
            ? [w.tryArgs[0]!, price, 0n]
            : [w.tryArgs[0]!, price, w.tryArgs[2]!, 0n];
        const nothing = succeeded(await w.viaTry({ args: at(none) }));
        expect([nothing.returned, nothing.received, nothing.paid]).toEqual([0n, 0n, 0n]);
        expect(failed(await w.viaTry({ name: plainOf(t.venue), args: at(none) })).reason).toBe(
          "nothing swapped",
        );
        const market = succeeded(await w.viaTry());
        const priced = succeeded(await w.viaTry({ args: at(any) }));
        expect(market.received).toBeGreaterThan(0n);
        expect([priced.received, priced.paid]).toEqual([market.received, market.paid]);
      },
      120_000,
    );
  });

  describe("a swap below its floor reverts, the venue's own floor first where it has one", () => {
    const POOLS: [string, string][] = [
      ...CLMM,
      ["phoenix-sol-usdc", "baseIn"],
      ["manifest-sol-usdc", "quoteIn"],
      ["openbook-v2-bonk-usdc", "baseIn"],
    ];
    it.each(POOLS)(
      "%s %s",
      async (name, direction) => {
        const t = served(name, direction);
        const w = ways(t, amountOf(pairOf(pool(name), direction)[0]));
        const { received } = succeeded(await w.viaTry());
        const above = [...w.tryArgs];
        above[above.length - 1] = received + 1n;
        const refused = failed(await w.viaTry({ args: above }));
        // The venues whose instruction carries a least out refuse it themselves.
        const own = !["phoenix", "invariant", "openbook-v2"].includes(t.venue);
        if (own) expect(venueFailure(refused, t.programId)).toHaveLength(1);
        else expect(refused.reason).toBe("below minOut");
        const exact = [...w.tryArgs];
        exact[exact.length - 1] = received;
        expect(succeeded(await w.viaTry({ args: exact })).received).toBe(received);
        if (own) {
          for (const sent of [w.viaData, w.viaCpi]) {
            expect(venueFailure(failed(await sent(received + 1n)), t.programId)).toHaveLength(1);
            expect(failed(await sent(2n ** 64n)).reason).toBe("minOut past 64 bits");
          }
          // So does try…AtLimit's, before it moves anything.
          const past = [...w.tryArgs];
          past[past.length - 1] = 2n ** 64n;
          expect(failed(await w.viaTry({ args: past })).reason).toBe("minOut past 64 bits");
        }
      },
      120_000,
    );
  });

  // A sqrt price limit past its 16-byte field reverts, every way and whichever way the price would
  // move: cut to its field, 2^128 would be 0, which these venues read as no limit at all.
  describe("a sqrt price limit past 128 bits reverts", () => {
    it.each([
      ["raydium-clmm-sol-usdc", "0to1"],
      ["raydium-clmm-sol-usdc", "1to0"],
      ["pancakeswap-clmm-sol-usdc", "1to0"],
      ["byreal-usdc", "0to1"],
      ["orca-whirlpool-sol-usdc", "aToB"],
      ["orca-whirlpool-sol-usdc", "bToA"],
      ["cropper-sol-usdc", "bToA"],
      ["defituna-sol-usdc", "aToB"],
      ["defituna-sol-usdc", "bToA"],
      ["crema-sol-usdc", "bToA"],
      ["invariant-usdc-usdt", "xToY"],
      ["invariant-usdc-usdt", "yToX"],
    ] as const)(
      "%s %s: …Data, …Cpi and try…AtLimit",
      async (name, direction) => {
        const t = served(name, direction);
        const w = ways(t, amountOf(pairOf(pool(name), direction)[0]));
        const wide = 2n ** 128n;
        expect(failed(await w.viaData(w.floor, wide)).reason).toBe("limit past 128 bits");
        expect(failed(await w.viaCpi(w.floor, wide)).reason).toBe("limit past 128 bits");
        const args = [...w.tryArgs];
        args[1] = wide;
        expect(failed(await w.viaTry({ args })).reason).toBe("limit past 128 bits");
        // The widest limit the field carries is the venue's to take or refuse, not this one's.
        args[1] = wide - 1n;
        const widest = await w.viaTry({ args });
        expect(widest.ok ? "" : widest.reason).not.toBe("limit past 128 bits");
      },
      120_000,
    );
  });

  // Orca's `swap_v2` declares the oracle mutable whatever the pool's fee, where the classic `swap`
  // writes it only for an adaptive fee: the order `routerSvmAccounts` gives for `swap_v2` on a pool
  // whose fee is not adaptive swaps like the classic template, and a read-only oracle there is
  // refused (Anchor's ConstraintMut, 2000).
  describe("Orca's swap_v2 writes its oracle whatever the pool's fee", () => {
    it.each(["aToB", "bToA"] as const)(
      "%s, a pool whose fee is not adaptive",
      async (direction) => {
        const t = served("orca-whirlpool-sol-usdc", direction);
        const [pay, buy] = pairOf(pool(t.pool), direction);
        const amountIn = amountOf(pay);
        const aToB = direction === "aToB";
        const by = new Map(t.accounts.map((a) => [role(a.ref), a.address!]));
        const source = randomAddress();
        const recipient = randomAddress();
        const listed = routerSvmAccounts(
          "orca-whirlpool",
          { aToB, v2: true },
          {
            tokenProgramA: TOKEN,
            tokenProgramB: TOKEN,
            memo: MEMO,
            authority: harness.pot,
            pool: by.get("pool")!,
            mintA: aToB ? pay : buy,
            mintB: aToB ? buy : pay,
            source,
            recipient,
            vaultA: by.get("va")!,
            vaultB: by.get("vb")!,
            tickArray0: by.get("ta0")!,
            tickArray1: by.get("ta1")!,
            tickArray2: by.get("ta2")!,
            oracle: by.get("orc")!,
          },
        );
        const { limit, floor } = carried(t);
        const program = compiled(
          svmProgramCalling("orcaWhirlpoolCpi", listed.length, {
            limit: String(limit),
            minOut: String(floor),
            aToB: String(aToB),
          }),
        );
        const send = (oracle?: AccountRole) =>
          cook(program, {
            pay,
            buy,
            amountIn,
            venue: t.programId,
            source,
            recipient,
            args: [amountIn],
            named: {
              program: { address: t.programId, role: AccountRole.READONLY },
              ...Object.fromEntries(
                listed.map((a, i) => [
                  `a${i}`,
                  {
                    address: a.ref,
                    role:
                      a.name === "oracle" && oracle !== undefined
                        ? oracle
                        : a.writable
                          ? AccountRole.WRITABLE
                          : AccountRole.READONLY,
                  },
                ]),
              ),
            },
          });
        const v2 = succeeded(await send());
        expect(v2.cpi).toEqual({
          data:
            `2b04ed0b1ac91e62${leBytes(amountIn, 8)}${leBytes(floor, 8)}${leBytes(limit, 16)}` +
            (aToB ? "010100" : "010000"),
          accounts: listed.map((a) => a.ref),
        });
        // The classic template's swap, from the same state: the same amounts.
        const classic = succeeded(await ways(t, amountIn).hand());
        expect([v2.paid, v2.received]).toEqual([classic.paid, classic.received]);
        expect(
          venueFailure(failed(await send(AccountRole.READONLY)), t.programId).map((line) =>
            line.replace(/^.* failed: /, ""),
          ),
        ).toEqual(["custom program error: 0x7d0"]);
      },
      120_000,
    );
  });

  // Invariant's program does not stop at its limit: a swap that reaches it with input left is
  // refused, so an input past the window aborts the transaction rather than filling to its edge.
  describe("Invariant takes no input past its limit", () => {
    // Nor a 0 limit selling Y: its program takes none only selling X, and refuses it (`WrongLimit`)
    // before anything moves, which aborts the transaction like any failed call.
    it("Y→X at a 0 limit: its program refuses it (0x1773)", async () => {
      const t = served("invariant-usdc-usdt", "yToX");
      const w = ways(t, amountOf(pairOf(pool(t.pool), t.direction)[0]));
      expect(
        venueFailure(failed(await w.viaTry({ args: [w.tryArgs[0]!, 0n, 0n] })), t.programId),
      ).toEqual([`Program ${t.programId} failed: custom program error: 0x1773`]);
    }, 120_000);

    it.each([
      ["xToY", 10n ** 9n],
      ["yToX", 10n ** 10n],
    ] as const)(
      "%s, %s: its program refuses it (0x1778), every way",
      async (direction, amountIn) => {
        const t = served("invariant-usdc-usdt", direction);
        const w = ways(t, amountIn);
        for (const sent of [w.hand, w.viaData, w.viaCpi, w.viaTry])
          expect(venueFailure(failed(await sent()), t.programId)).toEqual([
            `Program ${t.programId} failed: custom program error: 0x1778`,
          ]);
      },
      120_000,
    );
  });

  describe("the caller's accounts and limits, refused", () => {
    const REASONS: Record<string, string> = {
      "raydium-clmm": "not a Raydium CLMM pool",
      "pancakeswap-clmm": "not a PancakeSwap CLMM pool",
      byreal: "not a Byreal pool",
      "orca-whirlpool": "not an Orca whirlpool",
      cropper: "not a Cropper pool",
      defituna: "not a DefiTuna pool",
      crema: "not a Crema pool",
      phoenix: "not a Phoenix market",
      invariant: "not an Invariant pool",
      manifest: "not a Manifest market",
      "openbook-v2": "not an OpenBook v2 market",
    };
    // The authority signs the swap, so the program it calls must be the venue's own: `…Cpi` checks
    // the program it is given, `try…AtLimit` the slot's against the pool's owner.
    // The trader's mints are the caller's too: a pool or market that is not the pair reverts.
    it.each(Object.keys(REASONS))(
      "%s: a pool or market not the pair reverts through try…AtLimit",
      async (venue) => {
        const t = TEMPLATES.find((x) => x.venue === venue)!;
        const w = ways(t, amountOf(pairOf(pool(t.pool), t.direction)[0]));
        const book = ["phoenix", "manifest", "openbook-v2"].includes(venue);
        expect(failed(await w.viaTry({ buyMint: randomAddress() })).reason).toBe(
          book ? "market is not the pair" : "pool is not the pair",
        );
      },
      120_000,
    );

    it.each(Object.entries(REASONS))(
      "%s: another venue's program or pool reverts, through …Cpi and through try…AtLimit",
      async (venue, reason) => {
        const t = TEMPLATES.find((x) => x.venue === venue)!;
        const w = ways(t, amountOf(pairOf(pool(t.pool), t.direction)[0]));
        const other = pool(
          venue === "orca-whirlpool" ? "raydium-clmm-sol-usdc" : "orca-whirlpool-sol-usdc",
        );
        // `…Cpi` given another program for this venue's accounts: refused before the call.
        const misnamed = { ...t, programId: other.program };
        expect(failed(await ways(misnamed, amountOf(w.pay)).viaCpi()).reason).toBe(reason);
        // `try…AtLimit` given a slot naming another program, or another venue's pool.
        expect(failed(await w.viaTry({ slot: [other.program, ...w.slot.slice(1)] })).reason).toBe(
          reason,
        );
        expect(
          failed(await w.viaTry({ slot: [w.slot[0]!, other.pool, ...w.slot.slice(2)] })).reason,
        ).toBe(reason);
      },
      120_000,
    );

    it("a limit an instruction cannot carry reverts rather than being cut to another price", async () => {
      const phoenix = ways(served("phoenix-sol-usdc", "baseIn"), 10n ** 10n);
      expect(failed(await phoenix.viaTry({ args: [10n ** 10n, 2n ** 64n, 0n] })).reason).toBe(
        "limit past 64 bits",
      );
      const openbook = ways(served("openbook-v2-bonk-usdc", "baseIn"), 10n ** 9n);
      expect(failed(await openbook.viaTry({ args: [10n ** 9n, 2n ** 63n, 4n, 0n] })).reason).toBe(
        "limit past its field",
      );
      expect(failed(await openbook.viaTry({ args: [10n ** 9n, 0n, 256n, 0n] })).reason).toBe(
        "limit past its field",
      );
    }, 120_000);
  });

  describe("a slot's optional accounts", () => {
    // Raydium's swap needs the bitmap extension only past its pool's default bitmap; a slot of
    // nine sends the swap without it, and it runs the same.
    it.each(["raydium-clmm-sol-usdc", "pancakeswap-clmm-sol-usdc", "byreal-usdc"])(
      "%s: without the bitmap extension",
      async (name) => {
        const t = served(name, "0to1");
        const w = ways(t, amountOf(pairOf(pool(name), "0to1")[0]));
        const extended = succeeded(await w.viaTry());
        expect(extended.cpi!.accounts).toHaveLength(17);
        const nine = succeeded(await w.viaTry({ slot: w.slot.slice(0, 9) }));
        expect(nine.cpi!.accounts).toEqual(extended.cpi!.accounts.filter((_, i) => i !== 13));
        expect([nine.paid, nine.received]).toEqual([extended.paid, extended.received]);
      },
      120_000,
    );

    // Crema refuses a tick array its map does not mark: a slot names fewer by the System program.
    it("Crema: a slot of one tick array passes one", async () => {
      const t = served("crema-sol-usdc", "bToA");
      const w = ways(t, amountOf(pairOf(pool(t.pool), t.direction)[0]));
      const all = succeeded(await w.viaTry());
      const one = succeeded(await w.viaTry({ slot: [...w.slot.slice(0, 7), SYSTEM, SYSTEM] }));
      expect(one.cpi!.accounts).toEqual(all.cpi!.accounts.slice(0, 12));
      expect([one.paid, one.received]).toEqual([all.paid, all.received]);
    }, 120_000);
  });

  // The served, window-bounded swap with far more than the window holds: the pool walks to its
  // window's edge and stops there, every way alike, and the compute grows with the ticks crossed.
  describe("past the window: each way stops at the pool's own limit", () => {
    const bounded = TEMPLATES.filter(
      (t) => t.builder === "buildBakedCpiSwap" && VENUE[t.venue]!.tick !== undefined,
    );
    it.each(bounded.map((t) => [`${t.pool} ${t.direction}`, t] as const))(
      "%s",
      async (_, t) => {
        // More than any of these pools holds of either token, and within a token account's u64.
        const amountIn = 10n ** 18n;
        const w = ways(t, amountIn);
        const theirs = await w.hand();
        const ticks = tickMoved(w.p);
        const [data, ours, tried] = [await w.viaData(), await w.viaCpi(), await w.viaTry()];
        // A walk too long for one transaction's compute, or that leaves the slot's ticks, fails
        // the same way all four ways.
        if (!theirs.ok) {
          const failure = venueFailure(theirs, t.programId);
          expect(failure).toHaveLength(1);
          for (const outcome of [data, ours, tried])
            expect(venueFailure(outcome, t.programId)).toEqual(failure);
          refusedByVenue.push(`${t.pool} ${t.direction} past the window: ${failure[0]}`);
          return;
        }
        const [h, d, c, r] = [
          succeeded(theirs),
          succeeded(data),
          succeeded(ours),
          succeeded(tried),
        ];
        expect({
          d: [d.paid, d.received],
          c: [c.paid, c.received],
          r: [r.paid, r.received],
        }).toEqual({
          d: [h.paid, h.received],
          c: [h.paid, h.received],
          r: [h.paid, h.received],
        });
        expect(c.paid).toBeGreaterThan(0n);
        expect(c.paid).toBeLessThan(amountIn); // stopped at the limit, the rest left
        units.push({
          template: t,
          size: "past the window",
          ticks,
          venue: c.venueUnits,
          hand: h.units,
          data: d.units,
          cpi: c.units,
          tried: r.units,
        });
      },
      120_000,
    );
  });

  afterAll(() => {
    if (units.length === 0) return;
    const sign = (n: number): string => (n >= 0 ? `+${n}` : String(n));
    const rows = units.map(
      (u) =>
        `| ${u.template.pool} | ${u.template.direction} | ${u.template.builder} | ${u.size} | ${u.ticks} | ${u.venue} | ${u.hand} | ${u.data} (${sign(u.data - u.hand)}) | ${u.cpi} (${sign(u.cpi - u.hand)}) | ${u.tried} (${sign(u.tried - u.hand)}) | ${u.priced === undefined ? "" : `${u.priced} (${sign(u.priced - u.hand)})`} |`,
    );
    console.log(
      [
        "| pool | direction | template | size | ticks moved | venue CU | hand-built cook CU | …Data cook CU | …Cpi cook CU | try…AtLimit cook CU | try… at a price cook CU |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows,
        "",
        "Refused by the venue, all four ways alike:",
        ...refusedByVenue,
        "",
        "OpenBook through openbookV2LotsData, cook CU beside the hand-built CPI:",
        ...lotsUnits,
      ].join("\n"),
    );
  });
});
