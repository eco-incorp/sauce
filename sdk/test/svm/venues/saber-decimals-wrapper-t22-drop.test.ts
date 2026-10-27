/**
 * saber-decimals-wrapper Token-2022 self-drop: a WrappedToken whose underlying
 * or wrapper mint is Token-2022 must DROP (fetchPoolConfig throws — the
 * SvmRoute graceful-drop signal), because the deposit/withdraw CPI is
 * legacy-SPL (Tokenkeg) only. No mainnet fixture is vendored, so the 114-byte
 * WrappedToken account is synthesized with a nonzero multiplier and two real
 * mint addresses at the source-verified offsets. A mint is classified by its
 * OWNER: an extensionless Token-2022 mint is 82 bytes, byte for byte a legacy
 * one, so only the owner can tell them apart.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  SABER_DECIMALS_WRAPPER_PROGRAM_ID,
  saberDecimalsWrapper,
  OFF_MULTIPLIER,
  OFF_UNDERLYING_MINT,
  OFF_UNDERLYING_TOKENS,
  OFF_WRAPPER_MINT,
} from "../../../src/svm/venues/saber-decimals-wrapper/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

type Mint = { data: Uint8Array; owner: Address };
const t22 = (data = makeT22Mint()): Mint => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (): Mint => ({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID });

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

function loader(mintOverrides: Record<string, Mint>): OwnedAccountLoader {
  const pool = synthWrapper();
  return async (addr) => {
    if (addr === POOL) return { data: pool, owner: SABER_DECIMALS_WRAPPER_PROGRAM_ID };
    if (addr in mintOverrides) return mintOverrides[addr]!;
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
        loader({ [UNDERLYING]: legacy(), [WRAPPER]: legacy() }),
        POOL,
      ),
    ).resolves.toBeDefined();
  });

  it("drops when the underlying mint is a Token-2022 mint", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(loader({ [UNDERLYING]: t22() }), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the wrapper mint is a Token-2022 mint", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(loader({ [WRAPPER]: t22() }), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the underlying mint is an extensionless (82-byte) Token-2022 mint", async () => {
    await expect(
      saberDecimalsWrapper.fetchPoolConfig(loader({ [UNDERLYING]: t22(makeLegacyMint()) }), POOL),
    ).rejects.toThrow(/Token-2022/);
  });
});
