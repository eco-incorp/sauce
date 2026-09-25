import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aave V3",
  slug: "aave-v3",
  description:
    "Non-custodial liquidity protocol for earning interest on deposits and borrowing assets. The most widely deployed lending protocol in DeFi.",
  website: "https://aave.com",
  github: "https://github.com/aave/aave-v3-core",
  npm: "@aave/core-v3",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$40B+",
};
