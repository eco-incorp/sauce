import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Ethena",
  slug: "ethena",
  description:
    "Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.",
  website: "https://ethena.fi",
  github: "https://github.com/ethena-labs",
  category: "cdp",
  chains: deployments,
  audited: true,
  tvl: "$3B+",
};
