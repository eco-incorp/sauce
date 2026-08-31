import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "CCTP",
  slug: "cctp",
  description:
    "Circle's Cross-Chain Transfer Protocol (v2) — permissionless native USDC bridging that burns on the source chain and mints on the destination domain, with configurable finality and fee.",
  website: "https://www.circle.com/cross-chain-transfer-protocol",
  github: "https://github.com/circlefin/evm-cctp-contracts",
  category: "bridge",
  chains: deployments,
  audited: true,
};
