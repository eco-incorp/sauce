/**
 * scale-amm Token-2022 handling: a zero-fee Token-2022 mint on either side ROUTES
 * (is NOT dropped) and threads its own token program into the per-side ATA
 * derivations, while a legacy pool decodes byte-identically and quotes the same.
 * A NonTransferable mint self-drops; a TransferFeeConfig mint is still rejected
 * (see the TODO(t22-fee-netting) note in scale-common.ts).
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { scaleAmm, type ScaleAmmPoolConfig } from "../../../src/svm/venues/scale-amm/index.js";
import {
  ata,
  CONFIG_SEED,
  pda,
  SCALE_AMM_PROGRAM_ID,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../../src/svm/venues/scale-common.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import {
  makeLegacyMint,
  makeT22Mint,
  NON_TRANSFERABLE_TLV,
  tlvEntry,
} from "../fixtures/token-2022/synth.js";

const dec = getAddressDecoder();
const addrFromByte = (b: number): Address => dec.decode(new Uint8Array(32).fill(b));

const POOL_DISCRIMINATOR = Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188);
const CONFIG_DISCRIMINATOR = Uint8Array.of(160, 78, 128, 0, 248, 83, 230, 160);

const POOL = addrFromByte(1);
const OWNER = addrFromByte(2);
const FEE_WALLET = addrFromByte(3);
const MINT_A = addrFromByte(11);
const MINT_B = addrFromByte(13);

const RESERVES_B = 1_000_000_000n;
const SHIFT = 1_000_000_000n;

function writeU128LE(data: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 16; i++) {
    data[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

const aenc = getAddressEncoder();
function putAddr(data: Uint8Array, offset: number, addr: Address): void {
  data.set(new Uint8Array(aenc.encode(addr)), offset);
}

function pool(): Uint8Array {
  const data = new Uint8Array(326);
  data.set(POOL_DISCRIMINATOR, 0);
  data[8] = 1; // enabled
  putAddr(data, 9, OWNER);
  putAddr(data, 41, MINT_A);
  putAddr(data, 73, MINT_B);
  writeU128LE(data, 105, 0n); // reservesA
  writeU128LE(data, 121, RESERVES_B); // reservesB
  writeU128LE(data, 137, SHIFT); // shift
  data[153] = 0; // curve = ConstantProduct
  data[154] = 0; // feeBeneficiaryCount = 0
  return data;
}

function config(): Uint8Array {
  const data = new Uint8Array(107);
  data.set(CONFIG_DISCRIMINATOR, 0);
  putAddr(data, 40, FEE_WALLET); // fee_beneficiary
  // platform_fee_bps @104 = 0 (no protocol fee — keeps the quote a pure CP curve)
  return data;
}

/** Each entry is [address, data] (owned as its shape implies) or [address, data, owner]. */
function loaderOf(
  entries: Array<[Address, Uint8Array] | [Address, Uint8Array, Address]>,
): OwnedAccountLoader {
  const map = new Map(entries.map(([a, d, o]) => [a as string, { d, o }]));
  const shaped = ownedByShape(async (addr) => {
    const e = map.get(addr as string);
    return e === undefined ? null : new Uint8Array(e.d);
  });
  return async (addr) => {
    const e = map.get(addr as string);
    return e?.o !== undefined ? { data: new Uint8Array(e.d), owner: e.o } : shaped(addr);
  };
}

async function makeLoader(
  mintA: Uint8Array,
  mintB: Uint8Array,
  ownerA?: Address,
): Promise<OwnedAccountLoader> {
  const configPda = await pda([CONFIG_SEED], SCALE_AMM_PROGRAM_ID);
  return loaderOf([
    [POOL, pool()],
    [configPda, config()],
    ownerA === undefined ? [MINT_A, mintA] : [MINT_A, mintA, ownerA],
    [MINT_B, mintB],
  ]);
}

