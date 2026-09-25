import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Hop Protocol",
  slug: "hop",
  description:
    "Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.",
  website: "https://hop.exchange",
  github: "https://github.com/hop-protocol/hop",
  npm: "@hop-protocol/sdk",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
