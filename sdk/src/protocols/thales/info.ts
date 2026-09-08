import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Thales",
  slug: "thales",
  description:
    "Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.",
  website: "https://thalesmarket.io",
  github: "https://github.com/thales-markets",
  category: "options",
  chains: deployments,
  audited: true,
};
