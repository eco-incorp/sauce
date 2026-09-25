import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Squid Router",
  slug: "squid",
  description:
    "Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.",
  website: "https://squidrouter.com",
  github: "https://github.com/0xsquid/squid-sdk",
  npm: "@0xsquid/sdk",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
