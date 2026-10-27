/**
 * Token-2022 self-drop for saros-dlmm: a pair whose mint is a Token-2022 mint
 * must SELF-DROP (fetchPoolConfig throws — the SvmRoute orchestrator's
 * graceful-drop signal) instead of silently assuming legacy SPL. The legacy
 * path stays byte-identical: the unmodified real fixture still resolves. The
 * mint is classified by its OWNER: an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one.
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { sarosDlmm } from "../../../src/svm/venues/saros-dlmm/index.js";
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

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/saros-dlmm");
const POOL = address("DHXKB9fSff4LjubMFieKxaBrvNY6AzXVwaRLk5N2vs87");
const OFF_TOKEN_X_MINT = 43;

async function mintX(load: OwnedAccountLoader): Promise<string> {
  const account = await load(POOL);
  if (account === null) throw new Error("pair fixture missing");
  return getAddressCodec().decode(account.data.subarray(OFF_TOKEN_X_MINT, OFF_TOKEN_X_MINT + 32));
}

function overrideMint(
  base: OwnedAccountLoader,
  mint: string,
  bytes: Uint8Array,
  owner: Address,
): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: new Uint8Array(bytes), owner } : base(addr));
}

describe("saros-dlmm Token-2022 self-drop", () => {
  it("drops the pair when a mint is a Token-2022 mint", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintX(base);
    const load = overrideMint(base, mint, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(sarosDlmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pair when a mint is 82 bytes but owned by Token-2022 (extensionless)", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintX(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(sarosDlmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pair when a mint carries a blocking extension (still a Token-2022 mint)", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintX(base);
    const load = overrideMint(
      base,
      mint,
      makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(1)),
      TOKEN_2022_PROGRAM_ID,
    );
    await expect(sarosDlmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("legacy path unchanged: the unmodified real fixture resolves", async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    await expect(sarosDlmm.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("a swapped-in legacy 82-byte mint does not trip the T22 gate", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mintX(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(sarosDlmm.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });
});
