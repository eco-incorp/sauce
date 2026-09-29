import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aerodrome Slipstream",
  slug: "aerodrome-slipstream",
  description:
    "Aerodrome's concentrated-liquidity (Uniswap V3-style) pools, keyed by tick spacing rather than fee. Live on Arc as Aero Lite.",
  website: "https://aero.xyz",
  github: "https://github.com/dromos-labs/metadex-public",
  category: "dex",
  chains: deployments,
  audited: true,
};
