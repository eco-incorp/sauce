import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Chainlink",
  slug: "chainlink",
  description:
    "Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).",
  website: "https://chain.link",
  github: "https://github.com/smartcontractkit/chainlink",
  npm: "@chainlink/contracts",
  category: "oracle",
  chains: deployments,
  audited: true,
};
