/**
 * solfi-v2 Token-2022 self-drop: a pool whose mint is Token-2022 must DROP
 * (fetchPoolConfig throws — the SvmRoute graceful-drop signal), because the
 * swap CPI is legacy-SPL (Tokenkeg) only. The T22 detection runs before the
 * oracle/registry loads, so the drop needs only the pool + a T22 mint. The
 * legacy path is unchanged: the real mainnet fixture (mint accounts unvendored)
 * behaves exactly as before.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { solfiV2 } from "../../../src/svm/venues/solfi-v2/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import type { Address } from "@solana/kit";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const POOL = address("65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc");
const MINT_A = "So11111111111111111111111111111111111111112"; // wSOL, decoded from the pool bytes
const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/solfi-v2-dir0"));
const baseLoader = fixtureLoader(fixtures);

function withMint(mint: string, bytes: Uint8Array, owner: Address): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: bytes, owner } : baseLoader(addr));
}

describe("solfi-v2 Token-2022 self-drop", () => {
  it("drops when mintA is a Token-2022 mint (before oracle/registry loads)", async () => {
    const load = withMint(MINT_A, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(solfiV2.fetchPoolConfig(load, POOL, 0)).rejects.toThrow(/Token-2022/);
  });

  it("drops when mintA is an 82-byte mint owned by Token-2022 (extensionless Token-2022)", async () => {
    const load = withMint(MINT_A, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(solfiV2.fetchPoolConfig(load, POOL, 0)).rejects.toThrow(/Token-2022/);
  });

  it("a vendored legacy (82-byte) mintA does not trip the T22 drop", async () => {
    // A legacy mint classifies legacy → no T22 throw. (The compile still fails
    // later on the unvendored 1 MiB registry — that is the pre-existing fixture
    // shape, not the T22 gate — so we only assert the error is NOT the T22 one.)
    const load = withMint(MINT_A, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(solfiV2.fetchPoolConfig(load, POOL, 0)).rejects.not.toThrow(/Token-2022/);
  });
});
