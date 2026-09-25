import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Fluid",
  slug: "fluid",
  description:
    "Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.",
  website: "https://fluid.instadapp.io",
  github: "https://github.com/Instadapp/fluid-contracts-public",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
