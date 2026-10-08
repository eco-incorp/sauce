/**
 * The intents a file opens, in full — what `sauce intent fill` rehearses from the file and the
 * lifecycle verbs name by it — read where they exist: in the Portal's `IntentPublished`.
 *
 * In a program an intent is `@sauce/intents`' classes, which the compiler runs: the intent is one
 * literal the program encodes as it runs, and nothing the compile hands back. So the file is
 * rehearsed publishing them (`eth_simulateV1`): compiled with its rewards left unpaid
 * (`intents.fund: false`, which changes no intent), cooked on `owner`'s Pot, and each intent
 * rebuilt from its log (`portal.ts#intentFromPublished`, which holds it to the hash the log
 * announces). A value the program measures as it runs is measured on that Pot as it stands.
 */
import type { Address, Hex } from "viem";

import { CliError, UsageError } from "./args.js";
import { connectAt, kitchenFee, potState } from "./chain.js";
import {
  cookOf,
  kitchenAddress,
  potOf,
  refuseSwappingBodies,
  valueOf,
  withSwapRoutes,
  type CliFiles,
  type CookInput,
  type ProgramInput,
} from "./commands.js";
import { loggedIntents, type FileIntent } from "./logged-intents.js";
import { rehearse } from "./rehearse.js";

/** The owner a file is rehearsed for when none is named: an account nobody holds the key of. */
export const REHEARSAL_OWNER: Address = "0x0000000000000000000000000000000000000001";

/** How a file is rehearsed for its intents: the source chain's endpoint, and whose Pot. */
export interface RehearsalAccess {
  readonly rpcUrl: string;
  /** The Pot's owner (default salt); {@link REHEARSAL_OWNER} when absent. */
  readonly owner?: Address;
  /** The block to rehearse on, the latest when absent. */
  readonly block?: string;
}

/** A file whose intents are read, with `main`'s arguments as the cook passes them. */
export type FileInput = ProgramInput & Pick<CookInput, "args">;

/**
 * The intents `input`'s file opens, read from a rehearsal of publishing them from a Pot on the
 * source chain. `command` names the caller in a refusal.
 */
export async function fileIntents(
  input: FileInput,
  files: CliFiles,
  access: RehearsalAccess,
  command: string,
): Promise<readonly FileIntent[]> {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `${command} reads the intents ${input.file} opens from the Portal on ${input.chain.slug}, ` +
        "and the eco-routes Portal this SDK publishes through is EVM only",
    );
  }
  const owner = access.owner ?? REHEARSAL_OWNER;
  const zero = `0x${"0".repeat(64)}` as Hex;
  const target = { owner, salt: zero };
  // A body's swap would be another route, so another intent, than the one published; the program's
  // own swaps, which the rehearsal runs, are routed for its Pot.
  refuseSwappingBodies(input, files);
  const routed = await withSwapRoutes(input, files, potOf(target));
  const cook = cookOf(
    { ...routed, intents: { ...routed.intents, fund: false }, target },
    files,
    true,
  );
  if (cook.program.bodies.length === 0) throw new UsageError(`${input.file} opens no intent`);
  const { client } = await connectAt(access.rpcUrl, input.chain, access.block);
  const state = await potState(client, cook.pot);
  const value = valueOf(undefined, await kitchenFee(client, input.chain), input.chain);
  const rehearsal = await rehearse(client, {
    owner,
    pot: cook.pot,
    kitchen: kitchenAddress(),
    ...(state.deployed ? {} : { deploy: { salt: zero } }),
    cook: { to: cook.pot, data: cook.data, value },
    // The owner sends the cook's value; this rehearsal gives it.
    overrides: [{ address: owner, balance: value }],
  });
  if (!rehearsal.ok) {
    throw new CliError(
      `${command}: publishing the intents ${input.file} opens reverts in a rehearsal on ` +
        `${input.chain.slug} (the rewards unpaid, from ${owner}'s Pot): ${rehearsal.reason}`,
    );
  }
  if (rehearsal.logs === undefined) {
    throw new CliError(
      `${command} reads the intents ${input.file} opens from the logs of a rehearsal, and the ` +
        `${input.chain.slug} endpoint has no eth_simulateV1 (${rehearsal.fallback ?? "it fell back to eth_call"}): ` +
        "give one that does with --rpc-url or --config",
    );
  }
  const intents = loggedIntents(input.chain, rehearsal.logs);
  if (intents.length === 0) {
    throw new CliError(
      `${command}: a rehearsal of ${input.file} on ${input.chain.slug} published no intent`,
    );
  }

  return intents;
}
