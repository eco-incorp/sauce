import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Puffer Finance",
  slug: "puffer",
  description:
    "Liquid restaking protocol that issues pufETH. Deposits are natively restaked via EigenLayer for additional yield.",
  website: "https://www.puffer.fi",
  github: "https://github.com/PufferFinance",
  category: "restaking",
  chains: deployments,
  audited: true,
  tvl: "$62M+",
};
