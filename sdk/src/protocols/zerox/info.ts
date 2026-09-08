import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "0x Protocol",
  slug: "zerox",
  description:
    "DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.",
  website: "https://0x.org",
  github: "https://github.com/0xProject",
  npm: "@0x/contract-addresses",
  category: "aggregator",
  chains: deployments,
  audited: true,
};
