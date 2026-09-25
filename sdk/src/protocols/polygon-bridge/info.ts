import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Polygon Native Bridge",
  slug: "polygon-bridge",
  description:
    "Official Polygon PoS bridge via RootChainManager. Supports ETH, ERC-20, ERC-721, and ERC-1155 deposits with checkpoint-based withdrawals.",
  website: "https://portal.polygon.technology",
  github: "https://github.com/maticnetwork/pos-portal",
  category: "bridge",
  chains: deployments,
  audited: true,
};
