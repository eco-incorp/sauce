/**
 * quantum Token-2022 self-drop: a pool one of whose mints is a Token-2022 mint
 * must SELF-DROP (fetchQuantumConfig throws — SvmRoute catches the throw and
 * drops the venue) because this venue's swap is legacy-SPL only. Reuses the
 * real 2280-byte pool fixture for the pool bytes and swaps a mint account for a
 * synthesized Token-2022 mint; a legacy positive-control proves the real pool
 * still resolves.
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  fetchQuantumConfig,
  QUANTUM_POOL_SIZE,
  QUANTUM_PROGRAM_ID,
} from "../../../src/svm/venues/quantum/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIX = resolve(process.cwd(), "test/svm/fixtures/quantum");

/** The real pool's bytes for the pool address; `mint`, owned by Token-2022, for either mint slot. */
function poolWithMints(mint: () => Uint8Array): { pool: Address; load: OwnedAccountLoader } {
  const fixtures = loadFixtures(FIX);
  const poolFix = fixtures.find((f) => fixtureData(f).length === QUANTUM_POOL_SIZE);
  expect(poolFix).toBeDefined();
  const pool = address(poolFix!.address);
  const poolBytes = fixtureData(poolFix!);
  const load: OwnedAccountLoader = async (addr) =>
    addr === pool
      ? { data: new Uint8Array(poolBytes), owner: QUANTUM_PROGRAM_ID }
      : { data: mint(), owner: TOKEN_2022_PROGRAM_ID };
  return { pool, load };
}

describe("quantum: Token-2022 mint self-drop", () => {
  it("rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const { pool, load } = poolWithMints(makeT22Mint);
    await expect(fetchQuantumConfig(load, pool)).rejects.toThrow(/Token-2022/);
  });

  it("rejects a pool whose mint is an extensionless 82-byte mint owned by Token-2022", async () => {
    const { pool, load } = poolWithMints(makeLegacyMint);
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

  it("rejects a pool whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const fixtures = loadFixtures(FIX);
    const poolFix = fixtures.find((f) => fixtureData(f).length === QUANTUM_POOL_SIZE);
    expect(poolFix).toBeDefined();
    const pool = address(poolFix!.address);
    const poolBytes = fixtureData(poolFix!);
    const codec = getAddressCodec();
    // mint0 @0 and mint1 @32 of the pool account.
    const mints = [
      codec.decode(poolBytes.subarray(0, 32)),
      codec.decode(poolBytes.subarray(32, 64)),
    ];
    const base = fixtureLoader(fixtures);
    for (const mint of mints) {
      expect((await base(mint))?.data.length).toBe(82);
      const load: OwnedAccountLoader = async (addr) => {
        const account = await base(addr);
        return addr === mint && account !== null ? { data: account.data, owner: foreign } : account;
      };
      await expect(fetchQuantumConfig(load, pool)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
