import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Premia",
  slug: "premia",
  description:
    "Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.",
  website: "https://premia.blue",
  github: "https://github.com/Premian-Labs",
  category: "options",
  chains: deployments,
  audited: true,
};
