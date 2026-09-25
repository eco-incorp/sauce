/**
 * quantum Token-2022 self-drop: a pool one of whose mints is a Token-2022 mint
 * must SELF-DROP (fetchQuantumConfig throws — SvmRoute catches the throw and
 * drops the venue) because this venue's swap is legacy-SPL only. Reuses the
 * real 2280-byte pool fixture for the pool bytes and swaps a mint account for a
 * synthesized Token-2022 mint; a legacy positive-control proves the real pool
 * still resolves.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { fetchQuantumConfig, QUANTUM_POOL_SIZE } from "../../../src/svm/venues/quantum/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIX = resolve(process.cwd(), "test/svm/fixtures/quantum");

describe("quantum: Token-2022 mint self-drop", () => {
  it("rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const fixtures = loadFixtures(FIX);
    const poolFix = fixtures.find((f) => fixtureData(f).length === QUANTUM_POOL_SIZE);
    expect(poolFix).toBeDefined();
    const pool = address(poolFix!.address);
    const poolBytes = fixtureData(poolFix!);
    // Pool bytes for the pool address; a Token-2022 mint for either mint slot.
    const load: AccountLoader = async (addr) =>
      addr === pool ? new Uint8Array(poolBytes) : makeT22Mint();
    await expect(fetchQuantumConfig(load, pool)).rejects.toThrow(/Token-2022/);
  });

  it("positive control: the real legacy-mint fixture pool still resolves", async () => {
    const fixtures = loadFixtures(FIX);
    const poolFix = fixtures.find((f) => fixtureData(f).length === QUANTUM_POOL_SIZE);
    const pool = address(poolFix!.address);
    const load = fixtureLoader(fixtures);
    const cfg = await fetchQuantumConfig(load, pool);
    expect(cfg.venue).toBe("quantum");
  });
});
