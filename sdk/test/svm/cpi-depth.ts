/**
 * How deep a program can CPI, entered through the Kitchen or directly — shared by the two suites
 * that measure it, one per LiteSVM: `direct-engine.e2e.test.ts` (every runtime feature on, so
 * SIMD-0268's 9-deep invoke stack) and `direct-engine-depth.e2e.test.ts` (that feature off, the
 * 5-deep stack mainnet runs).
 *
 * NOT a `.test.ts`, so jest never collects it.
 *
 * The probe is a chain of engine frames. {@link LINK} runs `next` — the instruction data of a direct
 * cook of this same program — on the engine, handing on the four accounts it was given and the
 * three a direct cook pays with, and stops when `next` is empty. The engine calling itself is direct
 * self-recursion, which the runtime allows, so every frame the chain adds is one more instruction on
 * the invoke stack and nothing else. The first frame is entered either way under test: a Kitchen
 * `cook_from_account` (whose own frame sits below it) or the engine's `cookAndPayFromAccountPinned`.
 * It is staged because the nested payload outgrows a transaction.
 */
import { AccountRole } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";

import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  COOK_AND_PAY_DISCRIMINATOR,
  type TailAccount,
} from "../../src/svm/index.js";
import { HARNESS_POT_SALT, stageProgram, type EngineHarness } from "./engine-harness.js";

export type Via = "kitchen" | "engine";

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;

export const LINK = compileSauceProgram(
  "solana",
  [
    "function main(engine: Account, payer: Account<Writable, Signer>, system: Account, config: Account<Writable>, next: bytes) {",
    "  if (next.length > 0n) {",
    "    svm.call(engine, [engine, payer, system, config, payer, system, config], next);",
    "  }",
    "}",
  ].join("\n"),
);

/** LINK's payload — its bytecode and its `next` argument. */
const link = (next: Uint8Array): Uint8Array =>
  new Uint8Array([
    ...LINK.bytecode,
    ...encodeEntryArguments(LINK, [`0x${Buffer.from(next).toString("hex")}`]),
  ]);

/** The staged payload of a chain `frames` engine frames long: the first frame's program, with the
 *  rest nested in its `next` as direct cooks capped at a zero fee. */
export function chain(frames: number): Uint8Array {
  let next = new Uint8Array();
  for (let frame = 1; frame < frames; frame++) {
    next = new Uint8Array([...COOK_AND_PAY_DISCRIMINATOR, ...new Uint8Array(8), ...link(next)]);
  }

  return link(next);
}

/** What one chain did: its deepest invoke-stack height, or the error it failed with. */
export interface Depth {
  readonly height?: number;
  readonly err?: string;
}

/** Runs a chain of `frames` engine frames entered `via`, staged under `nonce`. */
export async function runChain(
  harness: EngineHarness,
  via: Via,
  frames: number,
  nonce: bigint,
): Promise<Depth> {
  const staged = await stageProgram(harness, chain(frames), nonce);
  const tail: TailAccount[] = [
    { address: harness.programId, role: AccountRole.READONLY },
    { address: harness.payer.address, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: harness.feeConfig, role: AccountRole.WRITABLE },
  ];
  const cook: Instruction =
    via === "kitchen"
      ? buildCookFromAccountInstruction({
          kitchen: harness.kitchen,
          owner: harness.payer.address,
          codeBuffer: staged.codeBuffer,
          code: staged.code,
          engineProgram: harness.programId,
          potSalt: HARNESS_POT_SALT,
          pot: harness.pot,
          feeConfig: harness.feeConfig,
          maxExecutionFee: 0n,
          tail,
        })
      : buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: harness.programId,
          code: staged.code,
          expectedSha256: staged.sha256,
          feeConfig: harness.feeConfig,
          feePayer: harness.payer.address,
          maxExecutionFee: 0n,
          tail,
        });
  harness.svm.expireBlockhash();
  const transaction = await buildExecuteTransaction({
    payer: harness.payer,
    instructions: [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      cook,
    ],
    latestBlockhash: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
  });
  const result = harness.svm.sendTransaction(transaction);
  if (result instanceof FailedTransactionMetadata) return { err: String(result.err()) };
  const heights = result
    .innerInstructions()
    .flatMap((group) => group.map((inner) => inner.stackHeight()));

  return { height: Math.max(1, ...heights) };
}

/** The longest chain each entry runs, adding a frame until the runtime refuses one, and the
 *  deepest invoke-stack height any run reached. Every refusal must be the depth limit. */
export async function longestChains(
  harness: EngineHarness,
  firstNonce: bigint,
): Promise<{ longest: Record<Via, number>; height: number; refusals: readonly string[] }> {
  let nonce = firstNonce;
  const longest: Record<Via, number> = { kitchen: 0, engine: 0 };
  const refusals: string[] = [];
  let height = 0;
  for (const via of ["kitchen", "engine"] as const) {
    for (let frames = 1; frames <= 12; frames++) {
      const outcome = await runChain(harness, via, frames, nonce++);
      if (outcome.err !== undefined) {
        refusals.push(outcome.err);
        break;
      }
      longest[via] = frames;
      height = Math.max(height, outcome.height!);
    }
  }

  return { longest, height, refusals };
}
