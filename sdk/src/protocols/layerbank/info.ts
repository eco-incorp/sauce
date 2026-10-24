import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "LayerBank",
  slug: "layerbank",
  description: "Lending protocol on Scroll. Compound V2 fork adapted for L2 rollups.",
  website: "https://layerbank.finance",
  github: "https://github.com/layerbank",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
