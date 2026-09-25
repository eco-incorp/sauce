import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "EigenLayer",
  slug: "eigenlayer",
  description:
    "Restaking protocol that enables staked ETH to secure additional protocols. Deposit LSTs into strategies to earn restaking rewards.",
  website: "https://www.eigenlayer.xyz",
  github: "https://github.com/Layr-Labs",
  category: "restaking",
  chains: deployments,
  audited: true,
  tvl: "$13B+",
};
