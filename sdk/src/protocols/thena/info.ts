import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Thena",
  slug: "thena",
  description:
    "BSC-native liquidity layer with ve(3,3) tokenomics. Solidly-fork supporting both volatile and stable AMM pools with gauge voting.",
  website: "https://thena.fi",
  github: "https://github.com/ThenafiBNB",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
