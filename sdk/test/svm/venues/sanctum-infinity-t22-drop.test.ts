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
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const IN = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC (stand-in LST mint)
const OUT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT

function loader(mintOverrides: Record<string, Uint8Array>): AccountLoader {
  return async (addr) => (addr in mintOverrides ? mintOverrides[addr] : null);
}

describe("sanctum-infinity Token-2022 self-drop", () => {
  beforeEach(() => __resetSanctumInfinityKeysForTest());

  it("drops when the input mint is a Token-2022 mint", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(loader({ [IN]: makeT22Mint() }), key),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops when the output mint is a Token-2022 mint", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(
        loader({ [IN]: makeLegacyMint(), [OUT]: makeT22Mint() }),
        key,
      ),
    ).rejects.toThrow(/Token-2022/);
  });

  it("legacy mints pass the T22 gate (fails later on the absent pool_state, not the gate)", async () => {
    const key = sanctumInfinityPoolKey(IN, OUT);
    await expect(
      sanctumInfinity.fetchPoolConfig(
        loader({ [IN]: makeLegacyMint(), [OUT]: makeLegacyMint() }),
        key,
      ),
    ).rejects.not.toThrow(/Token-2022/);
  });
});
