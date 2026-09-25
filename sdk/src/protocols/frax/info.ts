import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Frax Finance",
  slug: "frax",
  description:
    "Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.",
  website: "https://frax.finance",
  github: "https://github.com/FraxFinance",
  category: "cdp",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
