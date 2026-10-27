/**
 * 1DEX (one-intro-swap) Token-2022 self-drop: SwapExactAmountIn is legacy-SPL
 * (Tokenkeg) only, so a Token-2022 mint must make fetchPoolConfig THROW. No
 * mainnet fixture is vendored, so this builds a minimal synthetic 432-byte
 * PoolState. With both mints legacy the config resolves (control), proving the
 * legacy path is byte-identical.
 */
import { address, getAddressCodec } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import { fetchOneIntroSwapPoolConfig } from "../../../src/svm/venues/one-intro-swap/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("DbuvwPuLvH8uy2B1sKuu18aCd2QpCvfZdfDtdRZztBd2");
const MINT0 = address("So11111111111111111111111111111111111111112"); // WSOL
const MINT1 = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
const POOL_STATE_DISCRIMINATOR = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];

/** A minimal, valid 432-byte PoolState: disc + mints + nonzero virtual reserves. */
function makePoolState(): Uint8Array {
  const buf = new Uint8Array(432);
  buf.set(POOL_STATE_DISCRIMINATOR, 0);
  const codec = getAddressCodec();
  buf.set(codec.encode(MINT0), 89);
  buf.set(codec.encode(MINT1), 169);
  new DataView(buf.buffer).setBigUint64(153, 1_000_000n, true); // virtualReserve0
  new DataView(buf.buffer).setBigUint64(233, 2_000_000n, true); // virtualReserve1
  return buf;
}

function loaderWith(
  mint0Data: Uint8Array | null,
  mint1Data: Uint8Array | null,
): OwnedAccountLoader {
  const pool = makePoolState();
  return ownedByShape(async (addr) => {
    if (addr === POOL) return new Uint8Array(pool);
    if (addr === MINT0) return mint0Data === null ? null : new Uint8Array(mint0Data);
    if (addr === MINT1) return mint1Data === null ? null : new Uint8Array(mint1Data);
    return null;
  });
}

describe("one-intro-swap Token-2022 self-drop", () => {
  it("drops the pool when mint0 is Token-2022", async () => {
    await expect(
      fetchOneIntroSwapPoolConfig(loaderWith(makeT22Mint(), makeLegacyMint()), POOL),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when mint1 is Token-2022", async () => {
    await expect(
      fetchOneIntroSwapPoolConfig(loaderWith(makeLegacyMint(), makeT22Mint()), POOL),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when mint0 is an 82-byte mint owned by Token-2022 (extensionless Token-2022)", async () => {
    const shaped = loaderWith(makeLegacyMint(), makeLegacyMint());
    const load: OwnedAccountLoader = async (addr) =>
      addr === MINT0 ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID } : shaped(addr);
    await expect(fetchOneIntroSwapPoolConfig(load, POOL)).rejects.toThrow(/is Token-2022/);
  });

  it("still resolves with two legacy mints — byte-identical legacy path", async () => {
    const cfg = await fetchOneIntroSwapPoolConfig(
      loaderWith(makeLegacyMint(), makeLegacyMint()),
      POOL,
    );
    expect(cfg.venue).toBe("one-intro-swap");
    expect(cfg.mint0).toBe(MINT0);
    expect(cfg.mint1).toBe(MINT1);
  });
});
