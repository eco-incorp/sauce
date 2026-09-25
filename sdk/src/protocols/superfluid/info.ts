import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Superfluid",
  slug: "superfluid",
  description:
    "Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.",
  website: "https://superfluid.finance",
  github: "https://github.com/superfluid-finance",
  npm: "@superfluid-finance/sdk-core",
  category: "payments",
  chains: deployments,
  audited: true,
};
