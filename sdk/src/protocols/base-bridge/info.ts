import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Base Native Bridge",
  slug: "base-bridge",
  description:
    "Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base (OP Stack). 7-day withdrawal finality.",
  website: "https://bridge.base.org",
  github: "https://github.com/base/contracts",
  category: "bridge",
  chains: deployments,
  audited: true,
};
