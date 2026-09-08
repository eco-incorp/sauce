import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Morpho Blue",
  slug: "morpho-blue",
  description:
    "Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loan token, collateral token, oracle, IRM, LLTV) tuple.",
  website: "https://morpho.org",
  github: "https://github.com/morpho-org/morpho-blue",
  npm: "@morpho-org/morpho-blue",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$6B+",
};
