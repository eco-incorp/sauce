/**
 * Scale AMM (`scale_amm`, program SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA) venue
 * adapter — an Anchor-built constant-product/virtual-CP AMM (permissionless bonding-curve
 * style pool creation; 987 live `Pool` accounts observed at time of writing). See
 * scale-common.ts for the shared curve derivation and its empirical proof.
 *
 * Pool account layout (326 bytes, Anchor account disc f19a6d0411b16dbc — sha256("account:Pool")):
 *   enabled:bool@8  owner:pubkey@9  mint_a:pubkey@41  mint_b:pubkey@73
 *   token_a_reserves:u128@105  token_b_reserves:u128@121  shift:u128@137
 *   curve:u8@153  fee_beneficiary_count:u8@154  fee_beneficiaries:[FeeBeneficiary;5]@155
 *   (34 bytes each: wallet:pubkey + share_bps:u16)  bump:u8@325
 * PlatformConfig (PDA seeds=["config"], disc a04e8000f853e6a0 — sha256("account:PlatformConfig")):
 *   authority:pubkey@8  fee_beneficiary:pubkey@40  base_token:pubkey@72
 *   platform_fee_bps:u16@104  bump:u8@106
 *
 * vault_a/vault_b are PDAs seeds=[pool, mint_a]/[pool, mint_b] (no stored address —
 * derived, never read). `create`'s params take only `initial_token_b_reserves` (never
 * _a), confirming A is always the virtually-shifted side (see scale-common.ts).
 *
 * REMAINING ACCOUNTS (verified against a real mainnet `buy` transaction,
 * 5jqPoZ9Uw9kwNs4trJZ8EzuDd36vf8BLpMJgXXkgv26LK4uNAs57MLLYjSfudrCB2STUxxnGEurDKhRxPbiufCmv):
 * the 14 IDL-named accounts are followed by ONE extra writable account per ACTIVE
 * fee_beneficiary entry — that pool's beneficiary's own ATA(mint_a) (a
 * remaining_accounts pattern the IDL doesn't name). Confirmed byte-exact: the 15th
 * account on that (feeCount=1) pool's buy tx is exactly
 * ata(feeBeneficiaries[0].wallet, mint_a, TOKEN_PROGRAM). A feeCount=0 pool's real buy tx
 * carries exactly the 14 named accounts and nothing more. Because this changes the swap's
 * account-list LENGTH, feeBeneficiaryCount is part of shapeKey (see below) — pools with a
 * different active-beneficiary count cannot share a compiled slot fragment.
 */
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig, AccountBytesMap } from "../types.js";
import {
  ata,
  computeScaleQuote,
  CONFIG_SEED,
  CURVE_CONSTANT_PRODUCT,
  detectTokenProgram,
  pda,
  pubkeyAt,
  readFeeBeneficiaries,
  readUintLE,
  SCALE_AMM_PROGRAM_ID,
  type FeeBeneficiary,
  type ScaleCurveState,
  type ScaleDirection,
} from "../scale-common.js";

const SLUG = "scale-amm";
const POOL_SIZE = 326;
const POOL_DISCRIMINATOR = Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188);
const CONFIG_DISCRIMINATOR = Uint8Array.of(160, 78, 128, 0, 248, 83, 230, 160);

const OFFSETS = {
  enabled: 8,
  owner: 9,
  mintA: 41,
  mintB: 73,
  reservesA: 105,
  reservesB: 121,
  shift: 137,
  curve: 153,
  feeBeneficiaryCount: 154,
  feeBeneficiaries: 155,
} as const;
const CONFIG_OFFSETS = { feeBeneficiary: 40, platformFeeBps: 104 } as const;
const CONFIG_MIN_SIZE = 107;

function hasDiscriminator(data: Uint8Array, disc: Uint8Array): boolean {
  return data.length >= 8 && disc.every((byte, i) => data[i] === byte);
}

export interface ScaleAmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  owner: Address;
  mintA: Address;
  mintB: Address;
  reservesA: bigint;
  reservesB: bigint;
  shift: bigint;
  feeBeneficiaryCount: number;
  feeBeneficiaries: readonly FeeBeneficiary[];
  vaultA: Address;
  vaultB: Address;
  platformConfig: Address;
  platformFeeBps: bigint;
  platformFeeTaA: Address;
  /** ATA(mint_a) per ACTIVE (index < feeBeneficiaryCount) beneficiary — the remaining_accounts. */
  beneficiaryAtas: readonly Address[];
  tokenProgramA: Address;
  tokenProgramB: Address;
  /** 'aToB' (default, buy: mint_a in / mint_b out) | 'bToA' (sell: mint_b in / mint_a out). */
  direction: ScaleDirection;
}

