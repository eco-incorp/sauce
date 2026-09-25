import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Trader Joe",
  slug: "trader-joe",
  description:
    "Liquidity Book DEX with variable-width bins for concentrated liquidity. Native to Avalanche with expansion to Arbitrum and BSC.",
  website: "https://lfj.gg",
  github: "https://github.com/lfj-gg/joe-v2",
  npm: "@traderjoe-xyz/joe-v2",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$150M+",
};
