/**
 * sanctum-stake-pool Token-2022 self-drop: a StakePool whose pool (LST) mint is
 * a Token-2022 mint must SELF-DROP (fetchPoolConfig throws — SvmRoute catches
 * the throw and drops the venue) because DepositSol mints the LST through the
 * classic Tokenkeg program. Synthesizes a minimal StakePool prefix valid
 * through the pool-mint slot (account_type == 1 StakePool + the fixed-offset
 * prefix pubkeys) and answers a Token-2022 mint for the pool mint account.
 */
import { address, getAddressDecoder } from "@solana/kit";
import {
  SANCTUM_STAKE_POOL_PROGRAM_ID,
  sanctumStakePool,
} from "../../../src/svm/venues/sanctum-stake-pool/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

// The universal "everything None" 611-byte StakePool shape (2,288 of 2,306 live
// pools). Only the fixed-offset prefix through pool_mint (@162) matters here —
// the Token-2022 detection fires before the rest of the cursor/clock is read.
const STAKE_POOL_SIZE = 611;
const OFF_POOL_MINT = 162;
const POOL = address("So11111111111111111111111111111111111111112");

function stakePoolBytes(): Uint8Array {
  const buf = new Uint8Array(STAKE_POOL_SIZE);
  buf[0] = 1; // account_type == 1 (StakePool)
  buf.set(new Uint8Array(32).fill(7), OFF_POOL_MINT); // pool_mint @162
  return buf;
}

describe("sanctum-stake-pool: Token-2022 mint self-drop", () => {
  it("rejects a pool whose LST mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const buf = stakePoolBytes();
    const load: OwnedAccountLoader = async (addr) =>
      addr === POOL
        ? { data: new Uint8Array(buf), owner: SANCTUM_STAKE_POOL_PROGRAM_ID }
        : { data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID };
    await expect(sanctumStakePool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("rejects a pool whose LST mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const buf = stakePoolBytes();
    const load: OwnedAccountLoader = async (addr) =>
      addr === POOL
        ? { data: new Uint8Array(buf), owner: SANCTUM_STAKE_POOL_PROGRAM_ID }
        : { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID };
    await expect(sanctumStakePool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("rejects a pool whose 82-byte LST mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const buf = stakePoolBytes();
    const poolMint = getAddressDecoder().decode(new Uint8Array(32).fill(7));
    const load: OwnedAccountLoader = async (addr) =>
      addr === POOL
        ? { data: new Uint8Array(buf), owner: SANCTUM_STAKE_POOL_PROGRAM_ID }
        : { data: makeLegacyMint(), owner: foreign };
    await expect(sanctumStakePool.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token-program: mint ${poolMint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
