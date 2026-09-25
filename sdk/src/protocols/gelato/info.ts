import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Gelato Network",
  slug: "gelato",
  description:
    "Web3 automation network for scheduling and executing smart contract functions and off-chain computations.",
  website: "https://gelato.network",
  github: "https://github.com/gelatodigital",
  npm: "@gelatonetwork/automate-sdk",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
