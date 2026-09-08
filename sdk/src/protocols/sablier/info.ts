import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Sablier",
  slug: "sablier",
  description:
    "Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.",
  website: "https://sablier.com",
  github: "https://github.com/sablier-labs",
  npm: "@sablier/sdk",
  category: "payments",
  chains: deployments,
  audited: true,
};
