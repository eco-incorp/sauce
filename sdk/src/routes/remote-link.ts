/**
 * A chain's bridges, as `@sauce/remote` sends and receives a message there: each bridge's contract on
 * the chain and the id the bridge names the chain by, from the registry (`protocols/hyperlane`,
 * `layerzero`, `metalayer`, `polymer`). A bridge the chain lacks, or whose id for it the registry does
 * not record, is left out, so a message never names a chain its bridge cannot address.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import type { ChainDeployment } from "../core/types.js";
import {
  deployments as hyperlaneDeployments,
  HYPERLANE_DOMAIN,
} from "../protocols/hyperlane/addresses.js";
import {
  deployments as layerzeroDeployments,
  LAYERZERO_EID,
} from "../protocols/layerzero/addresses.js";
import {
  deployments as metalayerDeployments,
  METALAYER_DOMAIN,
} from "../protocols/metalayer/addresses.js";
import { deployments as polymerDeployments } from "../protocols/polymer/addresses.js";

/** The bridges `@sauce/remote` takes, in the order a message takes the first two chains share. */
export const REMOTE_BRIDGES = ["hyperlane", "layerzero", "metalayer", "polymer"] as const;
export type RemoteBridge = (typeof REMOTE_BRIDGES)[number];

/** One chain as `@sauce/remote`'s `Link` holds it. */
export interface RemoteLink {
  readonly chainId: number;
  /** The chain's slug, which a refusal names. */
  readonly name: string;
  readonly hyperlane?: { readonly mailbox: `0x${string}`; readonly domain: number };
  readonly layerzero?: { readonly endpoint: `0x${string}`; readonly eid: number };
  readonly metalayer?: { readonly router: `0x${string}`; readonly domain: number };
  readonly polymer?: { readonly prover: `0x${string}` };
}

const addressOf = (
  deployments: readonly ChainDeployment[],
  chain: CanonicalChain,
  role: string,
): `0x${string}` | undefined =>
  deployments.find((d) => d.chainId === chain.id)?.addresses[role] as `0x${string}` | undefined;

/** `chain`'s bridges, or only its id where it has none. */
export function remoteLink(chain: CanonicalChain): RemoteLink {
  const mailbox = addressOf(hyperlaneDeployments, chain, "mailbox");
  const endpoint = addressOf(layerzeroDeployments, chain, "endpointV2");
  const router = addressOf(metalayerDeployments, chain, "router");
  const prover = addressOf(polymerDeployments, chain, "crossL2ProverV2");
  const hyperlaneDomain = HYPERLANE_DOMAIN[chain.slug];
  const eid = LAYERZERO_EID[chain.slug];
  const metalayerDomain = METALAYER_DOMAIN[chain.slug];

  return {
    chainId: chain.id,
    name: chain.slug,
    ...(mailbox !== undefined && hyperlaneDomain !== undefined
      ? { hyperlane: { mailbox, domain: hyperlaneDomain } }
      : {}),
    ...(endpoint !== undefined && eid !== undefined ? { layerzero: { endpoint, eid } } : {}),
    ...(router !== undefined && metalayerDomain !== undefined
      ? { metalayer: { router, domain: metalayerDomain } }
      : {}),
    ...(prover !== undefined ? { polymer: { prover } } : {}),
  };
}

/** `link` as the SauceScript `new Link({ … })` a chain's module writes: every bridge's key, unset
 *  (`undefined`) where the chain lacks it, since a program reads only the members a value sets. */
export function remoteLinkSource(link: RemoteLink): string {
  const word = (address: string): string => address.toLowerCase();
  const field = (name: string, value: string | undefined): string =>
    `${name}: ${value ?? "undefined"}`;

  return `new Link({ ${[
    `chainId: ${link.chainId}`,
    `name: ${JSON.stringify(link.name)}`,
    field(
      "hyperlane",
      link.hyperlane &&
        `{ mailbox: ${word(link.hyperlane.mailbox)}, domain: ${link.hyperlane.domain} }`,
    ),
    field(
      "layerzero",
      link.layerzero &&
        `{ endpoint: ${word(link.layerzero.endpoint)}, eid: ${link.layerzero.eid} }`,
    ),
    field(
      "metalayer",
      link.metalayer &&
        `{ router: ${word(link.metalayer.router)}, domain: ${link.metalayer.domain} }`,
    ),
    field("polymer", link.polymer && `{ prover: ${word(link.polymer.prover)} }`),
  ].join(", ")} })`;
}