describe("scale-amm Token-2022 handling", () => {
  it("decodes a legacy/legacy pool and quotes it (baseline)", async () => {
    const load = await makeLoader(makeLegacyMint(), makeLegacyMint());
    const cfg = await scaleAmm.fetchPoolConfig(load, POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    // platform fee ATA is derived under the legacy program for a legacy mint_a.
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_PROGRAM));
    const q = scaleAmm.referenceQuote(cfg, {}, 1_000_000n);
    expect(q).toBeGreaterThan(0n);
  });

  it("ROUTES a zero-fee Token-2022 mint_a (not dropped) and threads T22 into the ATA", async () => {
    const legacyLoad = await makeLoader(makeLegacyMint(), makeLegacyMint());
    const legacyCfg = await scaleAmm.fetchPoolConfig(legacyLoad, POOL);
    const legacyQuote = scaleAmm.referenceQuote(legacyCfg, {}, 1_000_000n);

    const load = await makeLoader(makeT22Mint(), makeLegacyMint());
    const cfg: ScaleAmmPoolConfig = await scaleAmm.fetchPoolConfig(load, POOL);
    // Per-side: mint_a resolves to Token-2022, mint_b stays legacy.
    expect(cfg.tokenProgramA).toBe(TOKEN_2022_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    // The ATA derivation uses the per-side (T22) program, NOT hardcoded legacy.
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_2022_PROGRAM));
    // A zero-fee mint must not change the quote at all.
    expect(scaleAmm.referenceQuote(cfg, {}, 1_000_000n)).toBe(legacyQuote);
  });

  it("ROUTES a zero-fee Token-2022 mint_b too (opposite side differs)", async () => {
    const load = await makeLoader(makeLegacyMint(), makeT22Mint());
    const cfg = await scaleAmm.fetchPoolConfig(load, POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_2022_PROGRAM);
  });

  it("resolves an 82-byte mint_a owned by Token-2022 (extensionless Token-2022) to Token-2022", async () => {
    const load = await makeLoader(makeLegacyMint(), makeLegacyMint(), TOKEN_2022_PROGRAM);
    const cfg = await scaleAmm.fetchPoolConfig(load, POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_2022_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_2022_PROGRAM));
  });

  it("self-drops a NonTransferable mint_a", async () => {
    const load = await makeLoader(makeT22Mint(NON_TRANSFERABLE_TLV), makeLegacyMint());
    await expect(scaleAmm.fetchPoolConfig(load, POOL)).rejects.toThrow(
      /un-routable|NonTransferable/,
    );
  });

  it("still rejects a TransferFeeConfig mint_a (see TODO(t22-fee-netting))", async () => {
    const load = await makeLoader(makeT22Mint(tlvEntry(1, new Uint8Array(108))), makeLegacyMint());
    await expect(scaleAmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/TransferFeeConfig/);
  });

  it("resolves an 82-byte mint_b owned by Token-2022 (extensionless Token-2022) to Token-2022; side A unchanged", async () => {
    const configPda = await pda([CONFIG_SEED], SCALE_AMM_PROGRAM_ID);
    const load = loaderOf([
      [POOL, pool()],
      [configPda, config()],
      [MINT_A, makeLegacyMint()],
      [MINT_B, makeLegacyMint(), TOKEN_2022_PROGRAM],
    ]);
    const cfg = await scaleAmm.fetchPoolConfig(load, POOL);
    expect(cfg.tokenProgramA).toBe(TOKEN_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_2022_PROGRAM);
    // The adapter derives no mint_b-side ATA; the only ATAs are mint_a's, still under Tokenkeg.
    const [platformFeeTaA] = await getProgramDerivedAddress({
      programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      seeds: [aenc.encode(FEE_WALLET), aenc.encode(TOKEN_PROGRAM), aenc.encode(MINT_A)],
    });
    expect(cfg.platformFeeTaA).toBe(platformFeeTaA);
    expect(cfg.beneficiaryAtas).toEqual([]);
  });

  it("refuses an 82-byte mint owned by neither token program (the scale venues' own owner check)", async () => {
    const foreign = address("11111111111111111111111111111111");
    const configPda = await pda([CONFIG_SEED], SCALE_AMM_PROGRAM_ID);
    for (const mint of [MINT_A, MINT_B]) {
      const load = loaderOf([
        [POOL, pool()],
        [configPda, config()],
        [MINT_A, makeLegacyMint(), mint === MINT_A ? foreign : TOKEN_PROGRAM],
        [MINT_B, makeLegacyMint(), mint === MINT_B ? foreign : TOKEN_PROGRAM],
      ]);
      await expect(scaleAmm.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `scale venue: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
