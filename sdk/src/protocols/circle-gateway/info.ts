import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Circle Gateway",
  slug: "circle-gateway",
  description:
    "Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another through the GatewayMinter with a Circle-signed attestation.",
  website: "https://developers.circle.com/gateway",
  github: "https://github.com/circlefin/evm-gateway-contracts",
  category: "cross-chain",
  chains: deployments,
  audited: false,
};
