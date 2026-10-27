/**
 * saber-stableswap Token-2022 self-drop: a pool whose mint is a Token-2022
 * mint must DROP (fetchPoolConfig throws — the SvmRoute graceful-drop signal),
 * because the v1 swap ix is legacy-SPL (Tokenkeg) only. The legacy path is
 * unchanged: the real mainnet fixture (whose mint accounts are not vendored)
 * still decodes fine.
 */
import { resolve } from "path";
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { saberStableswap } from "../../../src/svm/venues/saber-stableswap/index.js";
import type { SaberPoolConfig } from "../../../src/svm/venues/saber-stableswap/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import {
  makeLegacyMint,
  makeT22Mint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const POOL = address("YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe");
const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/saber-stableswap"));
const baseLoader = fixtureLoader(fixtures);

/** Loader that overrides one mint's bytes and owner, delegating everything else to the fixture. */
function withMint(mint: string, bytes: Uint8Array, owner: Address): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: bytes, owner } : baseLoader(addr));
}

describe("saber-stableswap Token-2022 self-drop", () => {
  let mintA: string;
  beforeAll(async () => {
    const cfg = (await saberStableswap.fetchPoolConfig(baseLoader, POOL)) as SaberPoolConfig;
    mintA = cfg.mintA;
  });

  it("legacy path is unchanged (mint accounts unvendored → legacy assumption)", async () => {
    await expect(saberStableswap.fetchPoolConfig(baseLoader, POOL)).resolves.toBeDefined();
  });

  it("a vendored legacy (82-byte) mint keeps the pool routable", async () => {
    const load = withMint(mintA, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("drops when mintA is a Token-2022 mint", async () => {
    const load = withMint(mintA, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops when mintA is an extensionless 82-byte mint owned by Token-2022", async () => {
    const load = withMint(mintA, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops when mintA is a Token-2022 mint carrying a blocking extension", async () => {
    const load = withMint(
      mintA,
      makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(0)),
      TOKEN_2022_PROGRAM_ID,
    );
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(
      new RegExp(`dropping pool ${POOL}`),
    );
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const pool = await baseLoader(POOL);
    expect(pool).not.toBeNull();
    // SwapInfo: token A mint @203, token B mint @235.
    const mints = [203, 235].map((off) =>
      getAddressDecoder().decode(pool!.data.subarray(off, off + 32)),
    );
    expect(mints[0]).toBe(mintA);
    for (const mint of mints) {
      const load = withMint(mint, makeLegacyMint(), foreign);
      await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
