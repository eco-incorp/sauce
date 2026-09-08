import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Opyn",
  slug: "opyn",
  description:
    "DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.",
  website: "https://opyn.co",
  github: "https://github.com/opynfinance",
  category: "options",
  chains: deployments,
  audited: true,
};
