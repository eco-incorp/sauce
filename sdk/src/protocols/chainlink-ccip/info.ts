import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Chainlink CCIP",
  slug: "chainlink-ccip",
  description:
    "Cross-Chain Interoperability Protocol by Chainlink. Enterprise-grade cross-chain messaging with DON-based security and token transfers.",
  website: "https://chain.link/cross-chain",
  github: "https://github.com/smartcontractkit/ccip",
  npm: "@chainlink/contracts-ccip",
  category: "cross-chain",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
