/**
 * The constant-product token-swap adapters' emitted quote, EXECUTED on the released engine over two
 * token accounts holding chosen reserves, and held to `referenceQuote` (0 where it throws: the
 * program fails on a zero quotient or a zero output). The venue suites only assert the fragment's
 * text; this pins the guard's boundary (`rIn * rOut >= rIn + netIn`) and that a healthy pool still
 * quotes what the program computes.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI (`engine-harness.ts`).
 */
import { address } from "@solana/kit";
import { orcaLegacyTokenSwap } from "../../src/svm/venues/orca-legacy-token-swap/index.js";
import type { OrcaLegacyPoolConfig } from "../../src/svm/venues/orca-legacy-token-swap/index.js";
import { tokenSwapV1 } from "../../src/svm/venues/spl-token-swap-forks/index.js";
import type { SplTokenSwapForkPoolConfig } from "../../src/svm/venues/spl-token-swap-forks/index.js";
import { compileSvm, wrapQuoteMain } from "./rs-compile.js";
import {
  describeSvm,
  execute,
  expectOk,
  setTokenAccount,
  startEngine,
  toBigInt,
} from "./engine-harness.js";
import type { EngineHarness, ExecutableOutput } from "./engine-harness.js";

const POOL = address("9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP");
const VAULT_IN = address("CfWX7o2TswwbxusJ4hCaPobu2jLCb1hfXuXJQjVq3jQF");
const VAULT_OUT = address("EnTrdMMpdhugeH6Ban6gYZWXughWxKtVGfCwFn78ZmY3");
const MISC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const fees = {
  tradeFeeNumerator: 25n,
  tradeFeeDenominator: 10_000n,
  ownerTradeFeeNumerator: 5n,
  ownerTradeFeeDenominator: 10_000n,
};
const common = {
  pool: POOL,
  swapAuthority: MISC,
  tokenProgram: TOKEN_PROGRAM,
  vaultIn: VAULT_IN,
  vaultOut: VAULT_OUT,
  poolMint: MISC,
  inputMint: MISC,
  outputMint: MISC,
  poolFeeAccount: MISC,
  bumpSeed: 255,
  ...fees,
};

const AMOUNT_IN = 1_000_000_000n; // netIn = 997_000_000

const venues = [
  {
    name: "orca-legacy-token-swap",
    adapter: orcaLegacyTokenSwap,
    cfg: { venue: "orca-legacy-token-swap", ...common } as OrcaLegacyPoolConfig,
  },
  {
    name: "spl-token-swap-forks (token-swap-v1)",
    adapter: tokenSwapV1,
    cfg: { venue: "token-swap-v1", ...common } as SplTokenSwapForkPoolConfig,
  },
] as const;

// [rIn, rOut]: each side of the guard's boundary for netIn = 997_000_000, the Octane example,
// an empty and a one-unit side, and a healthy pool.
const RESERVES: Array<[bigint, bigint]> = [
  [996_999_999n, 2n], // rIn*rOut = D - 1 -> program fails
  [997_000_000n, 2n], // rIn*rOut = D     -> exactly 1
  [997_000_001n, 2n], // rIn*rOut = D + 1 -> program fails on zero output
  [0n, 1_000_000_000n],
  [1_000n, 2n],
  [1n, 1n],
  [5_000_000_000n, 7_000_000_000n],
  [123_456_789_012n, 987_654_321_098n],
];

describeSvm("token-swap adapters' emitQuote, executed on the engine", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  for (const { name, adapter, cfg } of venues) {
    it(`${name} quotes what the program computes, and 0 where it fails`, async () => {
      const { bytecode, manifest } = compileSvm(
        wrapQuoteMain(2, adapter.emitQuote(cfg as never, 0, AMOUNT_IN), "q0"),
      );
      for (const [rIn, rOut] of RESERVES) {
        setTokenAccount(harness, VAULT_IN, MISC, MISC, rIn);
        setTokenAccount(harness, VAULT_OUT, MISC, MISC, rOut);
        const result = expectOk(
          await execute(harness, { bytecode, manifest } as ExecutableOutput, {
            acc0: VAULT_IN,
            acc1: VAULT_OUT,
          }),
        );
        const state = { [VAULT_IN]: tokenData(rIn), [VAULT_OUT]: tokenData(rOut) };
        let expected: bigint;
        try {
          expected = adapter.referenceQuote(cfg as never, state, AMOUNT_IN, 0n);
        } catch (error) {
          if (!String(error).includes("fails on-chain")) throw error;
          expected = 0n;
        }
        expect({ rIn, rOut, quote: toBigInt(result.returnData) }).toEqual({
          rIn,
          rOut,
          quote: expected,
        });
      }
    });
  }
});

/** A 165-byte token-account image with `amount` at offset 64 (all `referenceQuote` reads). */
function tokenData(amount: bigint): Uint8Array {
  const data = new Uint8Array(165);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}
