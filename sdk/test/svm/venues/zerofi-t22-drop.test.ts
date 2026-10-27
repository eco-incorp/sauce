/**
 * Token-2022 SELF-DROP pin for the zerofi adapter. `swap_v4` is Tokenkeg-only
 * (slots 9/11 are always the classic Token program), so a Token-2022 mint on
 * either side must GRACEFULLY SELF-DROP. No checked-in fixture, so the pool /
 * oracle / mint accounts are minimal synthesized stubs; the (otherwise-empty)
 * fee + authority catalogs are seeded for this synthetic pool so the pre-mint
 * gates pass and the mint check is reached.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  zerofi,
  ZEROFI_POOL_ACCOUNT_SIZE,
  ZEROFI_ORACLE_ACCOUNT_SIZE,
  ZEROFI_POOL_FEE_PPM,
  ZEROFI_POOL_AUTHORITY,
} from "../../../src/svm/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = address("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG");
const ORACLE = address("CsyasUrpePHQAJeQHMytaTbyxEag8FCuCBiQKQvBc3GV");
const VAULT_A = address("5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV");
const VAULT_B = address("9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx");
const COMPANION_A = address("BA6hdJwgzayrm3Q7Z6MPq1wVgPcUMJDbQcUwxJ9Nfu1H");
const COMPANION_B = address("7qPQugSL2cJgnVDQWNPt6woSidEF4XQhjPDkYrdnv8CK");
const MINT_A = address("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"); // JUP
const MINT_B = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
const AUTHORITY = address("544UsNRFNU7tzWKcHGZorwy7UKnsso9x83N9WWMvY5JX");
const ATA_A = address("ECADA9SPXrZTTbWG5JJTCC7KsagYR2MLZhw2KgFhivu9");
const ATA_B = address("Hg2PTGCBUwRvp7S3AF5BF4tfawNshXc1N2DDWijjJndo");

function poolBytes(): Uint8Array {
  const out = new Uint8Array(ZEROFI_POOL_ACCOUNT_SIZE);
  const enc = getAddressEncoder();
  out.set(enc.encode(MINT_A), 72); // OFF_MINT_A
  out.set(enc.encode(MINT_B), 104); // OFF_MINT_B
  out.set(enc.encode(VAULT_A), 136); // OFF_VAULT_A
  out.set(enc.encode(COMPANION_A), 168); // OFF_COMPANION_A
  out.set(enc.encode(VAULT_B), 200); // OFF_VAULT_B
  out.set(enc.encode(COMPANION_B), 232); // OFF_COMPANION_B
  out.set(enc.encode(ORACLE), 2184); // OFF_ORACLE
  return out;
}
function oracleBytes(): Uint8Array {
  const out = new Uint8Array(ZEROFI_ORACLE_ACCOUNT_SIZE);
  // f64 1.0 LE at PRICE_OFFSET (0x30 = 48) — a trivial, non-overflowing scale.
  out.set([0, 0, 0, 0, 0, 0, 0xf0, 0x3f], 0x30);
  return out;
}
/** Accounts are owned as their shape implies, unless `ownerA` names mintA's owner. */
function loader(mintA: Uint8Array, mintB: Uint8Array, ownerA?: Address): OwnedAccountLoader {
  const map = new Map<string, Uint8Array>([
    [String(POOL), poolBytes()],
    [String(ORACLE), oracleBytes()],
    [String(MINT_A), mintA],
    [String(MINT_B), mintB],
  ]);
  const shaped = ownedByShape(async (addr) => map.get(String(addr)) ?? null);
  return async (addr) =>
    ownerA !== undefined && addr === MINT_A ? { data: mintA, owner: ownerA } : shaped(addr);
}

beforeAll(() => {
  (ZEROFI_POOL_FEE_PPM as Record<string, bigint>)[POOL] = 1_000n;
  (
    ZEROFI_POOL_AUTHORITY as Record<
      string,
      { authority: Address; authorityAtaA: Address; authorityAtaB: Address }
    >
  )[POOL] = { authority: AUTHORITY, authorityAtaA: ATA_A, authorityAtaB: ATA_B };
});
afterAll(() => {
  delete (ZEROFI_POOL_FEE_PPM as Record<string, bigint>)[POOL];
  delete (ZEROFI_POOL_AUTHORITY as Record<string, unknown>)[POOL];
});

describe("zerofi Token-2022 self-drop", () => {
  test("legacy mints decode — legacy path unchanged", async () => {
    const cfg = await zerofi.fetchPoolConfig(loader(makeLegacyMint(), makeLegacyMint()), POOL, 0);
    expect(cfg.venue).toBe("zerofi");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  test("a Token-2022 mintA self-drops", async () => {
    await expect(
      zerofi.fetchPoolConfig(loader(makeT22Mint(), makeLegacyMint()), POOL, 0),
    ).rejects.toThrow(/dropping pool/);
  });

  test("an 82-byte mintA owned by Token-2022 (extensionless Token-2022) self-drops", async () => {
    await expect(
      zerofi.fetchPoolConfig(
        loader(makeLegacyMint(), makeLegacyMint(), TOKEN_2022_PROGRAM_ID),
        POOL,
        0,
      ),
    ).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable mintB self-drops as un-routable", async () => {
    await expect(
      zerofi.fetchPoolConfig(loader(makeLegacyMint(), makeT22Mint(NON_TRANSFERABLE_TLV)), POOL, 0),
    ).rejects.toThrow(/dropping pool/);
  });
});
