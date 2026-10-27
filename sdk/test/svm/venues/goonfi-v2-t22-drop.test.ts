/**
 * GoonFi V2 Token-2022 self-drop: this venue's on-chain swap ix is legacy-SPL
 * (Tokenkeg) only, so fetchPoolConfig must DROP a pool whose mintA or mintB is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). A
 * synthesized 2048-byte pool (correct discriminator + mint pubkeys at the real
 * offsets) reaches the mint gate; the drop fires before the oracle-relay/tier
 * decode. A classic 82-byte mint on both sides is the legacy control (which
 * then fails past the gate on the absent oracle-relay account, never on T22).
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { GOONFI_V2_PROGRAM_ID, goonfiV2 } from "../../../src/svm/venues/goonfi-v2/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

type Owned = { data: Uint8Array; owner: Address };
const t22 = (data: Uint8Array = makeT22Mint()): Owned => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (): Owned => ({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID });

const POOL = address("BNrK9LpEn65QA4TyBLVSMdngW3XHj3xLfFPwGdCBv8wV");
const MINT_A = address("So11111111111111111111111111111111111111112"); // wSOL
const MINT_B = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

const POOL_DISCRIMINATOR = [0x30, 0xbc, 0x2f, 0x35, 0x34, 0x58, 0x32, 0x9a];
const POOL_ACCOUNT_SIZE = 2048;
const OFF_MINT_A = 80;
const OFF_MINT_B = 112;

function synthPool(): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(POOL_DISCRIMINATOR, 0);
  const enc = getAddressEncoder();
  data.set(enc.encode(MINT_A), OFF_MINT_A);
  data.set(enc.encode(MINT_B), OFF_MINT_B);
  return data;
}

function loaderWith(mints: Record<string, Owned>): OwnedAccountLoader {
  const pool = synthPool();
  return async (addr: Address) => {
    if (addr === POOL) return { data: new Uint8Array(pool), owner: GOONFI_V2_PROGRAM_ID };
    const m = mints[addr as string];
    return m === undefined ? null : { data: new Uint8Array(m.data), owner: m.owner };
  };
}

describe("goonfi-v2 Token-2022 self-drop", () => {
  it("drops the pool when mintA is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: t22(), [MINT_B]: legacy() });
    await expect(goonfiV2.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when mintB is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: t22() });
    await expect(goonfiV2.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: t22(makeLegacyMint()) });
    await expect(goonfiV2.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("passes the mint gate for two classic legacy mints (fails later, never on Token-2022)", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: legacy() });
    let message = "";
    try {
      await goonfiV2.fetchPoolConfig(load, POOL);
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toMatch(/Token-2022/);
  });
});
