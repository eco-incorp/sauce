import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Uniswap V4",
  slug: "uniswap-v4",
  description:
    "Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support.",
  website: "https://uniswap.org",
  github: "https://github.com/Uniswap/v4-core",
  npm: "@uniswap/v4-core",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
