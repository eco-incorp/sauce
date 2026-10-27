/**
 * solayer Token-2022 self-drop: an EndoAVS pool one of whose mints
 * (receipt/lst) is a Token-2022 mint must SELF-DROP (fetchSolayerPoolConfig
 * throws — SvmRoute catches the throw and drops the venue) because both
 * directions transfer/mint/burn through the classic Tokenkeg program.
 * Synthesizes a minimal 443-byte EndoAVS account (discriminator + mint/vault
 * slots + empty name) and answers a Token-2022 mint for the mint accounts.
 */
import { address } from "@solana/kit";
import {
  fetchSolayerPoolConfig,
  ENDO_AVS_DISCRIMINATOR,
  SOLAYER_PROGRAM_ID,
} from "../../../src/svm/venues/solayer/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const ENDO_AVS_ACCOUNT_SIZE = 443;
const POOL = address("So11111111111111111111111111111111111111112");

/** The minimal EndoAVS pool for POOL; every other address answers `mint`, owned by Token-2022. */
function poolWithMints(mint: () => Uint8Array): OwnedAccountLoader {
  const buf = new Uint8Array(ENDO_AVS_ACCOUNT_SIZE);
  buf.set(Uint8Array.from(ENDO_AVS_DISCRIMINATOR), 0); // discriminator @0
  buf.set(new Uint8Array(32).fill(7), 41); // receiptMint @41
  buf.set(new Uint8Array(32).fill(9), 73); // lstMint @73
  buf.set(new Uint8Array(32).fill(11), 105); // vault @105
  // name length @137 stays 0 (empty name, valid).
  return async (addr) =>
    addr === POOL
      ? { data: new Uint8Array(buf), owner: SOLAYER_PROGRAM_ID }
      : { data: mint(), owner: TOKEN_2022_PROGRAM_ID };
}

describe("solayer: Token-2022 mint self-drop", () => {
  it("rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    await expect(fetchSolayerPoolConfig(poolWithMints(makeT22Mint), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("rejects a pool whose mint is an extensionless 82-byte mint owned by Token-2022", async () => {
    await expect(fetchSolayerPoolConfig(poolWithMints(makeLegacyMint), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });
});
