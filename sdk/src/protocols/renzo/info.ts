import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Renzo",
  slug: "renzo",
  description:
    "Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a liquid restaked token.",
  website: "https://www.renzoprotocol.com",
  github: "https://github.com/Renzo-Protocol",
  category: "restaking",
  chains: deployments,
  audited: true,
  tvl: "$389M+",
};
