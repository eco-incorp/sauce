/**
 * scorch Token-2022 self-drop: a PairConfig one of whose mints is a Token-2022
 * mint must SELF-DROP (fetchPoolConfig throws — the ONE pool leaves discovery)
 * because the ROUTER's swap CPI is legacy-SPL only. Synthesizes a minimal
 * 658-byte PairConfig (tag + the two mint slots) and answers a Token-2022 mint
 * for the mint accounts.
 */
import { address } from "@solana/kit";
import { scorch } from "../../../src/svm/venues/scorch/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const PAIR_CONFIG_SIZE = 658;
const POOL = address("So11111111111111111111111111111111111111112");

describe("scorch: Token-2022 mint self-drop", () => {
  it("rejects a pair whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const buf = new Uint8Array(PAIR_CONFIG_SIZE);
    buf[0] = 0x02; // PAIR_TAG
    buf.set(new Uint8Array(32).fill(7), 16); // mintA @16
    buf.set(new Uint8Array(32).fill(9), 82); // mintB @82

    const load: AccountLoader = async (addr) =>
      addr === POOL ? new Uint8Array(buf) : makeT22Mint();
    await expect(scorch.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });
});
