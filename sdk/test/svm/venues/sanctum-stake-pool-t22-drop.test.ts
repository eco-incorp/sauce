/**
 * sanctum-stake-pool Token-2022 self-drop: a StakePool whose pool (LST) mint is
 * a Token-2022 mint must SELF-DROP (fetchPoolConfig throws — SvmRoute catches
 * the throw and drops the venue) because DepositSol mints the LST through the
 * classic Tokenkeg program. Synthesizes a minimal StakePool prefix valid
 * through the pool-mint slot (account_type == 1 StakePool + the fixed-offset
 * prefix pubkeys) and answers a Token-2022 mint for the pool mint account.
 */
import { address } from "@solana/kit";
import { sanctumStakePool } from "../../../src/svm/venues/sanctum-stake-pool/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

// The universal "everything None" 611-byte StakePool shape (2,288 of 2,306 live
// pools). Only the fixed-offset prefix through pool_mint (@162) matters here —
// the Token-2022 detection fires before the rest of the cursor/clock is read.
const STAKE_POOL_SIZE = 611;
const OFF_POOL_MINT = 162;
const POOL = address("So11111111111111111111111111111111111111112");

describe("sanctum-stake-pool: Token-2022 mint self-drop", () => {
  it("rejects a pool whose LST mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const buf = new Uint8Array(STAKE_POOL_SIZE);
    buf[0] = 1; // account_type == 1 (StakePool)
    buf.set(new Uint8Array(32).fill(7), OFF_POOL_MINT); // pool_mint @162

    const load: AccountLoader = async (addr) =>
      addr === POOL ? new Uint8Array(buf) : makeT22Mint();
    await expect(sanctumStakePool.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });
});
