import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Silo",
  slug: "silo",
  description:
    "Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.",
  website: "https://silo.finance",
  github: "https://github.com/silo-finance/silo-core-v1",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
