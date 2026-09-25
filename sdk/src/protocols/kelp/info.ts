import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Kelp DAO",
  slug: "kelp",
  description:
    "Liquid restaking protocol built on EigenLayer. Deposit LSTs and receive rsETH, a liquid restaked token.",
  website: "https://kelpdao.xyz",
  github: "https://github.com/Kelp-DAO",
  category: "restaking",
  chains: deployments,
  audited: true,
  tvl: "$2B+",
};
