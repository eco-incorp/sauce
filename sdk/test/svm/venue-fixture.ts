/**
 * The venues the Solana distributed swap trades on, as `scripts/dump-svm-venues.mjs` dumped them:
 * each venue's mainnet program and the manifest in `test/fixtures/svm-venue-programs/`, and every
 * account of the pools a swap takes beside the other venue fixtures in `test/svm/fixtures/<venue>/`,
 * with the slot of nine accounts the skill's program takes for each pool. Loaded into a LiteSVM
 * bank by the suites that execute the program, directly through the Kitchen
 * (`distributed-swap.e2e.test.ts`) and through the `sauce` command (`cli-solana-distributed-swap`),
 * and by `@sauce/router`'s Solana suites (`std/router/svm*.e2e.test.ts`), which also trade the
 * venues added after it (`--add`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { address, getAddressCodec, lamports } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { LiteSVM } from "litesvm";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROGRAMS = join(HERE, "../fixtures/svm-venue-programs");
const ACCOUNTS = join(HERE, "fixtures");
export interface Pool {
  name: string;
  venue: string;
  program: Address;
  pool: Address;
  config: Address;
  vaultA: Address;
  vaultB: Address;
  extra: Address;
  /** The tick arrays a swap paying the lower-key token walks (the price falls), and the other way. */
  payA: Address[];
  payB: Address[];
  /** The slot's accounts past its nine, where the venue takes more (`dump-svm-venues`'s `moreOf`):
   *  a Raydium-layout pool's tick-array bitmap extension, Invariant's program authority, an OpenBook
   *  v2 market's oracles. */
  more?: Address[];
  /** When `dump-svm-venues --add` read a pool after the fixture's own slot, or its `more`. */
  slot?: number;
  unixTimestamp?: number;
  moreSlot?: number;
}
export interface Manifest {
  slot: number;
  unixTimestamp: number;
  programs: { name: string; programId: Address; file: string }[];
  pools: Pool[];
  /** `file` under `test/svm/fixtures/`; `lamports` absent where an earlier fixture of the account,
   *  kept as it was, does not record them. */
  accounts: { address: Address; owner: Address; lamports?: string; file: string }[];
}

export const manifest = JSON.parse(
  readFileSync(join(PROGRAMS, "manifest.json"), "utf8"),
) as Manifest;
/** A program's ELF. */
const program = (file: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(join(PROGRAMS, file))));
/** An account file's data: `{ address, owner, lamports, base64Data }`, gzipped when `.gz`. */
const accountData = (file: string): Uint8Array => {
  const raw = readFileSync(join(ACCOUNTS, file));
  const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as {
    base64Data: string;
  };
  return new Uint8Array(Buffer.from(json.base64Data, "base64"));
};
export const SNAPSHOT = new Map(manifest.accounts.map((account) => [account.address, account]));
export const BYTES = new Map(
  manifest.accounts.map((account) => [account.address, accountData(account.file)]),
);

export const SYSTEM = address("11111111111111111111111111111111");
export const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const MEMO = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const WSOL = address("So11111111111111111111111111111111111111112");
export const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

