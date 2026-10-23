import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Lido",
  slug: "lido",
  description:
    "Liquid staking protocol for Ethereum. Stake ETH and receive stETH, a liquid staking token that accrues staking rewards.",
  website: "https://lido.fi",
  github: "https://github.com/lidofinance",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$27.5B+",
};
