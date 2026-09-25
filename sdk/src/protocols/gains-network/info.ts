import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Gains Network",
  slug: "gains-network",
  description:
    "Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex.",
  website: "https://gains.trade",
  github: "https://github.com/GainsNetwork",
  category: "perpetuals",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
