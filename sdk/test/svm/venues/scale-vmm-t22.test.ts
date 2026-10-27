/**
 * scale-vmm Token-2022 handling: a zero-fee Token-2022 mint on either side ROUTES
 * (is NOT dropped) and threads its own token program into the per-side ATA
 * derivation, while a legacy pair decodes byte-identically. A NonTransferable mint
 * self-drops; a TransferFeeConfig mint is still rejected (see the
 * TODO(t22-fee-netting) note in scale-common.ts). scale-vmm exposes no
 * referenceQuote, so this covers the fetch/decode + threading path.
 */
import { getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { scaleVmm } from "../../../src/svm/venues/scale-vmm/index.js";
import {
  ata,
  CONFIG_SEED,
  pda,
  SCALE_VMM_PROGRAM_ID,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../../src/svm/venues/scale-common.js";
import type { AccountLoader, OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import {
  makeLegacyMint,
  makeT22Mint,
  NON_TRANSFERABLE_TLV,
  tlvEntry,
} from "../fixtures/token-2022/synth.js";

const dec = getAddressDecoder();
const aenc = getAddressEncoder();
const addrFromByte = (b: number): Address => dec.decode(new Uint8Array(32).fill(b));
const putAddr = (data: Uint8Array, offset: number, addr: Address): void =>
  data.set(new Uint8Array(aenc.encode(addr)), offset);

const PAIR_DISCRIMINATOR = Uint8Array.of(229, 212, 222, 222, 191, 128, 176, 235);
const CONFIG_DISCRIMINATOR = Uint8Array.of(160, 78, 128, 0, 248, 83, 230, 160);

const PAIR = addrFromByte(1);
const FEE_WALLET = addrFromByte(3);
const MINT_A = addrFromByte(11);
const MINT_B = addrFromByte(13);

function writeU128LE(data: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 16; i++) {
    data[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function pair(): Uint8Array {
  const data = new Uint8Array(327);
  data.set(PAIR_DISCRIMINATOR, 0);
  data[8] = 1; // enabled
  data[9] = 0; // graduated = false
  putAddr(data, 10, MINT_A);
  putAddr(data, 42, MINT_B);
  writeU128LE(data, 74, 0n); // reservesA
  writeU128LE(data, 90, 1_000_000_000n); // reservesB
  writeU128LE(data, 106, 1_000_000_000n); // shift
  data[122] = 0; // curve = ConstantProduct
  data[123] = 0; // feeBeneficiaryCount = 0
  return data;
}

function config(): Uint8Array {
  const data = new Uint8Array(115);
  data.set(CONFIG_DISCRIMINATOR, 0);
  putAddr(data, 40, FEE_WALLET);
  return data;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (addr) => {
    const d = map.get(addr as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

/** The pair's accounts, each owned as its bytes would be; `mintAOwner` overrides mint_a's. */
async function makeLoader(
  mintA: Uint8Array,
  mintB: Uint8Array,
  mintAOwner?: Address,
): Promise<OwnedAccountLoader> {
  const configPda = await pda([CONFIG_SEED], SCALE_VMM_PROGRAM_ID);
  const shaped = ownedByShape(
    loaderOf([
      [PAIR, pair()],
      [configPda, config()],
      [MINT_A, mintA],
      [MINT_B, mintB],
    ]),
  );
  if (mintAOwner === undefined) return shaped;
  return async (addr) =>
    addr === MINT_A ? { data: new Uint8Array(mintA), owner: mintAOwner } : shaped(addr);
}

describe("scale-vmm Token-2022 handling", () => {
  it("decodes a legacy/legacy pair (baseline)", async () => {
    const load = await makeLoader(makeLegacyMint(), makeLegacyMint());
    const cfg = await scaleVmm.fetchPoolConfig(load, PAIR);
    expect(cfg.tokenProgramA).toBe(TOKEN_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_PROGRAM));
  });

  it("ROUTES a zero-fee Token-2022 mint_a (not dropped) and threads T22 into the ATA", async () => {
    const load = await makeLoader(makeT22Mint(), makeLegacyMint());
    const cfg = await scaleVmm.fetchPoolConfig(load, PAIR);
    expect(cfg.tokenProgramA).toBe(TOKEN_2022_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_2022_PROGRAM));
  });

  it("threads Token-2022 for an extensionless (82-byte) mint_a by its owner", async () => {
    const load = await makeLoader(makeLegacyMint(), makeLegacyMint(), TOKEN_2022_PROGRAM);
    const cfg = await scaleVmm.fetchPoolConfig(load, PAIR);
    expect(cfg.tokenProgramA).toBe(TOKEN_2022_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_PROGRAM);
    expect(cfg.platformFeeTaA).toBe(await ata(FEE_WALLET, MINT_A, TOKEN_2022_PROGRAM));
  });

  it("ROUTES a zero-fee Token-2022 mint_b too (opposite side differs)", async () => {
    const load = await makeLoader(makeLegacyMint(), makeT22Mint());
    const cfg = await scaleVmm.fetchPoolConfig(load, PAIR);
    expect(cfg.tokenProgramA).toBe(TOKEN_PROGRAM);
    expect(cfg.tokenProgramB).toBe(TOKEN_2022_PROGRAM);
  });

  it("self-drops a NonTransferable mint_a", async () => {
    const load = await makeLoader(makeT22Mint(NON_TRANSFERABLE_TLV), makeLegacyMint());
    await expect(scaleVmm.fetchPoolConfig(load, PAIR)).rejects.toThrow(
      /un-routable|NonTransferable/,
    );
  });

  it("still rejects a TransferFeeConfig mint_a (see TODO(t22-fee-netting))", async () => {
    const load = await makeLoader(makeT22Mint(tlvEntry(1, new Uint8Array(108))), makeLegacyMint());
    await expect(scaleVmm.fetchPoolConfig(load, PAIR)).rejects.toThrow(/TransferFeeConfig/);
  });
});
