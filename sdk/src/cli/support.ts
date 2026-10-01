/**
 * The release's chain gate, shared by every front end of the `sauce` command: this command and the
 * MCP server call the same {@link requireSupported}, from the command functions both of them call
 * (`txCommand`, `runCommand`, `potDeployCommand`, `publishCommand`, `fillCommand`, the lifecycle's
 * `build*`) and, where a front end reaches a network before those, from the front end too.
 *
 * Anything that leaves a transaction ready to sign — the unsigned JSON included — or sends one is
 * refused on a preview chain (`chains/support.ts`), before any network call or key: the cook
 * (`tx`, `run`), a Pot's deployment, publishing intents, and every lifecycle step. An intent is
 * published only when every chain it involves is supported: its source, its destination, and each
 * destination an intent nested in its body opens. Each lifecycle step is refused by the chain it is
 * sent on. Nothing else is: compiling, simulating, dry runs and every read work on every chain.
 *
 * The refusal names the supported chains and, for each preview chain, how to ask for it
 * (`chainSupportRequest`), as a message for a person and as {@link PreviewChainRefusal} for an
 * agent: the MCP server returns that structure as the tool's result.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import {
  CHAIN_SUPPORT_NEW_ISSUE_URL,
  chainSupportRequest,
  isSupportedChain,
  supportedChains,
  type ChainSupportRequest,
} from "../chains/support.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { CliError } from "./args.js";

/** A chain as a refusal names it. */
export interface ChainSummary {
  readonly slug: string;
  readonly id: number;
  readonly name: string;
}

/** Why something was refused on a preview chain, and what to do about it. */
export interface PreviewChainRefusal {
  readonly code: "preview-chain";
  /** What was refused: "building the cook transaction". */
  readonly action: string;
  /** The refusal as a person reads it: what is supported, and how to ask for the rest. */
  readonly message: string;
  /** The chains transactions are built and sent on. */
  readonly supportedChains: readonly ChainSummary[];
  /** The preview chains the refused action involves, each with its request. */
  readonly previewChains: ReadonlyArray<ChainSummary & { readonly request: ChainSupportRequest }>;
}

/** A refusal on a preview chain: exit 1 from the command, a structured result from a tool. */
export class PreviewChainError extends CliError {
  constructor(readonly refusal: PreviewChainRefusal) {
    super(refusal.message);
  }
}

const summary = (chain: CanonicalChain): ChainSummary => ({
  slug: chain.slug,
  id: chain.id,
  name: chain.name,
});

/** `["a", "b", "c"]` as "a, b and c". */
const listed = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** The supported chains by name, as every message says them: "Ethereum, Base and Solana". */
export const supportedChainNames = (): string => listed(supportedChains().map((c) => c.name));

/** One sentence of what a preview chain still does, for a help text or a note. */
export const previewChainsNote = (): string =>
  `For the initial release, transactions are built and sent only on ${supportedChainNames()}. ` +
  "Every other chain is a preview chain: programs compile there, and simulate, dry runs and " +
  `reads work, but no transaction is built or sent. Ask for a chain: ${CHAIN_SUPPORT_NEW_ISSUE_URL}`;

/** The refusal of `action` for the preview chains among `chains`; `undefined` when there is none. */
export function previewRefusal(
  action: string,
  chains: readonly CanonicalChain[],
): PreviewChainRefusal | undefined {
  const preview = [...new Map(chains.map((chain) => [chain.id, chain])).values()].filter(
    (chain) => !isSupportedChain(chain),
  );
  if (preview.length === 0) return undefined;
  const named = listed(
    preview.map((chain) => `${chain.slug} (${chain.name}, chain id ${chain.id})`),
  );
  const requests = preview.map((chain) => ({
    ...summary(chain),
    request: chainSupportRequest(chain),
  }));
  const message = [
    `${action} is refused: it involves ${named}, ${preview.length === 1 ? "a preview chain" : "preview chains"}. ` +
      `For the initial release, the sauce command and its MCP server build and send transactions ` +
      `only on ${supportedChainNames()}. On a preview chain a program still compiles, and ` +
      "simulate and dry runs rehearse it.",
    ...requests.map(
      ({ name, request }) =>
        `To ask for ${name}: add your use case to its request if there is one ` +
        `(${request.searchUrl}), or open one (${request.newIssueUrl}).`,
    ),
  ].join("\n");

  return {
    code: "preview-chain",
    action,
    message,
    supportedChains: supportedChains().map(summary),
    previewChains: requests,
  };
}

/** Throws {@link PreviewChainError} when any of `chains` is a preview chain. */
export function requireSupported(action: string, chains: readonly CanonicalChain[]): void {
  const refusal = previewRefusal(action, chains);
  if (refusal !== undefined) throw new PreviewChainError(refusal);
}

/** Every chain `intents` deliver to, and every chain an intent nested in one of their bodies does. */
export function intentChains(intents: readonly LoweredIntent[]): CanonicalChain[] {
  return intents.flatMap((intent) => [intent.destination, ...intentChains(intent.nested)]);
}
