/**
 * Token-2022 self-drop for pancakeswap-clmm: a pool whose mint is a Token-2022
 * mint must SELF-DROP (fetchPoolConfig throws — the SvmRoute orchestrator's
 * graceful-drop signal) instead of silently assuming legacy SPL.
 *
 * pancakeswap-clmm has no fixture of its own, but its PoolState/AmmConfig
 * layout is byte-identical to raydium-clmm's (a verbatim fork — see the venue
 * module header), and the Token-2022 mint check runs BEFORE the AmmConfig load
 * or any tick-array PDA derivation. So we drive the decode with raydium-clmm's
 * real pool + AmmConfig fixture bytes and only synthesize the mint accounts.
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { pancakeswapClmm } from "../../../src/svm/venues/pancakeswap-clmm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../src/svm/token-program.js";
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

async function mint0(load: OwnedAccountLoader): Promise<string> {
  const account = await load(POOL);
  if (account === null) throw new Error("pool fixture missing");
  return getAddressCodec().decode(account.data.subarray(OFF_TOKEN_MINT_0, OFF_TOKEN_MINT_0 + 32));
}

function overrideMint(
  base: OwnedAccountLoader,
  mint: string,
  bytes: Uint8Array,
  owner: Address,
): OwnedAccountLoader {
  return async (addr) => (addr === mint ? { data: new Uint8Array(bytes), owner } : base(addr));
}

describe("pancakeswap-clmm Token-2022 self-drop", () => {
  it("drops the pool when a mint is a Token-2022 mint", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeT22Mint(), TOKEN_2022_PROGRAM_ID);
    await expect(pancakeswapClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint carries a blocking extension (still a Token-2022 mint)", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(
      base,
      mint,
      makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(1)),
      TOKEN_2022_PROGRAM_ID,
    );
    await expect(pancakeswapClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint is an extensionless 82-byte mint owned by Token-2022", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_2022_PROGRAM_ID);
    await expect(pancakeswapClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("a swapped-in legacy 82-byte mint does not trip the T22 gate", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeLegacyMint(), TOKEN_PROGRAM_ID);
    await expect(pancakeswapClmm.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it("refuses the pool when a mint is an 82-byte mint owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mint = await mint0(base);
    const load = overrideMint(base, mint, makeLegacyMint(), foreign);
    await expect(pancakeswapClmm.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
