/**
 * mswap (M Swap / ext_swap) adapter units (no engine, no RPC): synthetic
 * SwapGlobal + ExtGlobalV2 byte fixtures exercising fetchMSwapPoolConfig's
 * per-leg token-program threading. mswap is Token-2022-native: each leg's
 * token program is read LIVE from the on-chain SwapGlobal whitelist entry
 * (never hardcoded), so opposite legs may differ (T2022 vs legacy). This suite
 * proves a Token-2022 leg routes and that the two legs' programs are threaded
 * independently.
 *
 * No mint-byte inspection happens in this venue (the whitelist itself is the
 * eligibility gate and the servable set is fee-free by construction — see the
 * module doc), so the shared token-2022 mint synth builders don't apply here;
 * the relevant "Token-2022" fact is the per-leg tokenProgram carried in the
 * whitelist entry.
 */
import { address, getAddressCodec, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  fetchMSwapPoolConfig,
  mswapPoolKey,
  M_MINT,
  M_TOKEN_PROGRAM,
  MSWAP_PROGRAM_ID,
  SWAP_GLOBAL_ID,
} from "../../../src/svm/venues/mswap/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";

const codec = getAddressCodec();
const TOKENKEG = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// sha256("account:SwapGlobal")[0..8] (module doc GROUND TRUTH).
const SWAP_GLOBAL_DISCRIMINATOR = [0x0f, 0xb8, 0x93, 0x81, 0xb7, 0xdb, 0xdf, 0xa3];
const GLOBAL_SEED = new TextEncoder().encode("global");

// Two real M-extension program ids used purely as PDA-derivation inputs here.
const EXT_PROGRAM_A = address("wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko"); // wM (Token-2022 leg)
const EXT_PROGRAM_B = address("extUkDFf3HLekkxbcZ3XRUizMjbxMJgKBay3p9xGVmg"); // usds-like (legacy leg)
// Two arbitrary distinct mint addresses for the whitelist entries.
const MINT_A = address("mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp");
const MINT_B = address("usdsfJbX78ktZUnoRC7dwvvQz7xH3WdkpGne76gdUia");

function writeU32(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
  buf[off + 2] = (value >> 16) & 0xff;
  buf[off + 3] = (value >> 24) & 0xff;
}
function writeAddr(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

interface Entry {
  programId: Address;
  mint: Address;
  tokenProgram: Address;
}

/** Build a SwapGlobal account with the given whitelisted extension entries. */
function buildSwapGlobal(entries: Entry[]): Uint8Array {
  // [0..8) disc, [8] bump, [9..41) admin, [41..45) unwrapperLen(=0),
  // [45..49) extLen, then 96-byte entries.
  const buf = new Uint8Array(49 + entries.length * 96);
  buf.set(SWAP_GLOBAL_DISCRIMINATOR, 0);
  writeU32(buf, 45, entries.length);
  let off = 49;
  for (const e of entries) {
    writeAddr(buf, off, e.programId);
    writeAddr(buf, off + 32, e.mint);
    writeAddr(buf, off + 64, e.tokenProgram);
    off += 96;
  }
  return buf;
}

/** Build an ExtGlobalV2 account: NO_YIELD variant, SWAP_GLOBAL_ID as a wrap authority. */
function buildExtGlobal(): Uint8Array {
  // decodeExtGlobal walk: off 8+32=40; pendingTag@40=0 -> off 41; +96 (three
  // pubkeys) -> 137; +3 (bumps) -> 140; yield_variant@140=0 (NO_YIELD) -> 141;
  // wrapLen u32@141; then pubkeys.
  const buf = new Uint8Array(145 + 32);
  buf[140] = 0; // YieldVariant::NoYield
  writeU32(buf, 141, 1); // wrap_authorities.len
  writeAddr(buf, 145, SWAP_GLOBAL_ID);
  return buf;
}

async function globalPda(extProgramId: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: extProgramId,
    seeds: [GLOBAL_SEED],
  });
  return pda;
}

/** A loader serving SwapGlobal + both legs' ExtGlobalV2; null otherwise. */
async function buildLoader(entries: Entry[]): Promise<AccountLoader> {
  const swapGlobal = buildSwapGlobal(entries);
  const [globalA, globalB] = await Promise.all([
    globalPda(EXT_PROGRAM_A),
    globalPda(EXT_PROGRAM_B),
  ]);
  const extGlobal = buildExtGlobal();
  const byAddr = new Map<string, Uint8Array>([
    [SWAP_GLOBAL_ID as string, swapGlobal],
    [globalA as string, extGlobal],
    [globalB as string, extGlobal],
  ]);
  return async (addr) => {
    const data = byAddr.get(addr as string);
    return data === undefined ? null : new Uint8Array(data);
  };
}

const entries: Entry[] = [
  { programId: EXT_PROGRAM_A, mint: MINT_A, tokenProgram: TOKEN_2022 },
  { programId: EXT_PROGRAM_B, mint: MINT_B, tokenProgram: TOKENKEG },
];

describe("mswap fetchMSwapPoolConfig Token-2022 per-leg threading", () => {
  it("carries the documented program id", () => {
    expect(MSWAP_PROGRAM_ID).toBe("MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH");
    expect(M_TOKEN_PROGRAM).toBe(TOKEN_2022); // $M is always Token-2022
    expect(M_MINT).toBe("mzerojk9tg56ebsrEAhfkyc9VgKjTW2zDqp6C5mhjzH");
  });

  it("routes a Token-2022 leg and threads each leg its OWN whitelist token program", async () => {
    const load = await buildLoader(entries);
    const pool = mswapPoolKey(MINT_A, MINT_B); // T2022 in -> legacy out
    const cfg = await fetchMSwapPoolConfig(load, pool);
    expect(cfg.fromMint).toBe(MINT_A);
    expect(cfg.toMint).toBe(MINT_B);
    expect(cfg.fromTokenProgram).toBe(TOKEN_2022); // per-leg, read from the whitelist
    expect(cfg.toTokenProgram).toBe(TOKENKEG); // opposite leg differs
  });

  it("threads the reverse direction independently (legacy in -> Token-2022 out)", async () => {
    const load = await buildLoader(entries);
    const pool = mswapPoolKey(MINT_B, MINT_A);
    const cfg = await fetchMSwapPoolConfig(load, pool);
    expect(cfg.fromTokenProgram).toBe(TOKENKEG);
    expect(cfg.toTokenProgram).toBe(TOKEN_2022);
  });

  it("drops a pair whose mint is not whitelisted", async () => {
    const load = await buildLoader(entries);
    const unknown = address("So11111111111111111111111111111111111111112");
    const pool = mswapPoolKey(unknown, MINT_B);
    await expect(fetchMSwapPoolConfig(load, pool)).rejects.toThrow(
      `mint ${unknown} is not a whitelisted extension`,
    );
  });
});
