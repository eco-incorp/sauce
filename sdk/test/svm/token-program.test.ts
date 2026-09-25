/**
 * Shared per-mint token-program resolver units (no engine, no RPC). Every mint
 * is hand-constructed from raw bytes here — these synthetic builders ARE the
 * fixtures; no mainnet mint address is used.
 */
import { getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  classifyMintProgram,
  createTokenProgramResolver,
  isToken2022Mint,
  resolveTokenProgram,
  resolveTokenProgramByOwner,
  resolveTokenProgramOwned,
} from "../../src/svm/token-program.js";
import type { AccountLoader, OwnedAccountLoader } from "../../src/svm/venues/types.js";

const decoder = getAddressDecoder();

/** A valid, meaningless address from a synthetic 32-byte seed (no mainnet mint). */
function synthAddress(seed: number): Address {
  return decoder.decode(new Uint8Array(32).fill(seed));
}

/** A classic 82-byte SPL mint. */
function legacyMint(): Uint8Array {
  return new Uint8Array(82);
}

/** A Token-2022 mint: 165-byte base, account-type byte (1 = Mint) at offset 165, optional TLV tail. */
function t22Mint(tlv: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(166 + tlv.length);
  out[165] = 1;
  out.set(tlv, 166);
  return out;
}

function loaderFor(map: Record<string, Uint8Array>): AccountLoader {
  return async (addr) => map[addr as string] ?? null;
}

