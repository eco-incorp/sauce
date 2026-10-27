/**
 * TesseraV GENERAL auth/vault derivation — the funds-safety gate.
 *
 * The adapter used to hardcode auth/vault for exactly one pool
 * (FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n, SOL/USDC) and THROW for every
 * other pool. It now derives the trio generally:
 *   - auth   = TESSERAV_GLOBAL_AUTH (a verified global singleton, not per-pool)
 *   - vaultX = the single legacy-SPL token account owned by auth for mintX,
 *              EXCLUDING the canonical ATA(auth, mintX) — resolved from a
 *              committed global-per-mint cache (RPC-free) or an owner-scoped
 *              getTokenAccountsByOwner resolver (pickTesseraVVault).
 *
 * The load-bearing assertion here is that the GENERAL derivation reproduces the
 * OLD hardcoded SOL/USDC values EXACTLY — a wrong auth/vault mis-routes funds.
 * Ground truth (from the live SOL/USDC swap-CPI trace, sig 3p2JFpLN…):
 *   auth=8ekCy2…, vaultA(wSOL)=5pVN5X…, vaultB(USDC)=9t4P5w…
 * and cbBTC/USDC (sig 4KZPEcyC…): vaultA(cbBTC)=37hggN…, vaultB(USDC)=9t4P5w…
 * (the SAME USDC vault — vaults are global per mint, not per pool).
 */
import { resolve } from "path";
import { address, getAddressCodec, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  fetchTesseraVConfig,
  pickTesseraVVault,
  TESSERAV_GLOBAL_AUTH,
  TESSERAV_KNOWN_VAULTS,
  TOKEN_PROGRAM,
} from "../../../src/svm/index.js";
import type { TesseraVOwnedTokenAccount, TesseraVVaultResolver } from "../../../src/svm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TESSERAV_PROGRAM_ID } from "../../../src/svm/venues/tesserav/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/tesserav");
const SOL_USDC_POOL = address("FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n");

// The verified ground truth — the exact literals the adapter used to hardcode.
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const VAULT_WSOL = "5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV";
const VAULT_USDC = "9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx";
const VAULT_CBBTC = "37hggNyT4Ec8GEcxMLrWrZyrMSSFMSiFT6VBayRYceZH";

const codec = getAddressCodec();
const enc = getAddressEncoder();

/** A valid but definitely-not-cached Address from arbitrary fixed bytes. */
function fabricatedAddress(fill: number): Address {
  return codec.decode(new Uint8Array(32).fill(fill));
}

/** Minimal 1264-byte tesserav pool: mintA@24, mintB@56, non-zero mid + level-0 aToB. */
function synthPool(mintA: Address, mintB: Address): Uint8Array {
  const data = new Uint8Array(1264);
  data.set(new Uint8Array(enc.encode(mintA)), 24); // OFF_MINT_A
  data.set(new Uint8Array(enc.encode(mintB)), 56); // OFF_MINT_B
  const writeU64 = (off: number, v: bigint) => {
    for (let i = 0; i < 8; i++) data[off + i] = Number((v >> BigInt(8 * i)) & 0xffn);
  };
  writeU64(144, 1_000_000_000_000_000n); // OFF_MID, non-zero (primed)
  writeU64(168, 730_000n); // OFF_LADDER_AB + AB_OFF_PRICE, level-0 price
  writeU64(168 + 16, 7_311_999n); // OFF_LADDER_AB + AB_OFF_CUM, level-0 capacity
  return data;
}

/** 165-byte legacy SPL token account: mint@0, owner(authority)@32, amount@64. */
function synthTokenAccount(mint: Address, owner: Address, amount: bigint): Uint8Array {
  const data = new Uint8Array(165);
  data.set(new Uint8Array(enc.encode(mint)), 0);
  data.set(new Uint8Array(enc.encode(owner)), 32);
  for (let i = 0; i < 8; i++) data[64 + i] = Number((amount >> BigInt(8 * i)) & 0xffn);
  return data;
}

