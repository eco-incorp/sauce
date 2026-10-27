/**
 * stabble-stable-swap Token-2022 self-drop: a pool holding a Token-2022 mint
 * must DROP (fetchPoolConfig throws — the SvmRoute graceful-drop signal),
 * because the v1 `swap` ix has no Token-2022 / transfer-fee accounting. The
 * legacy path is unchanged: the real mainnet fixture (mint accounts unvendored)
 * still decodes fine.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { stabbleStableSwap } from "../../../src/svm/venues/stabble-stable-swap/index.js";
import type { StabbleStableSwapPoolConfig } from "../../../src/svm/venues/stabble-stable-swap/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const POOL = address("5K7CHUbBYAh6wrantyJvDDqwT4VoKuZTi73CN1DTUUer");
const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/stabble-stable-swap"));
const baseLoader = fixtureLoader(fixtures);

function withMint(mint: string, bytes: Uint8Array, owner: Address): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: bytes, owner } : baseLoader(addr));
}

describe("stabble-stable-swap Token-2022 self-drop", () => {
  let mintA: string;
  beforeAll(async () => {
    const cfg = (await stabbleStableSwap.fetchPoolConfig(
      baseLoader,
      POOL,
    )) as StabbleStableSwapPoolConfig;
    mintA = cfg.tokens[0].mint;
  });

  it("legacy path is unchanged (mint accounts unvendored → legacy assumption)", async () => {
    await expect(stabbleStableSwap.fetchPoolConfig(baseLoader, POOL)).resolves.toBeDefined();
  });

  it("a vendored legacy (82-byte) mint keeps the pool routable", async () => {
    const load = withMint(mintA, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(stabbleStableSwap.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("drops when the first token is a Token-2022 mint", async () => {
    const load = withMint(mintA, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(stabbleStableSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops when the first token is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = withMint(mintA, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(stabbleStableSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const cfg = (await stabbleStableSwap.fetchPoolConfig(
      baseLoader,
      POOL,
    )) as StabbleStableSwapPoolConfig;
    for (const mint of [cfg.tokens[0].mint, cfg.tokens[1].mint]) {
      const load = withMint(mint, makeLegacyMint(), foreign);
      await expect(stabbleStableSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
