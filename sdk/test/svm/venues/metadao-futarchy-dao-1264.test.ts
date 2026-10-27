/**
 * metadao-futarchy Dao account layout after the 2026-10-20 mainnet program upgrade.
 *
 * The upgraded `futarchy` program (FUTARELBf…) grew every `Dao` account from 1205 to 1264 bytes: six
 * fields were appended after the old tail (`liquidator`, `last_failed_takeover_at`,
 * `last_failed_liquidation_at`, `spending_limit_dirty`, `last_buyback_finalized_at`,
 * `typed_proposals_enabled`; 33 + 8 + 8 + 1 + 8 + 1 = 59 bytes). The discriminator and every offset
 * the decoder reads are unchanged.
 *
 * FAILING-FIRST: with the old exact-1205 gate, `fetchMetaDaoFutarchySpotConfig` threw "account is
 * 1264 bytes, expected 1205" for every real Dao, so all MetaDAO liquidity self-dropped.
 *
 * The accounts are the real mainnet bytes of the META dao (`test/svm/fixtures/metadao-futarchy/`,
 * read in one getMultipleAccounts at slot 459431429, after the upgrade). A shorter Dao is the
 * pre-upgrade `OldDao` shape (the real pre-upgrade bytes fail the program's `SpotSwap` with
 * `AccountDidNotDeserialize`, 3003) and none remain on mainnet, so the decoder refuses it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { fetchMetaDaoFutarchySpotConfig } from "../../../src/svm/venues/metadao-futarchy/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name: string): { address: Address; owner: Address; data: Uint8Array } => {
  const fixture = JSON.parse(
    readFileSync(join(HERE, `../fixtures/metadao-futarchy/${name}.json`), "utf8"),
  ) as { address: Address; owner: Address; base64Data: string };
  return {
    address: fixture.address,
    owner: address(fixture.owner),
    data: new Uint8Array(Buffer.from(fixture.base64Data, "base64")),
  };
};

const dao = load("dao");
const baseMint = load("base-mint");
const quoteMint = load("quote-mint");

const DAO_SIZE_BEFORE_UPGRADE = 1205;
const DAO_SIZE = 1264;
const QUOTE_RESERVES_OFFSET = 109;
const BASE_RESERVES_OFFSET = 117;

function loaderOf(daoData: Uint8Array): OwnedAccountLoader {
  const accounts: Record<string, { data: Uint8Array; owner: Address }> = {
    [dao.address]: { data: daoData, owner: dao.owner },
    [baseMint.address]: { data: baseMint.data, owner: baseMint.owner },
    [quoteMint.address]: { data: quoteMint.data, owner: quoteMint.owner },
  };
  return async (addr) => {
    const account = accounts[addr as string];
    return account === undefined
      ? null
      : { data: new Uint8Array(account.data), owner: account.owner };
  };
}

const withSize = (size: number): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(dao.data.subarray(0, Math.min(size, dao.data.length)));
  return out;
};

describe("metadao-futarchy Dao account size after the program upgrade", () => {
  it("the fixture is a real post-upgrade Dao: 1264 bytes, Spot state, both reserves live", () => {
    const view = new DataView(dao.data.buffer, dao.data.byteOffset, dao.data.byteLength);
    expect(dao.data.length).toBe(DAO_SIZE);
    expect(dao.data[8]).toBe(0);
    expect(view.getBigUint64(QUOTE_RESERVES_OFFSET, true)).toBe(1_196_218_473_610n);
    expect(view.getBigUint64(BASE_RESERVES_OFFSET, true)).toBe(231_185_049_594n);
  });

  it("decodes a real 1264-byte Dao to its mints and vaults", async () => {
    const cfg = await fetchMetaDaoFutarchySpotConfig(loaderOf(dao.data), dao.address);
    expect(cfg).toEqual({
      venue: "metadao-futarchy",
      pool: dao.address,
      direction: "buy",
      baseMint: address("METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta"),
      quoteMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      ammBaseVault: address("JDx4m2VpQQLqCdd3URUThhAY2wJePpAn49f2BcNUU3WX"),
      ammQuoteVault: address("HgtoZVvdVjrCm7jmKmiySjHmvbXRahqmRP8WSxGPC5VM"),
      tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });
  });

  it("reads the reserves at their offsets: a zeroed side is refused", async () => {
    const zeroQuote = withSize(DAO_SIZE);
    zeroQuote.fill(0, QUOTE_RESERVES_OFFSET, QUOTE_RESERVES_OFFSET + 8);
    await expect(fetchMetaDaoFutarchySpotConfig(loaderOf(zeroQuote), dao.address)).rejects.toThrow(
      /zero-reserve side \(quote=0,/,
    );
    const zeroBase = withSize(DAO_SIZE);
    zeroBase.fill(0, BASE_RESERVES_OFFSET, BASE_RESERVES_OFFSET + 8);
    await expect(fetchMetaDaoFutarchySpotConfig(loaderOf(zeroBase), dao.address)).rejects.toThrow(
      /zero-reserve side \(quote=\d+, base=0\)/,
    );
  });

  it("rejects a 1205-byte Dao: the pre-upgrade shape is refused, not decoded", async () => {
    await expect(
      fetchMetaDaoFutarchySpotConfig(loaderOf(withSize(DAO_SIZE_BEFORE_UPGRADE)), dao.address),
    ).rejects.toThrow(/account is 1205 bytes, expected at least 1264/);
  });

  it("rejects every size below 1264, one byte short included", async () => {
    for (const size of [0, 8, 1204, DAO_SIZE - 1]) {
      await expect(
        fetchMetaDaoFutarchySpotConfig(loaderOf(withSize(size)), dao.address),
      ).rejects.toThrow(/bytes, expected at least 1264/);
    }
  });

  it("accepts a larger Dao: Anchor ignores trailing bytes, so a later field append still decodes", async () => {
    const grown = withSize(DAO_SIZE + 16);
    grown.fill(0xab, DAO_SIZE);
    const cfg = await fetchMetaDaoFutarchySpotConfig(loaderOf(grown), dao.address);
    expect(cfg.ammBaseVault).toBe("JDx4m2VpQQLqCdd3URUThhAY2wJePpAn49f2BcNUU3WX");
  });

  it("rejects a 1264-byte account that is not a Dao", async () => {
    const notDao = withSize(DAO_SIZE);
    notDao[0] = notDao[0]! ^ 0xff;
    await expect(fetchMetaDaoFutarchySpotConfig(loaderOf(notDao), dao.address)).rejects.toThrow(
      /not a Dao account/,
    );
  });
});
