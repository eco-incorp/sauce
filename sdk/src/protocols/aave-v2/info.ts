import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aave V2",
  slug: "aave-v2",
  description:
    "Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.",
  website: "https://aave.com",
  github: "https://github.com/aave/protocol-v2",
  npm: "@aave/protocol-v2",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$2B+",
};
