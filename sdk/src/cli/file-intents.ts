/**
 * The intents a file opens, in full — what `sauce intent publish` sends from a wallet, `intent fill`
 * rehearses from the file and `inspect` shows — read from what the file compiles to.
 *
 * In a program an intent is `@sauce/intents`' classes, which the compiler runs: the intent exists as
 * one literal the program encodes as it runs, not as anything the compile hands back. How the
 * command reads it without a second encoder is not settled yet, so every command that needs it
 * refuses here, by name.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import type { IntentFundVia } from "../routes/portal.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import type { Intent } from "../routes/types.js";
import { UsageError } from "./args.js";

/** One intent a file opens, as it would be published. */
export interface FileIntent {
  readonly intent: Intent;
  readonly destination: CanonicalChain;
  /** How its reward is funded. */
  readonly fundVia: IntentFundVia;
  /** What the program supplies as it runs: none, and it is fixed now. */
  readonly captures: readonly string[];
  /** Each placeholder the encoded intent carries, and the value whose place it holds. */
  readonly sentinels: readonly { readonly sentinel: bigint; readonly capture: string }[];
}

/** The intents `program`'s file opens, each in full. */
export function fileIntents(program: CompiledSauceProgram, command: string): readonly FileIntent[] {
  throw new UsageError(
    `${command} reads the intents ${program.chain.slug} would publish from the file, which this ` +
      "build cannot do yet: run the file on a Pot with `sauce run`, or name a published intent by " +
      "its hash",
  );
}
