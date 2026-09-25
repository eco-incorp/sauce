/**
 * TesseraV swap-wire ABI pin — the mainnet program upgrade (12 -> 14 accounts,
 * tag 0x10 -> 0x11) that was reverting served SOL/USDC swaps with
 * `NotEnoughAccountKeys`.
 *
 * GROUND TRUTH (verified first-hand 2026-09-11 against the live program
 * `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`, deployed binary sha256
 * `82fd37995fcece47a253b1a00c1dd7e4c3fff706b2e42384110e2cbabf4201b3`): a fresh
 * LANDING swap (sig `3ViRTJm94tcZs8p1AeZ4…`) decodes to
 *   data:      11 01 <amountIn u64 LE> <minOut u64 LE>          (tag 0x11)
 *   accounts:  [ auth, pool, owner, vaultA, vaultB, inAta, outAta, mintA,
 *                mintB, tokenProgram, tokenProgram,
 *                8xeaWCsJ…tb3d, BAT1Ndpu…vdhK, 4cG31VNF…brhPs ]   (14)
 * The three appended accounts were byte-identical across 25 landing swaps on 3
 * distinct pools (`FLckH…`, `Ce8W…`, `7sJf…`), all read-only — hence GLOBAL
 * constants, not per-pool. Positions [0..10] are the pre-upgrade set minus the
 * dropped Instructions-sysvar tail.
 *
 * This pins the SDK's contract for the downstream `buildSwapV2`: the tag byte,
 * the appended trio (+ order), and that the config carries them. The SDK does
 * not assemble the CPI itself (see index.ts header) — that lands downstream.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import {
  fetchTesseraVConfig,
  TESSERAV_SWAP_TAG,
  TESSERAV_SWAP_GLOBAL_ACCOUNTS,
} from "../../../src/svm/index.js";
import type { TesseraVPoolConfig } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/tesserav");
const POOL = address("FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n");

/** The exact appended trio measured from landing sig 3ViRTJm9…, positions [11,12,13]. */
const GROUND_TRUTH_GLOBALS = [
  "8xeaWCsJYxRoudEZGJWURdfrtFhLYZz9b4iHJnW5tb3d",
  "BAT1Ndpu5gbLTp2AZkSXP79LJBZfCH4B3zGhi6LtvdhK",
  "4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs",
] as const;

describe("tesserav swap-wire ABI (post-upgrade 14 accounts / tag 0x11)", () => {
  test("the swap tag is 0x11 (was 0x10 before the upgrade)", () => {
    expect(TESSERAV_SWAP_TAG).toBe(0x11);
  });

  test("the 3 appended global accounts match the landing tx exactly, in order", () => {
    expect(TESSERAV_SWAP_GLOBAL_ACCOUNTS.map(String)).toEqual([...GROUND_TRUTH_GLOBALS]);
  });

  test("fetchTesseraVConfig carries the global trio on the config for the downstream CPI builder", async () => {
    const cfg = (await fetchTesseraVConfig(
      fixtureLoader(loadFixtures(FIXTURES)),
      POOL,
      "aToB",
    )) as TesseraVPoolConfig;
    expect(cfg.swapGlobalAccounts.map(String)).toEqual([...GROUND_TRUTH_GLOBALS]);
  });

  test("the full 14-account order the downstream builder must emit (documentation pin)", async () => {
    const cfg = (await fetchTesseraVConfig(
      fixtureLoader(loadFixtures(FIXTURES)),
      POOL,
      "aToB",
    )) as TesseraVPoolConfig;
    const owner = address("11111111111111111111111111111112"); // placeholder — runtime signer
    const inAta = address("11111111111111111111111111111113"); // placeholder — runtime ATA
    const outAta = address("11111111111111111111111111111114"); // placeholder — runtime ATA
    const TOKENKEG = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const wire = [
      cfg.auth,
      cfg.pool,
      owner,
      cfg.vaultA,
      cfg.vaultB,
      inAta,
      outAta,
      cfg.mintA,
      cfg.mintB,
      TOKENKEG,
      TOKENKEG,
      ...cfg.swapGlobalAccounts,
    ];
    expect(wire).toHaveLength(14);
    // Instructions sysvar must NOT appear (it was dropped in the upgrade).
    expect(wire.map(String)).not.toContain("Sysvar1nstructions1111111111111111111111111");
    // Tail is the global trio in order.
    expect(wire.slice(11).map(String)).toEqual([...GROUND_TRUTH_GLOBALS]);
  });
});
