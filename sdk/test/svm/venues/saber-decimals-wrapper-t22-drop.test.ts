/**
 * saber-decimals-wrapper Token-2022 self-drop: a WrappedToken whose underlying
 * or wrapper mint is Token-2022 must DROP (fetchPoolConfig throws — the
 * SvmRoute graceful-drop signal), because the deposit/withdraw CPI is
 * legacy-SPL (Tokenkeg) only. No mainnet fixture is vendored, so the 114-byte
 * WrappedToken account is synthesized with a nonzero multiplier and two real
 * mint addresses at the source-verified offsets.
 */
import { address, getAddressEncoder } from "@solana/kit";
import {
  saberDecimalsWrapper,
  OFF_MULTIPLIER,
  OFF_UNDERLYING_MINT,
  OFF_UNDERLYING_TOKENS,
  OFF_WRAPPER_MINT,
} from "../../../src/svm/venues/saber-decimals-wrapper/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const POOL = address("AnKLLfpMcceM6YXtJ9nGxYekVXqfWy8WNsMZXoQTCVQk");
const UNDERLYING = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
const WRAPPER = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT (stand-in wrapper mint)
const VAULT = address("So11111111111111111111111111111111111111112");
const enc = getAddressEncoder();

function synthWrapper(): Uint8Array {
  const data = new Uint8Array(114);
  new DataView(data.buffer).setBigUint64(OFF_MULTIPLIER, 1_000_000n, true); // nonzero multiplier
  data.set(enc.encode(UNDERLYING), OFF_UNDERLYING_MINT);
  data.set(enc.encode(VAULT), OFF_UNDERLYING_TOKENS);
  data.set(enc.encode(WRAPPER), OFF_WRAPPER_MINT);
  return data;
}

function loader(mintOverrides: Record<string, Uint8Array>): AccountLoader {
  const pool = synthWrapper();
  return async (addr) => {
    if (addr === POOL) return pool;
    if (addr in mintOverrides) return mintOverrides[addr];
    return null;
  };
}

describe("saber-decimals-wrapper Token-2022 self-drop", () => {
  it("legacy path is unchanged (mints unvendored → legacy assumption)", async () => {
    await expect(saberDecimalsWrapper.fetchPoolConfig(loader({}), POOL)).resolves.toBeDefined();
  });

  it("a vendored legacy (82-byte) mint keeps the wrapper routable", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(
        loader({ [UNDERLYING]: makeLegacyMint(), [WRAPPER]: makeLegacyMint() }),
        POOL,
      ),
    ).resolves.toBeDefined();
  });

  it("drops when the underlying mint is a Token-2022 mint", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(loader({ [UNDERLYING]: makeT22Mint() }), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the wrapper mint is a Token-2022 mint", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(loader({ [WRAPPER]: makeT22Mint() }), POOL),
    ).rejects.toThrow(/Token-2022/);
  });
});
