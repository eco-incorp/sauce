import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "1inch",
  slug: "oneinch",
  description:
    "Leading DEX aggregator that finds optimal swap routes across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.",
  website: "https://1inch.io",
  github: "https://github.com/1inch",
  npm: "@1inch/fusion-sdk",
  category: "aggregator",
  chains: deployments,
  audited: true,
};
