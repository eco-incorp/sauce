import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Safe",
  slug: "safe",
  description:
    "The most trusted multi-signature smart contract wallet, securing billions in digital assets. Supports programmable account abstraction and modular security.",
  website: "https://safe.global",
  github: "https://github.com/safe-global",
  npm: "@safe-global/safe-deployments",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
