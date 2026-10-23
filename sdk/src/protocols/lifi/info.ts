import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "LI.FI",
  slug: "lifi",
  description:
    "Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through bridges and DEXes for cross-chain swaps.",
  website: "https://li.fi",
  github: "https://github.com/lifinance/contracts",
  npm: "@lifi/sdk",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$300M+",
};
