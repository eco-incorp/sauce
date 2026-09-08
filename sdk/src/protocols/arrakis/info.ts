import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Arrakis Finance",
  slug: "arrakis",
  description:
    "Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions.",
  website: "https://www.arrakis.finance",
  github: "https://github.com/ArrakisFinance",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
