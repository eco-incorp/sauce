import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Instadapp",
  slug: "instadapp",
  description:
    "Flash loan aggregator that routes across Aave, Maker, Balancer and other sources to find the cheapest flash loan.",
  website: "https://instadapp.io",
  github: "https://github.com/Instadapp/flashloan-aggregator",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
