import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Maverick",
  slug: "maverick",
  description:
    "Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies.",
  website: "https://mav.xyz",
  github: "https://github.com/maverickprotocol",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
