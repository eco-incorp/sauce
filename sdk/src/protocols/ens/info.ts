import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ENS",
  slug: "ens",
  description:
    "Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.",
  website: "https://ens.domains",
  github: "https://github.com/ensdomains",
  npm: "@ensdomains/ensjs",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
