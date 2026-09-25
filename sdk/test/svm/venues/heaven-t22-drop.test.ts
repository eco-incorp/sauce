/**
 * heaven Token-2022 handling (no engine, no RPC — hand-built account bytes).
 *
 * heaven prices token_a (a launched, frequently Token-2022 token) against
 * wrapped SOL (token_b) and threads each side's program from the pool. Its own
 * design already ROUTES a zero-effective-bps Token-2022 token (LIGHT's scheduled
 * fee removal is the motivating case) and self-drops a nonzero active fee. This
 * suite locks that in and covers the new blocking-extension self-drop:
 *   - a zero-fee Token-2022 token_a ROUTES;
 *   - a legacy token_a resolves identically (control);
 *   - a NONZERO active transfer fee self-drops (fee-netting is a consuming-app
 *     follow-up — see the venue's TODO(t22-fee-netting));
 *   - a NonTransferable (blocking) token_a self-drops.
 */
import { getAddressCodec, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { heaven, type HeavenPoolConfig } from "../../../src/svm/venues/heaven/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import {
  makeLegacyMint,
  makeT22Mint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

// fetchHeavenPoolConfig is module-local; drive it through the venue facade.
const fetchHeavenPoolConfig = (load: AccountLoader, pool: Address): Promise<HeavenPoolConfig> =>
  heaven.fetchPoolConfig(load, pool) as Promise<HeavenPoolConfig>;

const codec = getAddressCodec();
const decoder = getAddressDecoder();

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const WSOL = "So11111111111111111111111111111111111111112" as Address;
const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
const CHAINLINK = "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt" as Address;

const pk = (seed: number): Address =>
  decoder.decode(Uint8Array.from({ length: 32 }, (_, i) => ((i * seed + seed) % 250) + 1));

const POOL = pk(3);
const PROTOCOL_CONFIG = pk(5);
const VAULT_A = pk(7);
const VAULT_B = pk(9);
const MINT_A = pk(13);

const POOL_DISC = [190, 158, 220, 130, 15, 162, 132, 252];
const POOL_SIZE = 2304;
const PROTOCOL_CONFIG_SIZE = 1792;

function u64(data: Uint8Array, off: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[off + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}
function u32(data: Uint8Array, off: number, value: number): void {
  for (let i = 0; i < 4; i++) data[off + i] = (value >>> (8 * i)) & 0xff;
}
function setPk(data: Uint8Array, off: number, addr: Address): void {
  data.set(new Uint8Array(codec.encode(addr)), off);
}

/** TransferFeeConfig TLV (extension type 1): only `newer` matters — older stays 0. */
function feeTlv(newerBps: number, newerEpoch = 0): Uint8Array {
  const v = new Uint8Array(108);
  u64(v, 90, BigInt(newerEpoch));
  v[106] = newerBps & 0xff;
  v[107] = (newerBps >> 8) & 0xff;
  return tlvEntry(1, v);
}

function poolBytes(tokenAProgram: Address): Uint8Array {
  const d = new Uint8Array(POOL_SIZE);
  d.set(POOL_DISC, 0);
  d[90] = 2; // LiquidityPoolType::Standard
  u64(d, 456, 1_000_000n); // reserve_a
  u64(d, 464, 1_000_000n); // reserve_b
  u64(d, 632, 0n); // created_at_slot
  setPk(d, 664, VAULT_A);
  setPk(d, 696, VAULT_B);
  setPk(d, 728, PROTOCOL_CONFIG);
  setPk(d, 792, MINT_A); // token_a mint
  setPk(d, 825, tokenAProgram); // token_a owner (= token program)
  setPk(d, 857, WSOL); // token_b mint (gated to WSOL)
  setPk(d, 890, TOKENKEG); // token_b owner
  d[938] = 0; // taxable_side_type
  d[941] = 1; // fee_configuration_mode = Local (read pool's own fee brackets)
  // OFF_SLOT_FEES_BASE (956) region left zero -> every anti-snipe window disabled.
  // OFF_MCAP_FEES_BASE (96) region left zero -> every fee bracket count 0 -> 0 fees.
  return d;
}
function protocolConfigBytes(): Uint8Array {
  return new Uint8Array(PROTOCOL_CONFIG_SIZE); // slot/mcap fee regions all zero -> inert
}
function clockBytes(slot: bigint, epoch: bigint): Uint8Array {
  const d = new Uint8Array(40);
  u64(d, 0, slot);
  u64(d, 16, epoch);
  return d;
}
function chainlinkBytes(): Uint8Array {
  const d = new Uint8Array(248);
  d[138] = 8; // decimals
  u32(d, 148, 1); // live_length
  u32(d, 152, 0); // live_cursor
  // one transmission at offset 200: answer (i128 LE) @ +16 = 216
  u64(d, 216, 100_000_000n); // 1e8 == $1 at 8 decimals (positive)
  return d;
}

function loaderWith(tokenAMint: Uint8Array, tokenAProgram: Address, epoch = 100n): AccountLoader {
  const map: Record<string, Uint8Array> = {
    [POOL]: poolBytes(tokenAProgram),
    [PROTOCOL_CONFIG]: protocolConfigBytes(),
    [CLOCK]: clockBytes(1000n, epoch),
    [MINT_A]: tokenAMint,
    [WSOL]: makeLegacyMint(),
    [CHAINLINK]: chainlinkBytes(),
  };
  return (async (a: string) => map[a] ?? null) as unknown as AccountLoader;
}

describe("heaven Token-2022 handling", () => {
  it("resolves a plain legacy token_a pool (control — legacy path unchanged)", async () => {
    const cfg = await fetchHeavenPoolConfig(loaderWith(makeLegacyMint(), TOKENKEG), POOL);
    expect(cfg.venue).toBe("heaven");
    expect(cfg.tokenAProgram).toBe(TOKENKEG);
    expect(cfg.tokenBMint).toBe(WSOL);
  });

  it("ROUTES a zero-fee Token-2022 token_a (not dropped)", async () => {
    const cfg = await fetchHeavenPoolConfig(loaderWith(makeT22Mint(), TOKEN_2022), POOL);
    expect(cfg.tokenAProgram).toBe(TOKEN_2022);
  });

  it("ROUTES a Token-2022 token_a whose transfer fee is effectively 0 bps", async () => {
    const cfg = await fetchHeavenPoolConfig(loaderWith(makeT22Mint(feeTlv(0)), TOKEN_2022), POOL);
    expect(cfg.tokenAProgram).toBe(TOKEN_2022);
  });

  it("SELF-DROPS a Token-2022 token_a with a NONZERO active transfer fee", async () => {
    await expect(
      fetchHeavenPoolConfig(loaderWith(makeT22Mint(feeTlv(150)), TOKEN_2022), POOL),
    ).rejects.toThrow(/ACTIVE Token-2022 transfer fee/);
  });

  it("SELF-DROPS a NonTransferable (blocking) Token-2022 token_a", async () => {
    await expect(
      fetchHeavenPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV), TOKEN_2022), POOL),
    ).rejects.toThrow(/un-routable/);
  });
});
