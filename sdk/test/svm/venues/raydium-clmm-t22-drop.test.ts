/**
 * Token-2022 self-drop for raydium-clmm: a pool whose mint is a Token-2022
 * mint must SELF-DROP (fetchPoolConfig throws — the SvmRoute orchestrator's
 * graceful-drop signal) instead of silently assuming legacy SPL. The legacy
 * path stays byte-identical: the unmodified real fixture still resolves.
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import { raydiumClmm } from "../../../src/svm/venues/raydium-clmm/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import {
  makeT22Mint,
  makeLegacyMint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/raydium-clmm");
const POOL = address("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv");
const OFF_TOKEN_MINT_0 = 73;

async function mint0(load: AccountLoader): Promise<string> {
  const data = await load(POOL);
  if (data === null) throw new Error("pool fixture missing");
  return getAddressCodec().decode(data.subarray(OFF_TOKEN_MINT_0, OFF_TOKEN_MINT_0 + 32));
}

function overrideMint(base: AccountLoader, mint: string, bytes: Uint8Array): AccountLoader {
  return async (addr) => (addr === mint ? new Uint8Array(bytes) : base(addr));
}

describe("raydium-clmm Token-2022 self-drop", () => {
  it("drops the pool when a mint is a Token-2022 mint", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeT22Mint());
    await expect(raydiumClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint carries a blocking extension (still a Token-2022 mint)", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(1)));
    await expect(raydiumClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("legacy path unchanged: the unmodified real fixture resolves", async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    await expect(raydiumClmm.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("a swapped-in legacy 82-byte mint does not trip the T22 gate", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeLegacyMint());
    await expect(raydiumClmm.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });
});
