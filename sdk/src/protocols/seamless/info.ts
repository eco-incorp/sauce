import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Seamless",
  slug: "seamless",
  description:
    "Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.",
  website: "https://seamlessprotocol.com",
  github: "https://github.com/seamless-protocol",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
