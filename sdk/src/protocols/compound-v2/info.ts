import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Compound V2",
  slug: "compound-v2",
  description:
    "Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.",
  website: "https://compound.finance",
  github: "https://github.com/compound-finance/compound-protocol",
  npm: "@compound-finance/compound-js",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
