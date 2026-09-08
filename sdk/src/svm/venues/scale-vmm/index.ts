/**
 * Scale VMM (`scale_vmm`, program SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa) venue
 * adapter — the sibling bonding-curve program a pair trades on BEFORE it "graduates"
 * (migrates its liquidity into a real scale-amm Pool once `token_b_reserves` crosses
 * `graduation_threshold`). Same curve/fee math as scale-amm (see scale-common.ts), a
 * different account layout, and mandatory extra accounts for the migration CPI that fires
 * atomically inside `buy`/`sell` when the threshold is crossed mid-trade.
 *
 * PairState account layout (327 bytes, disc e5d4dedebf80b0eb — sha256("account:PairState")):
 *   enabled:bool@8  graduated:bool@9  mint_a:pubkey@10  mint_b:pubkey@42
 *   token_a_reserves:u128@74  token_b_reserves:u128@90  shift:u128@106
 *   curve:u8@122  fee_beneficiary_count:u8@123  fee_beneficiaries:[FeeBeneficiary;5]@124
 *   amm_pool:pubkey@294  bump:u8@326
 * PlatformConfig (PDA seeds=["config"] under THIS program — same disc/offsets as
 * scale-amm's, plus a trailing graduation_threshold:u64@106, bump moves to @114).
 *
 * GRADUATION GATE: a graduated pair's `enabled` is false and its reserves are drained to
 * 0 (verified live: pair BWnowWbMBTfsLzTKgZM7vnh8SxbutJA2HB4z7Labswkb, graduated=true,
 * reserves 0/0, whose `quote_buy` reverts on-chain with AnchorError PairDisabled/6000) —
 * the migrated liquidity lives on in a REAL scale-amm Pool at `amm_pool`, independently
 * discoverable through scaleAmm's own gPA sweep. So the `enabled` gate alone (mirroring
 * scale-amm's identical check) is sufficient; `graduated` is checked too, defensively,
 * since it is a stronger and independent signal of the same fact.
 *
 * MIGRATION ACCOUNTS (amm_pool/amm_vault_a/amm_vault_b/amm_config) are REQUIRED on every
 * `buy`/`sell`, not just a graduating one — the IDL's fixed IDL account list carries them
 * unconditionally (Anchor CPIs into scale_amm's `create_from_vmm` only when the trade
 * actually crosses the threshold, but the accounts must be validly derived up front
 * regardless). Their PDA derivation was reverse-engineered from a live, non-graduating
 * buy transaction (WgDtuzy7QjrCPRyFxZBuwQQ6UHrPFRpEgggukmVSBk6QFmMdLm6HFHji1AeXNLtQFeGdV1JeaqwYaNFsXSmHScr)
 * and confirmed to reproduce all three addresses byte-exact:
 *   amm_pool    = PDA(scale_amm, ["pool", THIS PairState's own address, mint_a, mint_b])
 *   amm_vault_a = PDA(scale_amm, [amm_pool, mint_a])
 *   amm_vault_b = PDA(scale_amm, [amm_pool, mint_b])
 *   amm_config  = PDA(scale_amm, ["config"])   (the SAME constant PDA scale-amm.ts uses)
 * i.e. the migrated pool's "owner" (scale-amm Pool PDA seed) is the VMM PairState's OWN
 * address, not a wallet — the VMM program CPI-signs `create_from_vmm` for it via
 * `invoke_signed` over the pair's own seeds.
 *
 * REMAINING ACCOUNTS: SAME pattern as scale-amm (see that file's module doc) — one extra
 * writable account per ACTIVE fee_beneficiary, ata(mint_a) of that beneficiary's wallet.
 * A first pass at this file (going only off a live transaction's account COUNT) concluded
 * VMM carries none; that was wrong, and the real-CPI lane
 * (the consuming app scale real-CPI e2e test) caught it immediately: omitting the remaining
 * account reverts on-chain with AnchorError MissingBeneficiaryAccount (6013). The
 * confusion: that reference transaction's beneficiary wallet happened to be the SAME
 * wallet as the trader (its 19th account, the beneficiary's mint_a ATA, is therefore
 * byte-identical to user_ta_a's own ATA, an 18-vs-19-looking coincidence) — a reminder
 * that a real transaction's account COUNT is not proof of a fixed schema without checking
 * every address is what it claims to be.
 */
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig } from "../types.js";
import {
  ata,
  CONFIG_SEED,
  CURVE_CONSTANT_PRODUCT,
  detectTokenProgram,
  pda,
  POOL_SEED,
  pubkeyAt,
  readFeeBeneficiaries,
  readUintLE,
  SCALE_AMM_PROGRAM_ID,
  SCALE_VMM_PROGRAM_ID,
  type FeeBeneficiary,
  type ScaleDirection,
} from "../scale-common.js";

