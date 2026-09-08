import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "GMX V1",
  slug: "gmx-v1",
  description:
    "Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading with low swap fees and zero price impact trades.",
  website: "https://gmx.io",
  github: "https://github.com/gmx-io/gmx-contracts",
  category: "perpetuals",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
