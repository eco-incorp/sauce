import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "LayerZero",
  slug: "layerzero",
  description:
    "Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.",
  website: "https://layerzero.network",
  github: "https://github.com/LayerZero-Labs/LayerZero-v2",
  npm: "@layerzerolabs/lz-evm-sdk-v2",
  category: "cross-chain",
  chains: deployments,
  audited: true,
  tvl: "$5B+",
};
