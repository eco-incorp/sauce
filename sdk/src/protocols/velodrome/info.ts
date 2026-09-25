import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Velodrome",
  slug: "velodrome",
  description:
    "The central trading and liquidity marketplace on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable and volatile pools.",
  website: "https://velodrome.finance",
  github: "https://github.com/velodrome-finance/contracts",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$300M+",
};
