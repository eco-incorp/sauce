/**
 * helium-treasury Token-2022 self-drop: a synthesized (otherwise valid)
 * TreasuryManagementV0 account whose supplyMint is a Token-2022 mint must make
 * fetchHeliumTreasuryPoolConfig REJECT (the graceful self-drop signal). The
 * legacy path (classic mints) passes the Token-2022 gate and proceeds to the
 * downstream circuit-breaker read.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fetchHeliumTreasuryPoolConfig } from "../../../src/svm/venues/helium-treasury/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("CcWf5D6BhUTv2tD4ebFFcmCdTUgBWMc8CqqoJvFHGGXi");
const TREASURY_MINT = address("So11111111111111111111111111111111111111112"); // HNT stand-in
const SUPPLY_MINT = address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"); // sub-token
const TREASURY = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // treasury token account

const MGMT_DISC = 0x3bd76e10d1786f44n;
const MGMT_ACCOUNT_SIZE = 228;
const SPL_TOKEN_ACCOUNT_SIZE = 165;

const codec = getAddressCodec();
function writeU64LE(buf: Uint8Array, off: number, val: bigint): void {
  let v = val;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}
function writePubkey(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

function buildMgmt(): Uint8Array {
  const data = new Uint8Array(MGMT_ACCOUNT_SIZE);
  writeU64LE(data, 0, MGMT_DISC); // Anchor discriminator (LE-read)
  writePubkey(data, 8, TREASURY_MINT); // OFF_TREASURY_MINT
  writePubkey(data, 40, SUPPLY_MINT); // OFF_SUPPLY_MINT
  writePubkey(data, 104, TREASURY); // OFF_TREASURY
  data[136] = 0; // curveTag = 0
  // k (u128 @137) = 0, freezeUnixTime (@153) left as 0 — neither gates the mint loop
  return data;
}

function buildTreasuryTokenAccount(): Uint8Array {
  const data = new Uint8Array(SPL_TOKEN_ACCOUNT_SIZE);
  writePubkey(data, 0, TREASURY_MINT); // SPL token account mint field
  return data;
}

function loaderFrom(map: Record<string, Uint8Array>): AccountLoader {
  return async (addr: Address) => map[addr] ?? null;
}

describe("helium-treasury Token-2022 self-drop", () => {
  it("REJECTS a treasury whose supplyMint is a Token-2022 mint", async () => {
    const load = loaderFrom({
      [POOL]: buildMgmt(),
      [TREASURY]: buildTreasuryTokenAccount(),
      [SUPPLY_MINT]: makeT22Mint(),
      // TREASURY_MINT (as a mint account) intentionally unreadable -> continue
    });
    await expect(fetchHeliumTreasuryPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("classic-legacy mints pass the Token-2022 gate (fails later on the breaker read)", async () => {
    const load = loaderFrom({
      [POOL]: buildMgmt(),
      [TREASURY]: buildTreasuryTokenAccount(),
      [SUPPLY_MINT]: makeLegacyMint(),
      [TREASURY_MINT]: makeLegacyMint(),
      // circuit breaker PDA intentionally not vendored
    });
    await expect(fetchHeliumTreasuryPoolConfig(load, POOL)).rejects.toThrow(/circuit breaker/i);
  });
});
