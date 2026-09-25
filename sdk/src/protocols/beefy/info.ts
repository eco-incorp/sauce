import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Beefy Finance",
  slug: "beefy",
  description:
    "Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.",
  website: "https://beefy.com",
  github: "https://github.com/beefyfinance",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$300M+",
};
