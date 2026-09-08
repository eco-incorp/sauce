import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Level Finance",
  slug: "level-finance",
  description:
    "Decentralized perpetual exchange with risk-tranched liquidity pools and leveraged trading on BSC and Arbitrum.",
  website: "https://level.finance",
  github: "https://github.com/level-fi",
  category: "perpetuals",
  chains: deployments,
  audited: true,
};
