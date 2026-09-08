import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Alchemix",
  slug: "alchemix",
  description:
    "Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.",
  website: "https://alchemix.fi",
  github: "https://github.com/alchemix-finance/v2-foundry",
  category: "cdp",
  chains: deployments,
  audited: true,
};