describe("classifyMintProgram (pure)", () => {
  it("classifies an 82-byte mint as legacy", () => {
    const mint = synthAddress(1);
    expect(classifyMintProgram(mint, legacyMint())).toBe(TOKEN_PROGRAM_ID);
  });

  it("classifies a >=166-byte Mint-type account as Token-2022", () => {
    const mint = synthAddress(2);
    expect(classifyMintProgram(mint, t22Mint())).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("throws on a length that is not a mint layout (83..165)", () => {
    const mint = synthAddress(3);
    expect(() => classifyMintProgram(mint, new Uint8Array(120))).toThrow(
      /not a mint account layout/,
    );
  });

  it("throws on a >=166-byte account whose type byte is not Mint", () => {
    const mint = synthAddress(4);
    const data = t22Mint();
    data[165] = 2; // token Account, not Mint
    expect(() => classifyMintProgram(mint, data)).toThrow(/expected 1 \(Mint\)/);
  });
});

describe("resolveTokenProgram", () => {
  it("returns the legacy program for a synthetic 82-byte mint", async () => {
    const mint = synthAddress(10);
    const load = loaderFor({ [mint]: legacyMint() });
    await expect(resolveTokenProgram(load, mint)).resolves.toBe(TOKEN_PROGRAM_ID);
  });

  it("returns Token-2022 for a synthetic T22 mint (with and without extensions)", async () => {
    const bare = synthAddress(11);
    const withExt = synthAddress(12);
    // A TransferFeeConfig-shaped TLV tail (type 1, length 108) — still classifies by shape.
    const tlv = new Uint8Array(4 + 108);
    tlv[0] = 1; // type lo
    tlv[2] = 108; // length lo
    const load = loaderFor({ [bare]: t22Mint(), [withExt]: t22Mint(tlv) });
    await expect(resolveTokenProgram(load, bare)).resolves.toBe(TOKEN_2022_PROGRAM_ID);
    await expect(resolveTokenProgram(load, withExt)).resolves.toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("throws when the mint account is missing", async () => {
    const mint = synthAddress(13);
    const load = loaderFor({});
    await expect(resolveTokenProgram(load, mint)).rejects.toThrow(/account not found/);
  });
});

describe("resolveTokenProgramByOwner (extensionless-T22 escape hatch)", () => {
  it("resolves strictly by the owning program", async () => {
    const legacy = synthAddress(20);
    const t22 = synthAddress(21);
    const ownerOf = async (m: Address) => (m === legacy ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID);
    await expect(resolveTokenProgramByOwner(legacy, ownerOf)).resolves.toBe(TOKEN_PROGRAM_ID);
    await expect(resolveTokenProgramByOwner(t22, ownerOf)).resolves.toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("throws when the owner is neither token program", async () => {
    const mint = synthAddress(22);
    const ownerOf = async () => synthAddress(99);
    await expect(resolveTokenProgramByOwner(mint, ownerOf)).rejects.toThrow(
      /neither the legacy nor Token-2022/,
    );
  });
});

describe("createTokenProgramResolver (cache)", () => {
  it("reads each mint once and caches the result", async () => {
    const mint = synthAddress(30);
    let reads = 0;
    const load: AccountLoader = async (addr) => {
      if (addr === mint) {
        reads += 1;
        return legacyMint();
      }
      return null;
    };
    const resolve = createTokenProgramResolver(load);
    expect(await resolve(mint)).toBe(TOKEN_PROGRAM_ID);
    expect(await resolve(mint)).toBe(TOKEN_PROGRAM_ID);
    expect(reads).toBe(1);
  });
});

describe("isToken2022Mint", () => {
  it("is false for a legacy mint and true for a T22 mint", () => {
    expect(isToken2022Mint(legacyMint())).toBe(false);
    expect(isToken2022Mint(t22Mint())).toBe(true);
  });
});

/**
 * THE case the shape path cannot see: an extensionless Token-2022 mint is exactly 82 bytes and
 * byte-for-byte identical to a classic SPL mint. Nothing in the data separates them, so before the
 * owner was carried through, every such mint was classified legacy — and there was no test for it,
 * because `t22Mint()` only ever emits >=166 bytes.
 */
describe("owner-based classification", () => {
  const MINT = synthAddress(9);
  /** 82 bytes, indistinguishable from `legacyMint()` — the whole point. */
  const extensionlessT22 = (): Uint8Array => new Uint8Array(82);

  it("shape alone calls an extensionless Token-2022 mint legacy — the known hole", () => {
    expect(classifyMintProgram(MINT, extensionlessT22())).toBe(TOKEN_PROGRAM_ID);
  });

  it("the owner settles it, on identical bytes", () => {
    expect(classifyMintProgram(MINT, extensionlessT22(), TOKEN_2022_PROGRAM_ID)).toBe(
      TOKEN_2022_PROGRAM_ID,
    );
    expect(classifyMintProgram(MINT, extensionlessT22(), TOKEN_PROGRAM_ID)).toBe(TOKEN_PROGRAM_ID);
  });

  it("the owner wins over the shape, so a mislabelled shape cannot override it", () => {
    // >=166 bytes with the Mint type byte — the shape path would say Token-2022.
    const t22Shaped = t22Mint();
    expect(classifyMintProgram(MINT, t22Shaped)).toBe(TOKEN_2022_PROGRAM_ID);
    expect(classifyMintProgram(MINT, t22Shaped, TOKEN_PROGRAM_ID)).toBe(TOKEN_PROGRAM_ID);
  });

  it("rejects an owner that is neither token program", () => {
    expect(() => classifyMintProgram(MINT, extensionlessT22(), synthAddress(3))).toThrow(
      /neither the legacy nor Token-2022 program/,
    );
  });

  it("resolveTokenProgramOwned reads the owner off the account, with no extra round trip", async () => {
    const calls: Address[] = [];
    const load: OwnedAccountLoader = async (address) => {
      calls.push(address);

      return { data: extensionlessT22(), owner: TOKEN_2022_PROGRAM_ID };
    };

    await expect(resolveTokenProgramOwned(load, MINT)).resolves.toBe(TOKEN_2022_PROGRAM_ID);
    expect(calls).toEqual([MINT]);
  });

  it("resolveTokenProgramOwned still fails closed on a missing mint", async () => {
    const load: OwnedAccountLoader = async () => null;
    await expect(resolveTokenProgramOwned(load, MINT)).rejects.toThrow(/account not found/);
  });
});
