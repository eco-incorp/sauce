/**
 * sanctum-infinity Token-2022 self-drop: a directed pair whose in/out mint is
 * Token-2022 must DROP (fetchPoolConfig throws — the SvmRoute graceful-drop
 * signal), because the swap CPI is legacy-SPL (Tokenkeg) only for now. The T22
 * detection runs right after the discovery-key/identity checks and BEFORE the
 * poolState/lstStateList/slab loads, so the drop needs only the synthetic
 * discovery key + a T22 mint — no full pool-state fixture is required.
 */
import { address } from "@solana/kit";
import {
  sanctumInfinity,
  sanctumInfinityPoolKey,
  __resetSanctumInfinityKeysForTest,
} from "../../../src/svm/venues/sanctum-infinity/index.js";
import type { Address } from "@solana/kit";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const IN = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC (stand-in LST mint)
const OUT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT

/** Each override is a mint's bytes and owning program; every other account is absent. */
function loader(
  mintOverrides: Record<string, { data: Uint8Array; owner: Address }>,
): OwnedAccountLoader {
  return async (addr) => mintOverrides[addr] ?? null;
}

const t22 = (data: Uint8Array) => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (data: Uint8Array) => ({ data, owner: TOKEN_PROGRAM_ID });

describe("sanctum-infinity Token-2022 self-drop", () => {
  beforeEach(() => __resetSanctumInfinityKeysForTest());

  it("drops when the input mint is a Token-2022 mint", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(loader({ [IN]: t22(makeT22Mint()) }), key),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the output mint is a Token-2022 mint", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(
        loader({ [IN]: legacy(makeLegacyMint()), [OUT]: t22(makeT22Mint()) }),
        key,
      ),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the input mint is an extensionless 82-byte mint owned by Token-2022", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(loader({ [IN]: t22(makeLegacyMint()) }), key),
    ).rejects.toThrow(/Token-2022/);
  });

  it("legacy mints pass the T22 gate (fails later on the absent pool_state, not the gate)", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(
        loader({ [IN]: legacy(makeLegacyMint()), [OUT]: legacy(makeLegacyMint()) }),
        key,
      ),
    ).rejects.not.toThrow(/Token-2022/);
  });
});
