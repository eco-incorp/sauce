import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Mantle mETH",
  slug: "mantle-meth",
  description:
    "Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, which accrues staking rewards over time.",
  website: "https://www.mantle.xyz/meth",
  github: "https://github.com/mantle-lsp",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$1.5B+",
};
