import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Stader",
  slug: "stader",
  description:
    "Multi-chain liquid staking protocol. ETHx is Stader's liquid staking token for Ethereum.",
  website: "https://www.staderlabs.com",
  github: "https://github.com/stader-labs",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$300M+",
};
