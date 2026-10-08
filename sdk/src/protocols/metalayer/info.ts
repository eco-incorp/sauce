import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Metalayer",
  slug: "metalayer",
  description:
    "Caldera's interchain messaging, built on Hyperlane: a router on each chain dispatches a message through its own Hyperlane mailbox to the router on the destination, which calls the recipient's handle with the message and the results of any cross-chain reads it asked for.",
  website: "https://docs.caldera.xyz/metalayer/overview",
  npm: "@metalayer/contracts",
  category: "cross-chain",
  chains: deployments,
  audited: false,
};
