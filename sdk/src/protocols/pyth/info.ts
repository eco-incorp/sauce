import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Pyth Network",
  slug: "pyth",
  description:
    "High-fidelity oracle network providing low-latency price feeds from institutional sources. Uses pull-based model for efficient on-chain price updates.",
  website: "https://pyth.network",
  github: "https://github.com/pyth-network",
  npm: "@pythnetwork/pyth-evm-js",
  category: "oracle",
  chains: deployments,
  audited: true,
};
