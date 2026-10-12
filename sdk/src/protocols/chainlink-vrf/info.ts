import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Chainlink VRF",
  slug: "chainlink-vrf",
  description:
    "Chainlink's verifiable random function, v2.5. Direct funding: a contract pays each request in the native coin through the VRFV2PlusWrapper, with no subscription, and the wrapper calls it back with the random words.",
  website: "https://docs.chain.link/vrf",
  github: "https://github.com/smartcontractkit/chainlink-evm",
  npm: "@chainlink/contracts",
  category: "oracle",
  chains: deployments,
  audited: true,
};
