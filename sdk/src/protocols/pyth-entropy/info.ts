import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Pyth Entropy",
  slug: "pyth-entropy",
  description:
    "Pyth's random number service, v2. A contract pays a fee for a request, and the Entropy contract calls it back with a random number once the provider reveals its commitment.",
  website: "https://docs.pyth.network/entropy",
  github: "https://github.com/pyth-network/pyth-crosschain",
  npm: "@pythnetwork/entropy-sdk-solidity",
  category: "oracle",
  chains: deployments,
  audited: true,
};
