import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Sommelier",
  slug: "sommelier",
  description:
    "ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.",
  website: "https://sommelier.finance",
  github: "https://github.com/PeggyJV/cellar-contracts",
  category: "yield",
  chains: deployments,
  audited: true,
};
