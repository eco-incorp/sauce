import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "LayerBank",
  slug: "layerbank",
  description:
    "Leading lending protocol on Scroll. Compound V2 fork optimized for L2 rollups with low gas costs.",
  website: "https://layerbank.finance",
  github: "https://github.com/layerbank",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
