import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Rocket Pool",
  slug: "rocket-pool",
  description:
    "Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a liquid staking token backed by node operators.",
  website: "https://rocketpool.net",
  github: "https://github.com/rocket-pool",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$3B+",
};
