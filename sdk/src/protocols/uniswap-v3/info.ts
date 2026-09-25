import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Uniswap V3",
  slug: "uniswap-v3",
  description:
    "Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency.",
  website: "https://uniswap.org",
  github: "https://github.com/Uniswap/v3-core",
  npm: "@uniswap/v3-core",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$3B+",
};