export const pool = (name: string): Pool => {
  const found = manifest.pools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no pool ${name} in the fixture`);
  return found;
};
export const NONE: Pool = {
  name: "none",
  venue: "none",
  program: SYSTEM,
  pool: SYSTEM,
  config: SYSTEM,
  vaultA: SYSTEM,
  vaultB: SYSTEM,
  extra: SYSTEM,
  payA: [SYSTEM, SYSTEM, SYSTEM],
  payB: [SYSTEM, SYSTEM, SYSTEM],
};

export const key = (at: Address): bigint =>
  BigInt(`0x${Buffer.from(getAddressCodec().encode(at)).toString("hex")}`);
export const le = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
};
export const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return x;
};
export const E18 = 10n ** 18n;
export const Q128 = 1n << 128n;

/** Where each concentrated-liquidity venue keeps its sqrt price, liquidity and fee. */
export const LAYOUT: Record<
  string,
  { price: number; liquidity: number; fee: (p: Pool) => bigint }
> = {
  "raydium-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "pancakeswap-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  byreal: { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "stabble-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "orca-whirlpool": { price: 65, liquidity: 49, fee: (p) => le(BYTES.get(p.pool)!, 45, 2) },
  cropper: { price: 65, liquidity: 49, fee: (p) => le(BYTES.get(p.pool)!, 45, 2) },
  defituna: { price: 167, liquidity: 151, fee: (p) => le(BYTES.get(p.pool)!, 143, 2) },
  crema: { price: 190, liquidity: 174, fee: (p) => le(BYTES.get(p.pool)!, 172, 2) },
};

/** A pool's price, fee included, in priceLimit's units: pay base units per buy base unit, × 1e18. */
export const allIn = (p: Pool, paysA: boolean): bigint => {
  const { price, fee } = LAYOUT[p.venue]!;
  const s = le(BYTES.get(p.pool)!, price, 16);
  const kept = 1_000_000n - fee(p);
  return paysA
    ? (Q128 * E18 * 1_000_000n) / (s * s * kept)
    : (s * s * E18 * 1_000_000n) / (Q128 * kept);
};

/** The program's arithmetic: priceLimit as a sqrt price, then a pool's own limit for its fee. */
export const ownLimit = (p: Pool, priceLimit: bigint, paysA: boolean): bigint => {
  const limit = paysA ? isqrt((Q128 * E18) / priceLimit) : isqrt((priceLimit * Q128) / E18);
  const root = isqrt((1_000_000n - LAYOUT[p.venue]!.fee(p)) * 10n ** 30n);
  return paysA ? (limit * E18) / root : (limit * root) / E18;
};

/** A signed i32 at `at` of an account's data. */
const i32 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset).getInt32(at, true);

/** The first four binomial terms of √1.0001^n, times 1e18 (`router.svm.js`'s `binomial`). */
const binomial = (n: bigint): bigint => {
  const x = 49_998_750_062_496n;
  const a = n * x;
  const b = n > 1n ? (n - 1n) * x : 0n;
  const c = n > 2n ? (n - 2n) * x : 0n;
  return E18 + a + (a * b) / (2n * E18) + (((a * b) / E18) * c) / (6n * E18);
};

/** The router's bound `n` ticks from `price`, up or down (`router.svm.js`'s `ticksAway`): the power
 *  of a sixteenth of `n`, squared four times, then the rest. */
const ticksAway = (price: bigint, n: bigint, up: boolean): bigint => {
  let power = binomial(n >> 4n);
  for (let i = 0; i < 4; i++) power = (power * power) / E18;
  power = (power * binomial(n & 15n)) / E18;
  return up ? (price * power) / E18 : (price * E18) / power;
};

/**
 * The window a swap at a price walks, as `router.svm.js` reads it from the pool and the slot's tick
 * arrays (`ticks`, the pool's own both ways by default): its last safe tick, undefined for none.
 */
export const windowStop = (
  p: Pool,
  paysA: boolean,
  ticks = paysA ? p.payA : p.payB,
): number | undefined => {
  const data = BYTES.get(p.pool)!;
  const down = paysA;
  const layout = {
    raydium: { tick: 269, price: 253 },
    whirlpool: { tick: 81, price: 65 },
    defituna: { tick: 183, price: 167 },
    crema: { tick: 206, price: 190 },
  }[
    ["raydium-clmm", "pancakeswap-clmm", "byreal", "stabble-clmm"].includes(p.venue)
      ? "raydium"
      : ["orca-whirlpool", "cropper"].includes(p.venue)
        ? "whirlpool"
        : p.venue
  ]!;
  const tick = i32(data, layout.tick);
  let stop: number | undefined;
  if (layout.tick === 269) {
    const spacing = Number(le(data, 235, 2));
    const span = 60 * spacing;
    let far: { data: Uint8Array; start: number; dynamic: boolean } | undefined;
    for (const at of ticks) {
      const array = BYTES.get(at);
      const kind = array === undefined ? "" : Buffer.from(array.subarray(0, 8)).toString("hex");
      if (kind !== "c09b55cd31f9812a" && kind !== "6a8b98247599b838") continue;
      const start = i32(array!, 40);
      const ahead = down ? start <= tick : start + span > tick;
      if (ahead && (far === undefined || (down ? start < far.start : start > far.start)))
        far = { data: array!, start, dynamic: kind === "6a8b98247599b838" };
    }
    if (far !== undefined) {
      // Its last initialized tick that way, from its far end (not past the price in the array that
      // holds it); none, an array marked for limit orders alone, where it begins.
      const holds = down ? far.start + span > tick : far.start <= tick;
      const here = Math.floor((tick - far.start) / spacing);
      for (let n = 0; n < 60 && stop === undefined; n++) {
        const offset = down ? n : 59 - n;
        if (holds && (down ? offset > here : offset <= here)) break;
        let at = 64 + offset * 168;
        if (far.dynamic) {
          const place = far.data[48 + offset]!;
          at = place === 0 ? 0 : 216 + (place - 1) * 168 + 20;
        }
        if (at !== 0 && le(far.data, at, 16) !== 0n) stop = far.start + offset * spacing;
      }
      if (stop === undefined && !holds) stop = down ? far.start + span : far.start;
    }
  } else if (layout.tick === 206) {
    const spacing = Number(le(data, 168, 2));
    const span = 64 * spacing;
    const passed = ticks.filter((at) => at !== SYSTEM);
    const array = BYTES.get(passed[passed.length - 1]!)!;
    const start = -443636 + (443636 % spacing) + Number(le(array, 8, 2)) * span;
    const holds = down ? start + span > tick : start <= tick;
    const here = Math.floor((tick - start) / spacing);
    for (let n = 0; n < 64 && stop === undefined; n++) {
      const offset = down ? n : 63 - n;
      if (holds && (down ? offset > here : offset <= here)) break;
      if (array[44 + offset * 133] === 1) stop = start + offset * spacing;
    }
    if (stop === undefined && !holds) stop = down ? start + span : start;
  } else {
    const spacing = Number(le(data, layout.tick === 81 ? 41 : 139, 2));
    const span = 88 * spacing;
    const base = Math.floor(tick / span) * span;
    const first = tick + spacing >= base + span ? base + span : base;
    stop = down ? base - 2 * span : first + 2 * span + 87 * spacing;
  }
  return stop;
};

/** The sqrt price the router holds a swap at a price to: a tick inside the window's last safe tick
 *  (`windowStop`), or the pool's price where it leaves no room. */
export const windowBound = (p: Pool, paysA: boolean, ticks = paysA ? p.payA : p.payB): bigint => {
  const data = BYTES.get(p.pool)!;
  const at = ["raydium-clmm", "pancakeswap-clmm", "byreal", "stabble-clmm"].includes(p.venue)
    ? { tick: 269, price: 253 }
    : ["orca-whirlpool", "cropper"].includes(p.venue)
      ? { tick: 81, price: 65 }
      : p.venue === "defituna"
        ? { tick: 183, price: 167 }
        : { tick: 206, price: 190 };
  const tick = i32(data, at.tick);
  const price = le(data, at.price, 16);
  const stop = windowStop(p, paysA, ticks);
  if (stop === undefined) return price;
  if (paysA) return stop + 1 < tick ? ticksAway(price, BigInt(tick - stop - 1), false) : price;
  return stop > tick + 2 ? ticksAway(price, BigInt(stop - tick - 2), true) : price;
};

export const SLOT_NAMES = (k: number): string[] => [
  `program${k}`,
  `pool${k}`,
  `config${k}`,
  `vaultA${k}`,
  `vaultB${k}`,
  `extra${k}`,
  `ticks${k}0`,
  `ticks${k}1`,
  `ticks${k}2`,
];

/** Every venue's program, loaded at its mainnet id. */
export const loadVenues = (svm: LiteSVM): void => {
  for (const venue of manifest.programs) svm.addProgram(venue.programId, program(venue.file));
};

/** Bytes to change in a fixture account before a cook. */
export interface Edit {
  address: Address;
  offset: number;
  bytes: number[];
}

/** Every fixture account back as the snapshot has it, each edit applied: each cook starts from
 *  the same chain. */
export const restoreVenues = (svm: LiteSVM, edits?: Edit | readonly Edit[]): void => {
  const changes = edits === undefined ? [] : Array.isArray(edits) ? edits : [edits as Edit];
  for (const [at, data] of BYTES) {
    const account = SNAPSHOT.get(at)!;
    const copy = new Uint8Array(data);
    for (const edit of changes) if (edit.address === at) copy.set(edit.bytes, edit.offset);
    // An earlier fixture that recorded no lamports holds the rent exemption, and a wrapped-SOL
    // token account its amount on top, which the token program moves with it.
    const rent = svm.minimumBalanceForRentExemption(BigInt(copy.length));
    const wrapped =
      account.owner === TOKEN &&
      copy.length === 165 &&
      getAddressCodec().decode(copy.subarray(0, 32)) === WSOL;
    svm.setAccount({
      address: at,
      data: copy,
      executable: false,
      lamports: lamports(
        account.lamports === undefined
          ? rent + (wrapped ? le(copy, 64, 8) : 0n)
          : BigInt(account.lamports),
      ),
      programAddress: account.owner,
      space: BigInt(copy.length),
    });
  }
};
