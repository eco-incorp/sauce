import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "UnitFlow V3",
  slug: "unitflow-v3",
  description:
    "Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.",
  website: "https://www.unitflow.finance",
  github: "https://github.com/UnitFlow-Finance/UnitFlowV3-contract",
  category: "dex",
  chains: deployments,
  audited: false,
};