async function loadRequired(
  load: AccountLoader,
  addr: Address,
  label: string,
): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`${SLUG}: ${label} ${addr} not found`);
  return data;
}

function stateOf(cfg: ScaleAmmPoolConfig): ScaleCurveState {
  return {
    reservesA: cfg.reservesA,
    reservesB: cfg.reservesB,
    shift: cfg.shift,
    platformFeeBps: cfg.platformFeeBps,
    shareBps: cfg.feeBeneficiaries.map((b) => BigInt(b.shareBps)),
  };
}

function amm(cfg: PoolConfig): ScaleAmmPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a '${cfg.venue}' pool config`);
  return cfg as ScaleAmmPoolConfig;
}

export const scaleAmm = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: SCALE_AMM_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<ScaleAmmPoolConfig> {
    const data = await loadRequired(load, pool, "pool");
    if (data.length !== POOL_SIZE) {
      throw new Error(`${SLUG} pool ${pool} data is ${data.length} bytes, expected ${POOL_SIZE}`);
    }
    if (!hasDiscriminator(data, POOL_DISCRIMINATOR)) {
      throw new Error(`${SLUG} pool ${pool} has a wrong discriminator (not a Pool account)`);
    }
    const enabled = data[OFFSETS.enabled] !== 0;
    if (!enabled) throw new Error(`${SLUG} pool ${pool} is disabled`);
    const curve = data[OFFSETS.curve]!;
    if (curve !== CURVE_CONSTANT_PRODUCT) {
      throw new Error(
        `${SLUG} pool ${pool} uses curve type ${curve}, only ConstantProduct (0) is supported`,
      );
    }

    const owner = pubkeyAt(data, OFFSETS.owner);
    const mintA = pubkeyAt(data, OFFSETS.mintA);
    const mintB = pubkeyAt(data, OFFSETS.mintB);
    const reservesA = readUintLE(data, OFFSETS.reservesA, 16);
    const reservesB = readUintLE(data, OFFSETS.reservesB, 16);
    const shift = readUintLE(data, OFFSETS.shift, 16);
    const feeBeneficiaryCount = data[OFFSETS.feeBeneficiaryCount]!;
    const feeBeneficiaries = readFeeBeneficiaries(data, OFFSETS.feeBeneficiaries);

    const configPda = await pda([CONFIG_SEED], SCALE_AMM_PROGRAM_ID);
    const configData = await loadRequired(load, configPda, "platform config");
    if (
      configData.length < CONFIG_MIN_SIZE ||
      !hasDiscriminator(configData, CONFIG_DISCRIMINATOR)
    ) {
      throw new Error(`${SLUG} platform config ${configPda} has a wrong discriminator or size`);
    }
    const feeBeneficiaryWallet = pubkeyAt(configData, CONFIG_OFFSETS.feeBeneficiary);
    const platformFeeBps = readUintLE(configData, CONFIG_OFFSETS.platformFeeBps, 2);

    const [mintAData, mintBData] = await Promise.all([
      loadRequired(load, mintA, "mint_a"),
      loadRequired(load, mintB, "mint_b"),
    ]);
    const tokenProgramA = detectTokenProgram(mintA, mintAData);
    const tokenProgramB = detectTokenProgram(mintB, mintBData);

    const [vaultA, vaultB, platformFeeTaA] = await Promise.all([
      pda([pool, mintA], SCALE_AMM_PROGRAM_ID),
      pda([pool, mintB], SCALE_AMM_PROGRAM_ID),
      ata(feeBeneficiaryWallet, mintA, tokenProgramA),
    ]);
    const beneficiaryAtas = await Promise.all(
      feeBeneficiaries
        .slice(0, feeBeneficiaryCount)
        .map((b) => ata(b.wallet, mintA, tokenProgramA)),
    );

    return {
      venue: SLUG,
      pool,
      owner,
      mintA,
      mintB,
      reservesA,
      reservesB,
      shift,
      feeBeneficiaryCount,
      feeBeneficiaries,
      vaultA,
      vaultB,
      platformConfig: configPda,
      platformFeeBps,
      platformFeeTaA,
      beneficiaryAtas,
      tokenProgramA,
      tokenProgramB,
      direction: "aToB",
    };
  },

  referenceQuote(base: PoolConfig, state: AccountBytesMap, amountIn: bigint): bigint {
    const cfg = amm(base);
    return computeScaleQuote(stateOf(cfg), amountIn, cfg.direction);
  },
};

export type { ScaleDirection } from "../scale-common.js";
