/**
 * The venues the Solana distributed swap trades on, as `scripts/dump-svm-venues.mjs` dumped them into
 * `test/fixtures/svm-venues/`: each venue's mainnet program, and every account of the pools a swap
 * takes, with the slot of nine accounts the skill's program takes for each pool. Loaded into a LiteSVM
 * bank by the suites that execute the program, directly through the Kitchen
 * (`distributed-swap.e2e.test.ts`) and through the `sauce` command (`cli-solana-distributed-swap`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { address, getAddressCodec, lamports } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { LiteSVM } from "litesvm";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../fixtures/svm-venues");
/** The skill's program. */
export const PROGRAM = join(
  HERE,
  "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
);

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
}
export interface Manifest {
  slot: number;
  unixTimestamp: number;
  programs: { name: string; programId: Address; file: string }[];
  pools: Pool[];
  accounts: { address: Address; owner: Address; lamports: string; file: string }[];
}

export const manifest = JSON.parse(
  readFileSync(join(FIXTURE, "manifest.json"), "utf8"),
) as Manifest;
export const unzip = (file: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(join(FIXTURE, file))));
export const SNAPSHOT = new Map(manifest.accounts.map((account) => [account.address, account]));
export const BYTES = new Map(
  manifest.accounts.map((account) => [account.address, unzip(account.file)]),
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

/** A pool's price, fee included, in maxPrice's units: pay base units per buy base unit, × 1e18. */
export const allIn = (p: Pool, paysA: boolean): bigint => {
  const { price, fee } = LAYOUT[p.venue]!;
  const s = le(BYTES.get(p.pool)!, price, 16);
  const kept = 1_000_000n - fee(p);
  return paysA
    ? (Q128 * E18 * 1_000_000n) / (s * s * kept)
    : (s * s * E18 * 1_000_000n) / (Q128 * kept);
};

/** The program's arithmetic: maxPrice as a sqrt price, then a pool's own limit for its fee. */
export const ownLimit = (p: Pool, maxPrice: bigint, paysA: boolean): bigint => {
  const limit = paysA ? isqrt((Q128 * E18) / maxPrice) : isqrt((maxPrice * Q128) / E18);
  const root = isqrt((1_000_000n - LAYOUT[p.venue]!.fee(p)) * 10n ** 30n);
  return paysA ? (limit * E18) / root : (limit * root) / E18;
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
  for (const venue of manifest.programs) svm.addProgram(venue.programId, unzip(venue.file));
};

/** Every fixture account back as the snapshot has it, `edit` applied: each cook starts from the
 *  same chain. */
export const restoreVenues = (
  svm: LiteSVM,
  edit?: { address: Address; offset: number; bytes: number[] },
): void => {
  for (const [at, data] of BYTES) {
    const account = SNAPSHOT.get(at)!;
    const copy = new Uint8Array(data);
    if (edit !== undefined && edit.address === at) copy.set(edit.bytes, edit.offset);
    svm.setAccount({
      address: at,
      data: copy,
      executable: false,
      lamports: lamports(BigInt(account.lamports)),
      programAddress: account.owner,
      space: BigInt(copy.length),
    });
  }
};
