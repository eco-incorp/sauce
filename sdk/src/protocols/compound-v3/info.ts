import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Compound V3",
  slug: "compound-v3",
  description:
    "Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.",
  website: "https://compound.finance",
  github: "https://github.com/compound-finance/comet",
  npm: "@compound-finance/comet",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$3.5B+",
};
