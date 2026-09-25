import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "deBridge",
  slug: "debridge",
  description:
    "Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.",
  website: "https://debridge.finance",
  github: "https://github.com/debridge-finance/debridge-contracts-v1",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
