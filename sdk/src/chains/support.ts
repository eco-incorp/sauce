/**
 * WHICH CHAINS THE RELEASE SUPPORTS — the one list. The `sauce` command, the MCP server, and the
 * generators of the docs' and the agent skills' chain references all read it from here.
 *
 * For the initial release, Sauce supports transactions on three chains: Ethereum, Base and Solana.
 * Every other chain in the registry (`canonical.ts`) is a PREVIEW chain: a program for it compiles,
 * and the command and the MCP server simulate and rehearse it there, but they build no transaction
 * for it to sign and send none (`cli/support.ts` is that gate). The registry keeps every chain and
 * every protocol, and the SDK's TypeScript builders take any of them: this module gates nothing by
 * itself, it says which chain is which.
 *
 * A developer who needs another chain asks for it with a GitHub issue on the repository, from the
 * issue form `.github/ISSUE_TEMPLATE/chain-support.yml`, or adds a use case to the request already
 * open for that chain. {@link chainSupportRequest} builds both links and the text to post; the
 * form's field ids are {@link CHAIN_SUPPORT_FIELDS}, which `test/chains-support.test.ts` holds to
 * the form.
 *
 * Browser-safe: no Node import, no environment.
 */
import {
  canonicalChains,
  chainBySlug,
  requireChain,
  type CanonicalChain,
  type ChainRef,
} from "./canonical.js";

/** `supported`: the release builds and sends transactions there. `preview`: compile and simulate. */
export type ChainSupport = "supported" | "preview";

/** The chains the release supports, by slug, in the order the docs name them. */
export const SUPPORTED_CHAIN_SLUGS = ["ethereum", "base", "solana"] as const;

const SUPPORTED = new Set<number>(
  SUPPORTED_CHAIN_SLUGS.map((slug) => {
    const chain = chainBySlug(slug);
    if (chain === undefined) throw new Error(`chains/support: '${slug}' is not a canonical chain`);

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
