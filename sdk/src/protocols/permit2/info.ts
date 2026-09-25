import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Permit2",
  slug: "permit2",
  description:
    "Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols, improving security and UX.",
  website: "https://uniswap.org",
  github: "https://github.com/Uniswap/permit2",
  npm: "@uniswap/permit2-sdk",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
