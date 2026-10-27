/**
 * raydium-launchlab Token-2022 handling. The base mint's token program is
 * resolved per mint (via PoolState.token_program_flag, then the mint's own
 * TLV); the quote side is IDL-constrained to legacy Tokenkeg. A zero-fee /
 * advisory-only Token-2022 base mint must PASS the token gate (control then
 * reaches the global-config discriminator check — the "passed the gate" signal,
 * mirroring the perena-star self-drop test), a legacy mint reaches the same
 * point, and only a blocking (NonTransferable / frozen) mint self-drops. A
 * TransferFeeConfig mint stays rejected (fee netting is a documented follow-up
 * — see TODO(t22-fee-netting) in the adapter). An 82-byte base mint carries no
 * extension, so its program is its OWNER: an extensionless Token-2022 mint is
 * byte for byte a legacy one.
 *
 * No mainnet fixture is vendored, so this builds a minimal synthetic 429-byte
 * PoolState.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import {
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  raydiumLaunchlab,
} from "../../../src/svm/venues/raydium-launchlab/index.js";
import {
  makeT22Mint,
  makeLegacyMint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const POOL = address("At3uPTXn5xpVfm4DehXCsm85Zzu1xktGV2vQo5TyBW2E");
const GLOBAL_CONFIG = address("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const PLATFORM_CONFIG = address("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
const BASE_MINT = address("So11111111111111111111111111111111111111112");
const QUOTE_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const POOL_STATE_DISCRIMINATOR = [247, 237, 227, 245, 215, 195, 222, 70];
const GLOBAL_CONFIG_DISCRIMINATOR = [149, 8, 156, 202, 160, 252, 176, 217];
const PLATFORM_CONFIG_DISCRIMINATOR = [160, 78, 128, 0, 248, 83, 230, 160];

/** A minimal 429-byte PoolState: disc, status=Fund(0), token_program_flag, and the referenced pubkeys. */
function makePoolState(tokenProgramFlag: number): Uint8Array {
  const buf = new Uint8Array(429);
  buf.set(POOL_STATE_DISCRIMINATOR, 0);
  buf[17] = 0; // status = 0 (Fund)
  buf[365] = tokenProgramFlag;
  const codec = getAddressCodec();
  buf.set(codec.encode(GLOBAL_CONFIG), 141);
  buf.set(codec.encode(PLATFORM_CONFIG), 173);
  buf.set(codec.encode(BASE_MINT), 205);
  buf.set(codec.encode(QUOTE_MINT), 237);
  return buf;
}

type Account = { data: Uint8Array; owner: Address };
const t22 = (data: Uint8Array): Account => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (data: Uint8Array): Account => ({ data, owner: TOKEN_PROGRAM_ID });

/** A config account: its discriminator, then zeros (global config curve_type@16 = 0, Constant). */
function configAccount(discriminator: number[]): Account {
  const data = new Uint8Array(64);
  data.set(discriminator, 0);
  return { data, owner: RAYDIUM_LAUNCHLAB_PROGRAM_ID };
}

/**
 * `validConfigs` false: both config accounts are present with a wrong
 * discriminator, so passing the token gate surfaces the global-config mismatch.
 * true: both configs are valid and the fetch resolves to a config.
 */
function loaderWith(flag: number, mint: Account | null, validConfigs = false): OwnedAccountLoader {
  const pool = makePoolState(flag);
  const config = (discriminator: number[]): Account =>
    validConfigs
      ? configAccount(discriminator)
      : { data: new Uint8Array(8), owner: RAYDIUM_LAUNCHLAB_PROGRAM_ID };
  return async (addr) => {
    if (addr === POOL) return { data: new Uint8Array(pool), owner: RAYDIUM_LAUNCHLAB_PROGRAM_ID };
    if (addr === BASE_MINT)
      return mint === null ? null : { data: new Uint8Array(mint.data), owner: mint.owner };
    if (addr === GLOBAL_CONFIG) return config(GLOBAL_CONFIG_DISCRIMINATOR);
    if (addr === PLATFORM_CONFIG) return config(PLATFORM_CONFIG_DISCRIMINATOR);
    return null;
  };
}

describe("raydium-launchlab Token-2022 handling", () => {
  it("passes the token gate for a zero-fee (extensionless) Token-2022 base mint", async () => {
    // Passing resolveBaseTokenProgram surfaces the (deliberately wrong)
    // global-config discriminator — proof the Token-2022 base mint was NOT dropped.
    await expect(
      raydiumLaunchlab.fetchPoolConfig(loaderWith(1, t22(makeT22Mint())), POOL),
    ).rejects.toThrow(`raydium-launchlab global config ${GLOBAL_CONFIG} discriminator mismatch`);
  });

  it("passes the token gate for a legacy base mint (flag 0, byte-identical legacy path)", async () => {
    await expect(
      raydiumLaunchlab.fetchPoolConfig(loaderWith(0, legacy(makeLegacyMint())), POOL),
    ).rejects.toThrow(`raydium-launchlab global config ${GLOBAL_CONFIG} discriminator mismatch`);
  });

  it("resolves an 82-byte base mint owned by Token-2022 (extensionless) to Token-2022", async () => {
    const cfg = await raydiumLaunchlab.fetchPoolConfig(
      loaderWith(1, t22(makeLegacyMint()), true),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("resolves an 82-byte base mint owned by Tokenkeg to Tokenkeg (legacy unchanged)", async () => {
    const cfg = await raydiumLaunchlab.fetchPoolConfig(
      loaderWith(1, legacy(makeLegacyMint()), true),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_PROGRAM_ID);
  });

  it("drops the pool when the base mint carries a blocking NonTransferable extension", async () => {
    await expect(
      raydiumLaunchlab.fetchPoolConfig(loaderWith(1, t22(makeT22Mint(NON_TRANSFERABLE_TLV))), POOL),
    ).rejects.toThrow(/un-routable/);
  });

  it("still rejects a TransferFeeConfig base mint (fee-netting is a documented follow-up)", async () => {
    await expect(
      raydiumLaunchlab.fetchPoolConfig(
        loaderWith(1, t22(makeT22Mint(tlvEntry(1, new Uint8Array(108))))),
        POOL,
      ),
    ).rejects.toThrow(/TransferFeeConfig/);
  });
});
