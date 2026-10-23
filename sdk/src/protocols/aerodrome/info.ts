import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aerodrome",
  slug: "aerodrome",
  description:
    "The central trading and liquidity marketplace on Base. Fork of Velodrome with ve(3,3) tokenomics.",
  website: "https://aerodrome.finance",
  github: "https://github.com/aerodrome-finance/contracts",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
