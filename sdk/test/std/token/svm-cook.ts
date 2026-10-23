/**
 * Running a compiled `@sauce/token` program on the real SVM engine (LiteSVM), through a Kitchen cook,
 * for the suites that execute the SVM arm: `svm.e2e.test.ts` (legacy SPL Token) and
 * `svm-token-2022.e2e.test.ts` (Token-2022).
 *
 * The accounts are attached from the compiler's own SVM MANIFEST rather than a hand-written list, so
 * the attach contract the SDK would follow in production is the one under test: every entry is a slot
 * resolved by name, in manifest order. A CPI callee is no exception — it is an account the caller
 * passes, so the token program arrives as a named slot like any other.
 */
import { getAddressCodec } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import {
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildHeapFramePrepend,
} from "../../../src/svm/index.js";
import type { ResolvedAccountMeta } from "../../../src/svm/index.js";
import {
  expectFail,
  expectOk,
  HARNESS_POT_SALT,
  sendInstructions,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import { compileStdToken } from "./harness.js";
import type { AccountManifest } from "./harness.js";

/** Generous, so nothing here ever starves on compute rather than on the behavior under test. */
const COMPUTE_UNITS = 1_400_000;

const codec = getAddressCodec();

/** A pubkey as the SauceScript big-endian bigint literal the library compares `svm.sload(…).toBe()` against. */
export const literal = (address: Address): string =>
  `0x${Buffer.from(codec.encode(address)).toString("hex")}n`;

const missing = (what: string): never => {
  throw new Error(`the SVM manifest ${what}`);
};

/**
 * The attach contract, applied: every manifest slot resolves by NAME from `slots`, in manifest order.
 * This is what an SDK consumer of the Rust compiler does with the manifest, so a wrong order or an
 * unresolved slot fails the transaction rather than a matcher.
 *
 * There is no separate program entry to special-case any more: a CPI callee is an account the caller
 * attaches, so it reaches the manifest as an ordinary named slot and is resolved like the rest — which
 * is why these tests pass the token program in `slots` under the name the library declares it with.
 * `remaining` marks where a caller's own variable-length accounts begin; no fixture here uses one, so
 * it is an explicit failure rather than a silently dropped entry.
 */
const attach = (
  manifest: AccountManifest | undefined,
  slots: Record<string, ResolvedAccountMeta>,
): ResolvedAccountMeta[] =>
  (manifest ?? missing("is absent — the svm target must emit one")).accounts.map((entry) =>
    entry.kind === "remaining"
      ? missing(
          `asks for a remaining-accounts tail at ${entry.from}, which this suite does not attach`,
        )
      : (slots[entry.name] ?? missing(`names a slot the test did not resolve: ${entry.name}`)),
  );

/** A program to run: an entry the harness compiles against the library, or one compiled already. */
export type Program =
  string | { readonly bytecode: Uint8Array; readonly manifest?: AccountManifest };

/** Compile `entry` for the SVM and assemble the transaction that runs it with its manifest-derived accounts. */
const instructionsFor = (
  harness: EngineHarness,
  entry: Program,
  slots: Record<string, ResolvedAccountMeta>,
): Instruction[] => {
  const { bytecode, manifest } = typeof entry === "string" ? compileStdToken(entry, "svm") : entry;

  return [
    ...buildComputeBudgetPrepend({ unitLimit: COMPUTE_UNITS }),
    buildHeapFramePrepend(),
    buildCookInstruction({
      kitchen: harness.kitchen,
      owner: harness.payer.address,
      engineProgram: harness.programId,
      potSalt: HARNESS_POT_SALT,
      pot: harness.pot,
      feeConfig: harness.feeConfig,
      bytecode,
      maxExecutionFee: 0n,
      tail: attach(manifest, slots),
    }),
  ];
};

/** Run `entry` and return the engine's output, failing the test if the transaction did not succeed. */
export const run = (
  harness: EngineHarness,
  entry: Program,
  slots: Record<string, ResolvedAccountMeta>,
): Promise<Uint8Array> =>
  sendInstructions(harness, instructionsFor(harness, entry, slots)).then(
    (result) => expectOk(result).returnData,
  );

/** Run `entry`, which must fail, and return the failure: its error, logs and return data. */
export const failure = (
  harness: EngineHarness,
  entry: Program,
  slots: Record<string, ResolvedAccountMeta>,
): Promise<{ revertData: Uint8Array; err: string; logs: string[] }> =>
  sendInstructions(harness, instructionsFor(harness, entry, slots)).then(expectFail);

/**
 * Run `entry`, which must be refused, and return the reason it reverted with: the `require`'s
 * message, which the engine returns as the failed cook's return data. Every check the library makes
 * names what it refused, so each failure is asserted by WHICH check fired, not merely by the
 * transaction failing — a failure for some other reason (an account the test attached wrongly) would
 * otherwise pass as the refusal under test.
 */
export const reasonOf = (
  harness: EngineHarness,
  entry: Program,
  slots: Record<string, ResolvedAccountMeta>,
): Promise<string> =>
  failure(harness, entry, slots).then(({ revertData }) => new TextDecoder().decode(revertData));
