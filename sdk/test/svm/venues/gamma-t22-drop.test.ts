/**
 * gamma Token-2022 handling (no engine, no RPC — hand-built account bytes).
 *
 * gamma is a raydium-cp-swap fork whose PoolState stores each leg's owning
 * program (token_0/1_program), and whose 13-account swap ix threads them per
 * side — so a Token-2022 mint IS routable here. This suite proves:
 *   - a legacy pool resolves unchanged (control);
 *   - a ZERO-fee Token-2022 mint ROUTES (is not dropped);
 *   - a zero-BPS TransferFeeConfig (present but effectively 0) ALSO routes —
 *     the gate is on the EFFECTIVE epoch-selected fee, not mere presence;
 *   - a NONZERO effective transfer fee self-drops (fee-netting is a
 *     consuming-app follow-up — see the venue's TODO(t22-fee-netting));
 *   - a NonTransferable (blocking) extension self-drops.
 */
import { getAddressCodec, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { fetchGammaPoolConfig } from "../../../src/svm/venues/gamma/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import {
  makeLegacyMint,
  makeT22Mint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const codec = getAddressCodec();
const decoder = getAddressDecoder();

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;

const pk = (seed: number): Address =>
  decoder.decode(Uint8Array.from({ length: 32 }, (_, i) => ((i * seed + seed) % 250) + 1));

const POOL = pk(3);
const AMM_CONFIG = pk(5);
const VAULT0 = pk(7);
const VAULT1 = pk(9);
const MINT0 = pk(11);
const MINT1 = pk(13);
const OBSERVATION = pk(15);

const POOL_DISC = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];
const CFG_DISC = [0xda, 0xf4, 0x21, 0x68, 0xcb, 0xcb, 0x2b, 0x6f];

function u64(data: Uint8Array, off: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[off + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}
function setPk(data: Uint8Array, off: number, addr: Address): void {
  data.set(new Uint8Array(codec.encode(addr)), off);
}

/** TransferFeeConfig TLV (extension type 1): only `newer` matters here — older stays 0. */
function feeTlv(newerBps: number, newerEpoch = 0): Uint8Array {
  const v = new Uint8Array(108); // authority(32)+withdrawAuth(32)+withheld(8)+older(18)+newer(18)
  u64(v, 90, BigInt(newerEpoch)); // newer.epoch @ value+90
  v[106] = newerBps & 0xff; // newer.transfer_fee_basis_points @ value+90+16
  v[107] = (newerBps >> 8) & 0xff;
  return tlvEntry(1, v);
}

function poolBytes(p0: Address, p1: Address): Uint8Array {
  const d = new Uint8Array(637);
  d.set(POOL_DISC, 0);
  setPk(d, 8, AMM_CONFIG);
  setPk(d, 72, VAULT0);
  setPk(d, 104, VAULT1);
  setPk(d, 168, MINT0);
  setPk(d, 200, MINT1);
  setPk(d, 232, p0);
  setPk(d, 264, p1);
  setPk(d, 296, OBSERVATION);
  d[329] = 0; // status: swaps enabled
  u64(d, 373, 0n); // open_time: always open
  u64(d, 461, 20_000n); // max_trade_fee_rate
  u64(d, 477, 1_000_000n); // token_0_vault_amount
  u64(d, 485, 1_000_000n); // token_1_vault_amount
  return d;
}
function cfgBytes(): Uint8Array {
  const d = new Uint8Array(236);
  d.set(CFG_DISC, 0);
  return d;
}
function vaultBytes(mint: Address, amount: bigint): Uint8Array {
  const d = new Uint8Array(165);
  setPk(d, 0, mint);
  u64(d, 64, amount);
  return d;
}
function clockBytes(epoch: bigint): Uint8Array {
  const d = new Uint8Array(40);
  u64(d, 16, epoch);
  return d;
}

interface Opts {
  mint0: Uint8Array;
  mint1?: Uint8Array;
  p0: Address;
  p1?: Address;
  epoch?: bigint;
}
function loaderWith(o: Opts): AccountLoader {
  const map: Record<string, Uint8Array> = {
    [POOL]: poolBytes(o.p0, o.p1 ?? TOKENKEG),
    [AMM_CONFIG]: cfgBytes(),
    [VAULT0]: vaultBytes(MINT0, 1_000_000n),
    [VAULT1]: vaultBytes(MINT1, 1_000_000n),
    [MINT0]: o.mint0,
    [MINT1]: o.mint1 ?? makeLegacyMint(),
    [CLOCK]: clockBytes(o.epoch ?? 0n),
  };
  return (async (a: string) => map[a] ?? null) as unknown as AccountLoader;
}

describe("gamma Token-2022 handling", () => {
  it("resolves a plain legacy pool (control — legacy path unchanged)", async () => {
    const cfg = await fetchGammaPoolConfig(
      loaderWith({ mint0: makeLegacyMint(), p0: TOKENKEG }),
      POOL,
    );
    expect(cfg.venue).toBe("gamma");
    expect(cfg.token0Program).toBe(TOKENKEG);
    expect(cfg.token1Program).toBe(TOKENKEG);
    expect(cfg.token0Mint).toBe(MINT0);
    expect(cfg.token1Mint).toBe(MINT1);
  });

  it("ROUTES a zero-fee Token-2022 mint (not dropped)", async () => {
    const cfg = await fetchGammaPoolConfig(
      loaderWith({ mint0: makeT22Mint(), p0: TOKEN_2022 }),
      POOL,
    );
    expect(cfg.token0Program).toBe(TOKEN_2022);
    expect(cfg.token1Program).toBe(TOKENKEG); // opposite side stays legacy
  });

  it("ROUTES a Token-2022 mint whose TransferFeeConfig is effectively 0 bps", async () => {
    const cfg = await fetchGammaPoolConfig(
      loaderWith({ mint0: makeT22Mint(feeTlv(0)), p0: TOKEN_2022, epoch: 100n }),
      POOL,
    );
    expect(cfg.token0Program).toBe(TOKEN_2022);
  });

  it("SELF-DROPS a Token-2022 mint with a NONZERO active transfer fee", async () => {
    await expect(
      fetchGammaPoolConfig(
        loaderWith({ mint0: makeT22Mint(feeTlv(100)), p0: TOKEN_2022, epoch: 100n }),
        POOL,
      ),
    ).rejects.toThrow(/ACTIVE 100bps token-2022 transfer fee/);
  });

  it("SELF-DROPS a NonTransferable (blocking) Token-2022 mint", async () => {
    await expect(
      fetchGammaPoolConfig(
        loaderWith({ mint0: makeT22Mint(NON_TRANSFERABLE_TLV), p0: TOKEN_2022 }),
        POOL,
      ),
    ).rejects.toThrow(/un-routable/);
  });
});
