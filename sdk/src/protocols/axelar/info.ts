import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Axelar",
  slug: "axelar",
  description:
    "Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).",
  website: "https://axelar.network",
  github: "https://github.com/axelarnetwork/axelar-gmp-sdk-solidity",
  npm: "@axelar-network/axelar-gmp-sdk-solidity",
  category: "cross-chain",
  chains: deployments,
  audited: true,
  tvl: "$800M+",
};
