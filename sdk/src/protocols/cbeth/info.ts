import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Coinbase Wrapped Staked ETH",
  slug: "cbeth",
  description:
    "Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards.",
  website: "https://www.coinbase.com/cbeth",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$2.5B+",
};
