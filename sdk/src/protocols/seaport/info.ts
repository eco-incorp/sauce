import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Seaport",
  slug: "seaport",
  description:
    "OpenSea's decentralized NFT marketplace protocol supporting flexible order types including English and Dutch auctions, collection offers, and trait-based offers.",
  website: "https://opensea.io",
  github: "https://github.com/ProjectOpenSea/seaport",
  npm: "@opensea/seaport-js",
  category: "nft-marketplace",
  chains: deployments,
  audited: true,
};
