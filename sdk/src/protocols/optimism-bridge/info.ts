import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Optimism Native Bridge",
  slug: "optimism-bridge",
  description:
    "Official Optimism L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Optimism with 7-day withdrawal finality.",
  website: "https://app.optimism.io/bridge",
  github: "https://github.com/ethereum-optimism/optimism",
  category: "bridge",
  chains: deployments,
  audited: true,
};
