import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "SyncSwap",
  slug: "syncswap",
  description:
    "DEX on zkSync Era. Supports classic constant product and stable pools with native account abstraction.",
  website: "https://syncswap.xyz",
  github: "https://github.com/syncswap",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
