import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Frax Ether",
  slug: "frax-ether",
  description:
    "Frax Finance's liquid staking derivative. sfrxETH is the staking vault token that accrues ETH staking yield.",
  website: "https://frax.finance",
  github: "https://github.com/FraxFinance",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$700M+",
};
