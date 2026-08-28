/**
 * fluxbeam Token-2022 handling (no engine, no RPC — hand-built account bytes).
 *
 * fluxbeam is a Token-2022-capable constant-product AMM: fetchFluxBeamPoolConfig
 * already resolves each leg's owning program per mint (scanMint) and BAKES the
 * active TransferFeeConfig tier (feeA/feeB) so the quote can net it — it does NOT
 * reject a fee-bearing mint. This suite locks that in:
 *   - a legacy pool resolves with both legs Tokenkeg and zero fees (control);
 *   - a ZERO-fee Token-2022 leg ROUTES (Token-2022 program, zero baked fee);
 *   - a NONZERO transfer-fee Token-2022 leg is HANDLED (fee baked, not dropped);
 *   - NonTransferable / TransferHook legs self-drop (genuinely un-routable).
 */
import { getAddressCodec, getAddressDecoder } from '@solana/kit';
import type { Address } from '@solana/kit';
import { fetchFluxBeamPoolConfig, FLUXBEAM_POOL_SIZE } from '../../../src/svm/venues/fluxbeam/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeLegacyMint, makeT22Mint, tlvEntry, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const codec = getAddressCodec();
const decoder = getAddressDecoder();

const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;
const CLOCK = 'SysvarC1ock11111111111111111111111111111111' as Address;

const pk = (seed: number): Address =>
  decoder.decode(Uint8Array.from({ length: 32 }, (_, i) => ((i * seed + seed) % 250) + 1));

const POOL = pk(3);
const VAULT_A = pk(7);
const VAULT_B = pk(9);
const POOL_MINT = pk(11);
const MINT_A = pk(13);
const MINT_B = pk(17);
const POOL_FEE = pk(19);

function u64(data: Uint8Array, off: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[off + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}
function setPk(data: Uint8Array, off: number, addr: Address): void {
  data.set(new Uint8Array(codec.encode(addr)), off);
}

/** TransferFeeConfig TLV (extension type 1): only `newer` matters — older stays 0. */
function feeTlv(newerBps: number, newerEpoch = 0): Uint8Array {
  const v = new Uint8Array(108);
  u64(v, 90, BigInt(newerEpoch)); // newer.epoch
  v[106] = newerBps & 0xff; // newer.bps
  v[107] = (newerBps >> 8) & 0xff;
  return tlvEntry(1, v);
}

function poolBytes(): Uint8Array {
  const d = new Uint8Array(FLUXBEAM_POOL_SIZE);
  d[0] = 1; // version
  d[1] = 1; // is_initialized
  d[2] = 255; // bump_seed
  setPk(d, 3, TOKEN_2022); // token_program (pool_mint side — always T22 on fluxbeam)
  setPk(d, 35, VAULT_A);
  setPk(d, 67, VAULT_B);
  setPk(d, 99, POOL_MINT);
  setPk(d, 131, MINT_A);
  setPk(d, 163, MINT_B);
  setPk(d, 195, POOL_FEE);
  u64(d, 227, 20n); // trade_fee_numerator
  u64(d, 235, 1000n); // trade_fee_denominator
  u64(d, 243, 5n); // owner_trade_fee_numerator
  u64(d, 251, 1000n); // owner_trade_fee_denominator
  d[291] = 0; // curve_type: constant product
  return d;
}
function clockBytes(epoch: bigint): Uint8Array {
  const d = new Uint8Array(40);
  u64(d, 16, epoch);
  return d;
}

function loaderWith(mintA: Uint8Array, mintB: Uint8Array, epoch = 0n): AccountLoader {
  const map: Record<string, Uint8Array> = {
    [POOL]: poolBytes(),
    [MINT_A]: mintA,
    [MINT_B]: mintB,
    [CLOCK]: clockBytes(epoch),
  };
  return (async (a: string) => map[a] ?? null) as unknown as AccountLoader;
}

describe('fluxbeam Token-2022 handling', () => {
  it('resolves a plain legacy pool with zero fees (control — legacy path unchanged)', async () => {
    const cfg = await fetchFluxBeamPoolConfig(loaderWith(makeLegacyMint(), makeLegacyMint()), POOL);
    expect(cfg.tokenProgramA).toBe(TOKENKEG);
    expect(cfg.tokenProgramB).toBe(TOKENKEG);
    expect(cfg.feeA).toEqual({ bps: 0n, max: 0n });
    expect(cfg.feeB).toEqual({ bps: 0n, max: 0n });
  });

  it('ROUTES a zero-fee Token-2022 leg (Token-2022 program, zero baked fee)', async () => {
    const cfg = await fetchFluxBeamPoolConfig(loaderWith(makeT22Mint(), makeLegacyMint()), POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_2022);
    expect(cfg.tokenProgramB).toBe(TOKENKEG);
    expect(cfg.feeA).toEqual({ bps: 0n, max: 0n });
  });

  it('HANDLES a nonzero transfer-fee Token-2022 leg (fee baked, NOT dropped)', async () => {
    const cfg = await fetchFluxBeamPoolConfig(loaderWith(makeT22Mint(feeTlv(200)), makeLegacyMint(), 100n), POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_2022);
    expect(cfg.feeA.bps).toBe(200n);
    expect(cfg.feeB).toEqual({ bps: 0n, max: 0n });
  });

  it('SELF-DROPS a NonTransferable Token-2022 leg', async () => {
    await expect(
      fetchFluxBeamPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV), makeLegacyMint()), POOL),
    ).rejects.toThrow(/NonTransferable/);
  });

  it('SELF-DROPS a TransferHook Token-2022 leg', async () => {
    await expect(
      fetchFluxBeamPoolConfig(loaderWith(makeT22Mint(tlvEntry(14, new Uint8Array(64))), makeLegacyMint()), POOL),
    ).rejects.toThrow(/TransferHook/);
  });
});