const SLUG = "scale-vmm";
const PAIR_SIZE = 327;
const PAIR_DISCRIMINATOR = Uint8Array.of(229, 212, 222, 222, 191, 128, 176, 235);
const CONFIG_DISCRIMINATOR = Uint8Array.of(160, 78, 128, 0, 248, 83, 230, 160);

const OFFSETS = {
  enabled: 8,
  graduated: 9,
  mintA: 10,
  mintB: 42,
  reservesA: 74,
  reservesB: 90,
  shift: 106,
  curve: 122,
  feeBeneficiaryCount: 123,
  feeBeneficiaries: 124,
} as const;
const CONFIG_OFFSETS = { feeBeneficiary: 40, platformFeeBps: 104 } as const;
const CONFIG_MIN_SIZE = 115;

function hasDiscriminator(data: Uint8Array, disc: Uint8Array): boolean {
  return data.length >= 8 && disc.every((byte, i) => data[i] === byte);
}

export interface ScaleVmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
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
  ammPool: Address;
  ammVaultA: Address;
  ammVaultB: Address;
  ammConfig: Address;
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

export const scaleVmm = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: SCALE_VMM_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pair: Address): Promise<ScaleVmmPoolConfig> {
    const data = await loadRequired(load, pair, "pair");
    if (data.length !== PAIR_SIZE) {
      throw new Error(`${SLUG} pair ${pair} data is ${data.length} bytes, expected ${PAIR_SIZE}`);
    }
    if (!hasDiscriminator(data, PAIR_DISCRIMINATOR)) {
      throw new Error(`${SLUG} pair ${pair} has a wrong discriminator (not a PairState account)`);
    }
    const enabled = data[OFFSETS.enabled] !== 0;
    const graduated = data[OFFSETS.graduated] !== 0;
    if (!enabled || graduated) {
      throw new Error(
        `${SLUG} pair ${pair} is ${graduated ? "graduated" : "disabled"} (liquidity has migrated off this account)`,
      );
    }
    const curve = data[OFFSETS.curve]!;
    if (curve !== CURVE_CONSTANT_PRODUCT) {
      throw new Error(
        `${SLUG} pair ${pair} uses curve type ${curve}, only ConstantProduct (0) is supported`,
      );
    }

    const mintA = pubkeyAt(data, OFFSETS.mintA);
    const mintB = pubkeyAt(data, OFFSETS.mintB);
    const reservesA = readUintLE(data, OFFSETS.reservesA, 16);
    const reservesB = readUintLE(data, OFFSETS.reservesB, 16);
    const shift = readUintLE(data, OFFSETS.shift, 16);
    const feeBeneficiaryCount = data[OFFSETS.feeBeneficiaryCount]!;
    const feeBeneficiaries = readFeeBeneficiaries(data, OFFSETS.feeBeneficiaries);

    const configPda = await pda([CONFIG_SEED], SCALE_VMM_PROGRAM_ID);
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

    const [vaultA, vaultB, platformFeeTaA, ammPool] = await Promise.all([
      pda([pair, mintA], SCALE_VMM_PROGRAM_ID),
      pda([pair, mintB], SCALE_VMM_PROGRAM_ID),
      ata(feeBeneficiaryWallet, mintA, tokenProgramA),
      pda([POOL_SEED, pair, mintA, mintB], SCALE_AMM_PROGRAM_ID),
    ]);
    const [ammVaultA, ammVaultB, ammConfig] = await Promise.all([
      pda([ammPool, mintA], SCALE_AMM_PROGRAM_ID),
      pda([ammPool, mintB], SCALE_AMM_PROGRAM_ID),
      pda([CONFIG_SEED], SCALE_AMM_PROGRAM_ID),
    ]);
    const beneficiaryAtas = await Promise.all(
      feeBeneficiaries
        .slice(0, feeBeneficiaryCount)
        .map((b) => ata(b.wallet, mintA, tokenProgramA)),
    );

    return {
      venue: SLUG,
      pool: pair,
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
      ammPool,
      ammVaultA,
      ammVaultB,
      ammConfig,
      direction: "aToB",
    };
  },
};
