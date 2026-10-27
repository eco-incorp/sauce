/**
 * Token-2022 self-drop for orca-whirlpool: a pool whose mint is a Token-2022
 * mint must SELF-DROP (fetchPoolConfig throws — the SvmRoute orchestrator's
 * graceful-drop signal) instead of silently assuming legacy SPL. The legacy
 * path stays byte-identical: the unmodified real fixture still resolves. A mint
 * is classified by its OWNER: an extensionless Token-2022 mint is 82 bytes,
 * byte for byte a legacy one, so only the owner can tell them apart.
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { orcaWhirlpool } from "../../../src/svm/venues/orca-whirlpool/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import {
  makeT22Mint,
  makeLegacyMint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/orca-whirlpool");
const POOL = address("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
const OFF_MINT_A = 101;

async function mintA(load: OwnedAccountLoader): Promise<string> {
  const account = await load(POOL);
  if (account === null) throw new Error("pool fixture missing");
  return getAddressCodec().decode(account.data.subarray(OFF_MINT_A, OFF_MINT_A + 32));
}

function overrideMint(
  base: OwnedAccountLoader,
  mint: string,
  bytes: Uint8Array,
  owner: Address,
): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: new Uint8Array(bytes), owner } : base(addr));
}

describe("orca-whirlpool Token-2022 self-drop", () => {
  it("drops the pool when a mint is a Token-2022 mint", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintA(base);
    const load = overrideMint(base, mint, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintA(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint carries a blocking extension (still a Token-2022 mint)", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintA(base);
    const load = overrideMint(
      base,
      mint,
      makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(1)),
      TOKEN_2022_PROGRAM_ID,
    );
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("legacy path unchanged: the unmodified real fixture resolves", async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("a swapped-in legacy 82-byte mint does not trip the T22 gate", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintA(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("refuses the pool when a mint is an 82-byte mint owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintA(base);
    const load = overrideMint(base, mint, makeLegacyMint(), foreign);
    await expect(orcaWhirlpool.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
