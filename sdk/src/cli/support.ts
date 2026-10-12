/**
 * WHICH CHAINS THE `sauce` COMMAND AND ITS MCP SERVER BUILD TRANSACTIONS ON, and the gate that holds
 * them to it — the CLI's own policy, not the SDK's: the registry keeps every chain and protocol,
 * and the SDK's builders take any of them. Nothing outside `sdk/src/cli/` reads this module, and the
 * package exports none of it; the MCP server imports it from here (`mcp/src/sdk.ts`), and the
 * skills' generator and checker read the built module.
 *
 * For the initial release the command supports transactions on three chains: Ethereum, Base and
 * Solana ({@link SUPPORTED_CHAIN_SLUGS}). Every other canonical chain is a PREVIEW chain: a program
 * for it compiles, and the command simulates, rehearses and reads there, but builds no transaction
 * for it to sign and sends none.
 *
 * {@link requireSupported} is the gate, called from the command functions both front ends call
 * (`txCommand`, `runCommand`, `potDeployCommand`, `publishCommand`, `fillCommand`, the lifecycle's
 * `build*`) and, where a front end reaches a network or a key before those, from the front end
 * too. Anything that leaves a transaction ready to sign — the unsigned JSON included — or sends one
 * is refused on a preview chain: the cook (`tx`, `run`), a Pot's deployment, publishing intents,
 * and every lifecycle step. A cook or a publish is refused by its own chain and each destination of
 * the intents it opens ({@link intentDestinations}); each lifecycle step by the chain it is sent on.
 * Compiling, simulating, dry runs and reads are never refused.
 *
 * A developer who needs another chain asks for it with a GitHub issue on the repository, from the
 * issue form `.github/ISSUE_TEMPLATE/chain-support.yml`, or adds a use case to the request already
 * open for that chain. {@link chainSupportRequest} builds both links and the text to post; the
 * form's field ids are {@link CHAIN_SUPPORT_FIELDS}, which `test/cli-chain-support.test.ts` holds
 * to the form. The refusal carries them as a message for a person and as
 * {@link PreviewChainRefusal} for an agent: the MCP server returns that structure as the result.
 */
import {
  canonicalChains,
  chainBySlug,
  requireChain,
  type CanonicalChain,
  type ChainRef,
} from "../chains/canonical.js";
import type { CompiledBody } from "../routes/sauce-route.js";
import { CliError } from "./args.js";

/** `supported`: the release builds and sends transactions there. `preview`: compile and simulate. */
export type ChainSupport = "supported" | "preview";

/** The chains the release supports, by slug, in the order the docs name them. */
export const SUPPORTED_CHAIN_SLUGS = ["ethereum", "base", "solana"] as const;

const SUPPORTED = new Set<number>(
  SUPPORTED_CHAIN_SLUGS.map((slug) => {
    const chain = chainBySlug(slug);
    if (chain === undefined) throw new Error(`cli/support: '${slug}' is not a canonical chain`);

    return chain.id;
  }),
);

/** Whether the release supports `ref`'s chain (`supported`) or only previews it (`preview`).
 *  Throws for a chain the registry does not have. */
export function chainSupport(ref: ChainRef): ChainSupport {
  return SUPPORTED.has(requireChain(ref).id) ? "supported" : "preview";
}

/** `chainSupport(ref) === "supported"`; false for a chain the registry does not have. */
export function isSupportedChain(ref: ChainRef): boolean {
  try {
    return chainSupport(ref) === "supported";
  } catch {
    return false;
  }
}

/** The supported chains, in {@link SUPPORTED_CHAIN_SLUGS}' order. */
export function supportedChains(): CanonicalChain[] {
  return SUPPORTED_CHAIN_SLUGS.map((slug) => chainBySlug(slug)!);
}