describe("tesserav general auth/vault derivation", () => {
  test("TESSERAV_GLOBAL_AUTH === the old hardcoded auth literal, exactly", () => {
    expect(String(TESSERAV_GLOBAL_AUTH)).toBe("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");
  });

  test("the general derivation (pickTesseraVVault, exclude-ATA) reproduces the SOL/USDC vaults EXACTLY", async () => {
    const auth = TESSERAV_GLOBAL_AUTH;

    // wSOL side: the real getTokenAccountsByOwner(auth, wSOL) returned ONE
    // account (the vault; no ATA exists). Exclude-ATA leaves it as the winner.
    const wsolVault = await pickTesseraVVault(auth, address(WSOL), [
      { address: address(VAULT_WSOL) },
    ]);
    expect(wsolVault).toBe(VAULT_WSOL);

    // USDC side: the real result was {vault 9t4P5w (non-ATA), ATA (dust 50000)}.
    // Build the ATA exactly as the picker does, so the exclusion is the real one.
    const [usdcAta] = await findAssociatedTokenPda({
      owner: auth,
      mint: address(USDC),
      tokenProgram: TOKEN_PROGRAM,
    });
    expect(String(usdcAta)).not.toBe(VAULT_USDC); // the exclusion is non-trivial
    const usdcVault = await pickTesseraVVault(auth, address(USDC), [
      { address: address(VAULT_USDC), amount: 4_060_000_000_000n },
      { address: usdcAta, amount: 50_000n },
    ]);
    expect(usdcVault).toBe(VAULT_USDC);
  });

  // pickTesseraVVault's >1-non-ATA branch is the subtlest funds-routing logic: after excluding the
  // canonical ATA, MORE than one auth-owned account remains for the mint. These pin both sub-cases.
  test("pickTesseraVVault with >1 non-ATA account, balances known, picks the LARGEST (real vault over a dust decoy)", async () => {
    const auth = TESSERAV_GLOBAL_AUTH;
    const mint = address(USDC);
    const [ata] = await findAssociatedTokenPda({ owner: auth, mint, tokenProgram: TOKEN_PROGRAM });
    const realVault = fabricatedAddress(0xa1);
    const dustDecoy = fabricatedAddress(0xb2);
    // owned = ATA (excluded) + two non-ATA accounts, out of balance order to prove it ranks, not takes[0].
    const picked = await pickTesseraVVault(auth, mint, [
      { address: dustDecoy, amount: 50_000n },
      { address: ata, amount: 1n },
      { address: realVault, amount: 4_060_000_000_000n },
    ]);
    expect(picked).toBe(realVault); // largest non-ATA balance wins
    expect(picked).not.toBe(dustDecoy);
    expect(String(picked)).not.toBe(String(ata));
  });

  test("pickTesseraVVault with >1 non-ATA account and an UNKNOWN balance self-drops (null) — never guesses", async () => {
    const auth = TESSERAV_GLOBAL_AUTH;
    const mint = address(USDC);
    const [ata] = await findAssociatedTokenPda({ owner: auth, mint, tokenProgram: TOKEN_PROGRAM });
    // Two non-ATA candidates but one balance is unknown -> unrankable -> self-drop rather than route
    // funds to a possibly-wrong account.
    const picked = await pickTesseraVVault(auth, mint, [
      { address: fabricatedAddress(0xc3), amount: 4_060_000_000_000n },
      { address: fabricatedAddress(0xd4) }, // balance unknown
      { address: ata, amount: 1n },
    ]);
    expect(picked).toBeNull();
  });

  test("pickTesseraVVault with ZERO non-ATA accounts self-drops (null) — the global vault does not exist yet", async () => {
    const auth = TESSERAV_GLOBAL_AUTH;
    const mint = address(USDC);
    const [ata] = await findAssociatedTokenPda({ owner: auth, mint, tokenProgram: TOKEN_PROGRAM });
    expect(await pickTesseraVVault(auth, mint, [{ address: ata, amount: 1n }])).toBeNull(); // only the ATA
    expect(await pickTesseraVVault(auth, mint, [])).toBeNull(); // nothing owned
  });

  test("the committed cache reproduces the SOL/USDC + cbBTC vaults EXACTLY (RPC-free fast path)", () => {
    expect(String(TESSERAV_KNOWN_VAULTS[WSOL])).toBe(VAULT_WSOL);
    expect(String(TESSERAV_KNOWN_VAULTS[USDC])).toBe(VAULT_USDC);
    expect(String(TESSERAV_KNOWN_VAULTS[CBBTC])).toBe(VAULT_CBBTC);
  });

  test("fetchTesseraVConfig on the REAL SOL/USDC pool yields the exact old hardcoded trio (existing serving unchanged, no resolver)", async () => {
    const cfg = await fetchTesseraVConfig(
      fixtureLoader(loadFixtures(FIXTURES)),
      SOL_USDC_POOL,
      "aToB",
    );
    expect(String(cfg.auth)).toBe("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");
    expect(String(cfg.vaultA)).toBe(VAULT_WSOL);
    expect(String(cfg.vaultB)).toBe(VAULT_USDC);
    expect(cfg.mintA).toBe(WSOL);
    expect(cfg.mintB).toBe(USDC);
  });

  test("the cbBTC/USDC pool now DERIVES a valid trio instead of throwing (cache path, no resolver)", async () => {
    const pool = address("9NkuAWB4LgCVFV77omEkJEjXqgV5PGupwMTu3B3pBRhc");
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === String(pool)
        ? { data: synthPool(address(CBBTC), address(USDC)), owner: TESSERAV_PROGRAM_ID }
        : null;
    const cfg = await fetchTesseraVConfig(load, pool, "aToB");
    expect(cfg.mintA).toBe(CBBTC);
    expect(cfg.mintB).toBe(USDC);
    expect(String(cfg.auth)).toBe("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");
    // Ground-truth cbBTC/USDC trio from sig 4KZPEcyC… — the SAME USDC vault.
    expect(String(cfg.vaultA)).toBe(VAULT_CBBTC);
    expect(String(cfg.vaultB)).toBe(VAULT_USDC);
  });

  test("a novel (uncached) mint resolves its vault via the getTokenAccountsByOwner resolver, self-consistently", async () => {
    const novelMint = fabricatedAddress(0x11);
    const novelVault = fabricatedAddress(0x22);
    const pool = fabricatedAddress(0x33);

    // Simulated on-chain state: the vault genuinely holds mintX under auth.
    const vaultData = synthTokenAccount(novelMint, TESSERAV_GLOBAL_AUTH, 9_000n);

    const [novelAta] = await findAssociatedTokenPda({
      owner: TESSERAV_GLOBAL_AUTH,
      mint: novelMint,
      tokenProgram: TOKEN_PROGRAM,
    });
    const resolveVault: TesseraVVaultResolver = async (owner, mint) => {
      expect(String(owner)).toBe("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");
      if (String(mint) !== String(novelMint)) return null;
      // getTokenAccountsByOwner(auth, novelMint) → {vault, ATA(dust)}
      const owned: TesseraVOwnedTokenAccount[] = [
        { address: novelVault, amount: 9_000n },
        { address: novelAta, amount: 1n },
      ];
      return pickTesseraVVault(owner, mint, owned);
    };

    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === String(pool)
        ? { data: synthPool(novelMint, address(USDC)), owner: TESSERAV_PROGRAM_ID }
        : null;
    const cfg = await fetchTesseraVConfig(load, pool, "aToB", resolveVault);

    expect(String(cfg.auth)).toBe("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");
    expect(cfg.vaultA).toBe(novelVault); // from the resolver
    expect(String(cfg.vaultB)).toBe(VAULT_USDC); // USDC from the committed cache

    // Self-consistency: the derived vaultA genuinely holds mintA under auth.
    expect(codec.decode(vaultData.subarray(0, 32))).toBe(cfg.mintA);
    expect(codec.decode(vaultData.subarray(32, 64))).toBe(cfg.auth);
  });

  test('an uncached mint with NO resolver self-drops the pool (graceful "dropping pool"), never throws a hard mapping error', async () => {
    const novelMint = fabricatedAddress(0x44);
    const pool = fabricatedAddress(0x55);
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === String(pool)
        ? { data: synthPool(novelMint, address(USDC)), owner: TESSERAV_PROGRAM_ID }
        : null;
    await expect(fetchTesseraVConfig(load, pool, "aToB")).rejects.toThrow(/dropping pool/);
  });

  test("a resolver that finds no vault (null) self-drops the pool gracefully", async () => {
    const novelMint = fabricatedAddress(0x66);
    const pool = fabricatedAddress(0x77);
    const resolveVault: TesseraVVaultResolver = async () => null;
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === String(pool)
        ? { data: synthPool(novelMint, address(USDC)), owner: TESSERAV_PROGRAM_ID }
        : null;
    await expect(fetchTesseraVConfig(load, pool, "aToB", resolveVault)).rejects.toThrow(
      /dropping pool/,
    );
  });
});
