/**
 * What an intent to Solana is built against, read from the cluster before the program compiles:
 * whether the Pot the Portal's executor owns exists, which token accounts the route would create
 * exist already, and (`--intent-execution-fee auto`) the Kitchen's fee there. The route the
 * lowering builds depends on each (`svm/intent-route.ts`): an account that exists is not created,
 * a Pot that does not is created by the route itself — the only party that can, the executor's
 * signature being the Portal's to give — and a cook delivers the fee it pays.
 *
 * One function for both front ends: the `sauce` command reads its flags into a `ProgramInput` and
 * calls it, and the MCP server its tool arguments.
 */
import { address, type Address as SvmAddress } from "@solana/kit";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import { v12SvmKitchenProgramId } from "../deployments/index.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { pascalOfSlug } from "../routes/accessors.js";
import { fetchExecutionFee } from "../svm/kitchen.js";
import { CliError, UsageError } from "./args.js";
import { compileProgram, probeInput, type CliFiles, type ProgramInput } from "./commands.js";
import { SVM_PACKET_BYTES, svmFillBytes, svmRpc } from "./lifecycle-svm.js";

/** An endpoint for a chain, where one is given: the command's flags, or the MCP server's. */
export type SolanaEndpoint = (
  chain: CanonicalChain,
) => string | undefined | Promise<string | undefined>;

/** The accessor names of the Solana chains, `Solana(` opening an intent there. */
const OPENERS = new RegExp(
  `\\b(?:${CANONICAL_CHAINS.filter((chain) => chain.kind === "svm")
    .map((chain) => pascalOfSlug(chain.slug))
    .join("|")})\\s*\\(`,
);

/** The intents a program opens on Solana, from a compile that assumes nothing exists there. */
export function solanaIntents(input: ProgramInput, files: CliFiles): LoweredIntent[] {
  if (!OPENERS.test(input.text)) return [];

  return compileProgram(probeInput(input), files).intents.filter(
    (intent) => intent.solana !== undefined,
  );
}

/**
 * `input` with `intents.svm` read from the cluster for each intent it opens on Solana; `input` as
 * it is when it opens none. `autoFee` (`--intent-execution-fee auto`) also reads the Kitchen's fee
 * there. Without an endpoint for Solana, a program body is refused — whether the Pot exists is not
 * a guess — and a body of transfers creates every account it pays, idempotently, delivering their
 * rent.
 */
export async function solanaIntentState(
  input: ProgramInput,
  files: CliFiles,
  endpoint: SolanaEndpoint,
  options: { readonly autoFee?: boolean } = {},
): Promise<{ readonly input: ProgramInput; readonly notes: readonly string[] }> {
  const intents = solanaIntents(input, files);
  if (intents.length === 0) return { input, notes: [] };
  const chain = intents[0]!.destination;
  const pot = intents.find((intent) => intent.solana!.pot !== undefined)?.solana!.pot;
  const cooks = pot !== undefined;
  const url = await endpoint(chain);
  if (url === undefined) {
    if (cooks) {
      throw new UsageError(
        `the intent to ${chain.slug} runs a program on the Pot its Portal's executor owns, and its ` +
          "route creates that Pot only where it does not exist yet, which is read from the " +
          `cluster: give ${chain.slug}'s endpoint (--rpc-url for it, or --config with chain id ` +
          `${chain.id}), not --offline`,
      );
    }

    return {
      input,
      notes: [
        `no ${chain.slug} endpoint: the route creates each token account it pays where none ` +
          "exists, and delivers its rent, which stays with the Portal's executor where the account " +
          "is there already",
      ],
    };
  }
  const rpc = svmRpc(url);
  const keys = [
    ...new Set(intents.flatMap((intent) => intent.solana!.accounts.map((each) => each.address))),
  ];
  let found: ReadonlyArray<unknown>;
  try {
    // Every account read at once, a hundred at most per request as the method allows.
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(keys.length / 100) }, (_, page) =>
        rpc
          .getMultipleAccounts(
            keys.slice(page * 100, page * 100 + 100).map((key) => address(key)),
            { encoding: "base64", commitment: "confirmed" },
          )
          .send(),
      ),
    );
    found = pages.flatMap(({ value }) => value);
  } catch (error) {
    throw new CliError(
      `reading the accounts of the intent's route from ${chain.slug} failed: ` +
        (error as Error).message.replace(/[a-z][\w+.-]*:\/\/\S+/gi, "<endpoint>"),
    );
  }
  const exists = new Set(keys.filter((_, index) => found[index] !== null));
  let executionFee = input.intents.svm?.executionFee;
  const notes: string[] = [];
  if (cooks && options.autoFee === true) {
    try {
      executionFee = await fetchExecutionFee(rpc, v12SvmKitchenProgramId() as SvmAddress);
    } catch (error) {
      throw new CliError(
        `--intent-execution-fee auto: reading the Kitchen's fee on ${chain.slug} failed: ` +
          (error as Error).message.replace(/[a-z][\w+.-]*:\/\/\S+/gi, "<endpoint>"),
      );
    }
    notes.push(
      `--intent-execution-fee auto: the Kitchen on ${chain.slug} charges ${executionFee} lamports`,
    );
  }
  if (pot !== undefined && !exists.has(pot)) {
    notes.push(
      `the Pot the Portal's executor owns on ${chain.slug}, ${pot}, does not exist yet: this ` +
        "intent's route creates it, delivering its rent. Only one route can: if another intent " +
        "creating it is filled first, this one cannot be, and its reward is refunded after its " +
        "deadline",
    );
  }

  const read: ProgramInput = {
    ...input,
    intents: {
      ...input.intents,
      svm: {
        ...input.intents.svm,
        ...(executionFee === undefined ? {} : { executionFee }),
        potExists: pot !== undefined && exists.has(pot),
        existing: [...exists].filter((key) => key !== pot),
      },
    },
  };
  await refuseUnfillable(read, files, intents);

  return { input: read, notes };
}

/**
 * Refuses an intent to Solana whose fill does not fit one transaction: no solver could send it.
 * `probed` (built as if no account existed, so with every creation) is measured first; only where
 * one of those is too large is `input` compiled to measure the routes it really builds.
 */
async function refuseUnfillable(
  input: ProgramInput,
  files: CliFiles,
  probed: readonly LoweredIntent[],
): Promise<void> {
  const sizes = await Promise.all(probed.map((intent) => svmFillBytes(intent.intent)));
  if (sizes.every((size) => size <= SVM_PACKET_BYTES)) return;
  const built = compileProgram(input, files).intents.filter(
    (intent) => intent.solana !== undefined,
  );
  for (const intent of built) {
    const size = await svmFillBytes(intent.intent);
    if (size <= SVM_PACKET_BYTES) continue;
    throw new CliError(
      `the intent to ${intent.destination.slug} is filled by a ${size}-byte transaction, past ` +
        `Solana's ${SVM_PACKET_BYTES}: no solver could send it. Its route carries everything the ` +
        "fill runs, a program's bytecode included: pay with token transfers alone, or make the " +
        "program smaller",
    );
  }
}