/** Every other chain of the registry, id-ascending. */
export function previewChains(): CanonicalChain[] {
  return canonicalChains
    .filter((chain) => !SUPPORTED.has(chain.id))
    .slice()
    .sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------------------------
// Requesting a chain
// ---------------------------------------------------------------------------------------------

/** Where chain-support requests are filed. */
export const CHAIN_SUPPORT_REPOSITORY = "eco-incorp/sauce";
/** The label the issue form puts on every request, which the search for one filters on. */
export const CHAIN_SUPPORT_LABEL = "chain-support";
/** The issue form, under `.github/ISSUE_TEMPLATE/`. */
export const CHAIN_SUPPORT_TEMPLATE = "chain-support.yml";
/** What every request's title starts with. */
export const CHAIN_SUPPORT_TITLE_PREFIX = "Chain support: ";

/** The issue form's fields by id: the query parameters a new-issue URL prefills them with. */
export const CHAIN_SUPPORT_FIELDS = {
  chain: "chain",
  chainId: "chain-id",
  useCase: "use-case",
  protocols: "protocols",
  volume: "volume",
  contact: "contact",
} as const;

/** The form's labels for those fields, the headings an issue made from it carries. */
const FIELD_LABELS = {
  chain: "Chain",
  chainId: "Chain id",
  useCase: "What you want to run there",
  protocols: "Protocols and tokens",
  volume: "Expected volume and timing",
  contact: "Contact",
} as const;

const GITHUB = `https://github.com/${CHAIN_SUPPORT_REPOSITORY}`;

/** A new chain-support request with nothing filled in: the form alone. */
export const CHAIN_SUPPORT_NEW_ISSUE_URL = `${GITHUB}/issues/new?template=${CHAIN_SUPPORT_TEMPLATE}`;

/** Every chain-support request, open or closed. */
export const CHAIN_SUPPORT_ISSUES_URL = `${GITHUB}/issues?${new URLSearchParams({
  q: `is:issue label:${CHAIN_SUPPORT_LABEL}`,
})}`;

/** The chain a request is for: a registry chain, or one the registry does not have yet. */
export interface RequestedChain {
  readonly name: string;
  readonly id?: number;
}

/** What a request says beyond the chain, where the caller knows it. */
export interface ChainSupportDetails {
  /** What the requester wants to run on the chain. */
  readonly useCase?: string;
  /** Which protocols and tokens it needs. */
  readonly protocols?: string;
  /** The volume expected, and from when. */
  readonly volume?: string;
  /** How to reach the requester. */
  readonly contact?: string;
}

/** The links and the text to ask for a chain with. */
export interface ChainSupportRequest {
  readonly chain: { readonly name: string; readonly id?: number; readonly slug?: string };
  /** The issue's title: {@link CHAIN_SUPPORT_TITLE_PREFIX}, the chain's name and its id. */
  readonly title: string;
  /** The requests already filed for the chain, open or closed: add to one rather than repeat it. */
  readonly searchUrl: string;
  /** A new request from the issue form, its title and chain prefilled. */
  readonly newIssueUrl: string;
  /** The issue's body, as the form would write it, to post through GitHub's API or `gh`. */
  readonly body: string;
  /** A comment adding one more use case to an existing request. */
  readonly comment: string;
}

/** The chain a request names: a registry chain by its record, or one it does not have as given. */
function requested(chain: ChainRef | RequestedChain): ChainSupportRequest["chain"] {
  if (typeof chain === "object" && !("slug" in chain)) {
    return { name: chain.name, ...(chain.id === undefined ? {} : { id: chain.id }) };
  }
  const known = requireChain(chain);

  return { name: known.name, id: known.id, slug: known.slug };
}

/**
 * The request for `chain` — a registry chain (`ChainRef`), or `{ name, id }` for one it does not
 * have — with the `details` known so far filled in and the rest left as `<placeholders>`.
 */
export function chainSupportRequest(
  chain: ChainRef | RequestedChain,
  details: ChainSupportDetails = {},
): ChainSupportRequest {
  const named = requested(chain);
  const title = `${CHAIN_SUPPORT_TITLE_PREFIX}${named.name}${named.id === undefined ? "" : ` (${named.id})`}`;
  const values: Partial<Record<keyof typeof CHAIN_SUPPORT_FIELDS, string>> = {
    chain: named.name,
    ...(named.id === undefined ? {} : { chainId: String(named.id) }),
    ...details,
  };
  const prefilled = new URLSearchParams({ template: CHAIN_SUPPORT_TEMPLATE, title });
  for (const [key, id] of Object.entries(CHAIN_SUPPORT_FIELDS)) {
    const value = values[key as keyof typeof CHAIN_SUPPORT_FIELDS];
    if (value !== undefined && value !== "") prefilled.set(id, value);
  }
  // What the form leaves for the requester: GitHub writes `_No response_` for an empty field.
  const placeholder: Record<keyof typeof CHAIN_SUPPORT_FIELDS, string> = {
    chain: named.name,
    chainId: "<its chain id>",
    useCase: `<what you want to run on ${named.name}>`,
    protocols: "<the protocols and tokens it needs>",
    volume: "<the volume you expect, and from when>",
    contact: "_No response_",
  };
  const body = (Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>)
    .map((key) => `### ${FIELD_LABELS[key]}\n\n${values[key] ?? placeholder[key]}`)
    .join("\n\n");
  const comment = [
    `Another use case for ${named.name}${named.id === undefined ? "" : ` (${named.id})`}:`,
    "",
    `- ${FIELD_LABELS.useCase}: ${values.useCase ?? placeholder.useCase}`,
    `- ${FIELD_LABELS.protocols}: ${values.protocols ?? placeholder.protocols}`,
    `- ${FIELD_LABELS.volume}: ${values.volume ?? placeholder.volume}`,
  ].join("\n");

  return {
    chain: named,
    title,
    searchUrl: `${GITHUB}/issues?${new URLSearchParams({
      q: `is:issue label:${CHAIN_SUPPORT_LABEL} "${named.name}"`,
    })}`,
    newIssueUrl: `${GITHUB}/issues/new?${prefilled}`,
    body,
    comment,
  };
}

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

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

/**
 * The chain each intent a program opens delivers to — its body's: what a cook or a publish that
 * opens them is refused by, beside its own. An intent its body opens on the destination in turn (a
 * cascade) is not among them: a cascade's later levels are each sent on their own chain.
 */
export function intentDestinations(bodies: readonly CompiledBody[]): CanonicalChain[] {
  return bodies.filter((body) => body.path.length === 0).map((body) => body.destination);
}

/**
 * The chain each promise continuation a program compiles runs on: a request's `.then`, on the
 * program's own chain, and a remote message's program (`@sauce/remote`), on the chain it is sent
 * to, which a cook that sends it is refused by too, as one opening an intent there is.
 */
export function continuationChains(continuations: readonly CompiledBody[]): CanonicalChain[] {
  return continuations.filter((body) => body.path.length === 0).map((body) => body.destination);
}
