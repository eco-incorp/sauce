import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Yearn V3",
  slug: "yearn-v3",
  description:
    "Yield aggregator protocol. V3 vaults follow ERC-4626 standard for automated yield optimization strategies.",
  website: "https://yearn.fi",
  github: "https://github.com/yearn/yearn-vaults-v3",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
