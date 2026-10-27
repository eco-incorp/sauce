/**
 * Synthetic carrot Vault bundle (vault + shares mint + per-asset ATA + per-asset
 * Pyth `PriceUpdateV2` oracle) for adapter unit tests. Not a test file (no
 * *.test.ts suffix) — a shared helper, mirroring fixtures/token-2022/synth.ts.
 *
 * carrot is the one of the three oracle-scaling venues with no mainnet dump in
 * sdk/test/svm/fixtures (it is a singleton vault wired as a zero-RPC candidate,
 * so no venue test has needed one before). These bytes are hand-built to the
 * layout the adapter documents and pins byte-exactly against the real 852-byte
 * account: authority@8, shares@40, fee@72, paused@102, assetIndex@103,
 * strategyIndex@105, then `assets: Vec<Asset>` (u32 len @107, 99-byte elements
 * of asset_id u16 / mint 32 / decimals u8 / ata 32 / oracle 32 from @111).
 *
 * The oracle is a 134-byte `PriceUpdateV2` with the 1-byte `Full` verification
 * tag at @40, which puts the price message at @73 — the same offsets woofi's
 * OFF_PYTH_* constants name for the identical account type.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { OwnedAccountLoader } from "../../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../../src/svm/token-program.js";
import { CARROT_PROGRAM_ID } from "../../../../src/svm/venues/carrot/index.js";

/** pyth-solana-receiver, the owner of every `PriceUpdateV2` account. */
const PYTH_RECEIVER_PROGRAM_ID = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/** The owner of an account a test adds to `accounts` itself. */
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

const codec = getAddressCodec();

/** A deterministic, collision-free 32-byte pubkey from a label. */
function pubkey(label: string): Address {
  const raw = new Uint8Array(32);
  for (let i = 0; i < label.length && i < 32; i++) raw[i] = label.charCodeAt(i);
  raw[31] = label.length; // keep same-prefix labels distinct
  return codec.decode(raw);
}

function writeU16LE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, off: number, value: number): void {
  for (let i = 0; i < 4; i++) buf[off + i] = (value >>> (8 * i)) & 0xff;
}

function writeU64LE(buf: Uint8Array, off: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Two's-complement i32 LE — the whole point is that i32::MIN/MAX are expressible. */
function writeI32LE(buf: Uint8Array, off: number, value: number): void {
  writeU32LE(buf, off, value >>> 0);
}

function writeAddress(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(codec.encode(addr), off);
}

export interface CarrotSynthAsset {
  assetId: number;
  /** SPL mint decimals recorded in the vault's asset record (one byte on-chain). */
  decimals: number;
  /** The oracle's i32 exponent — the field under test. */
  exponent: number;
  /** Raw i64 Pyth price (positive; the adapter rejects 0 and the negative range). */
  price?: bigint;
  /** Vault-held ATA balance. */
  ataAmount?: bigint;
  publishTime?: bigint;
}

export interface CarrotSynthVault {
  pool: Address;
  sharesMint: Address;
  /** Each account with its real owner: the vault Carrot's, the shares mint Token-2022's (CRT is a
   *  Token-2022 mint), each ATA Tokenkeg's, each oracle the Pyth receiver's. */
  load: OwnedAccountLoader;
  /** Every account by base58 address, so a test can patch one and rebuild the loader. */
  accounts: Map<string, Uint8Array>;
}

/** A 134-byte PriceUpdateV2 with the `Full` tag — price message at @73. */
export function makeCarrotOracle(asset: CarrotSynthAsset): Uint8Array {
  const data = new Uint8Array(134);
  data[40] = 1; // VerificationLevel::Full
  writeU64LE(data, 73, asset.price ?? 100_000_000n); // price i64
  writeU64LE(data, 81, 0n); // conf u64
  writeI32LE(data, 89, asset.exponent); // exponent i32
  writeU64LE(data, 93, asset.publishTime ?? 0n); // publish_time i64
  return data;
}

/**
 * A complete, loadable carrot vault over `assets`. Addresses are derived from
 * the asset id, so `accounts` keys are stable across calls.
 */
export function makeCarrotVault(assets: readonly CarrotSynthAsset[]): CarrotSynthVault {
  const pool = pubkey("carrot-vault");
  const sharesMint = pubkey("carrot-shares");

  const vault = new Uint8Array(852);
  writeAddress(vault, 8, pubkey("carrot-authority"));
  writeAddress(vault, 40, sharesMint);
  writeU16LE(vault, 72, 0); // redemption fee bps
  vault[102] = 0; // not paused
  writeU32LE(vault, 107, assets.length);

  const accounts = new Map<string, Uint8Array>();
  const owners = new Map<string, Address>();

  assets.forEach((asset, i) => {
    const mint = pubkey(`carrot-mint-${asset.assetId}`);
    const ata = pubkey(`carrot-ata-${asset.assetId}`);
    const oracle = pubkey(`carrot-oracle-${asset.assetId}`);

    const off = 111 + i * 99;
    writeU16LE(vault, off, asset.assetId);
    writeAddress(vault, off + 2, mint);
    vault[off + 34] = asset.decimals;
    writeAddress(vault, off + 35, ata);
    writeAddress(vault, off + 67, oracle);

    const ataData = new Uint8Array(165); // SPL token account; amount u64 @64
    writeU64LE(ataData, 64, asset.ataAmount ?? 1_000_000_000n);
    accounts.set(ata, ataData);
    owners.set(ata, TOKEN_PROGRAM_ID);
    accounts.set(oracle, makeCarrotOracle(asset));
    owners.set(oracle, PYTH_RECEIVER_PROGRAM_ID);
  });

  accounts.set(pool, vault);
  owners.set(pool, CARROT_PROGRAM_ID);
  const mintData = new Uint8Array(82); // SPL mint; supply u64 @36
  writeU64LE(mintData, 36, 1_000_000_000n);
  accounts.set(sharesMint, mintData);
  owners.set(sharesMint, TOKEN_2022_PROGRAM_ID);

  const load: OwnedAccountLoader = async (addr) => {
    const data = accounts.get(addr);
    if (data === undefined) return null;
    return { data: new Uint8Array(data), owner: owners.get(addr) ?? SYSTEM_PROGRAM_ID };
  };

  return { pool, sharesMint, load, accounts };
}
