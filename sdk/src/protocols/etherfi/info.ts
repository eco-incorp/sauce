import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ether.fi",
  slug: "etherfi",
  description:
    "Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH, or wrap it as weETH for DeFi composability.",
  website: "https://www.ether.fi",
  github: "https://github.com/etherfi-protocol",
  category: "restaking",
  chains: deployments,
  audited: true,
  tvl: "$5.8B+",
};
