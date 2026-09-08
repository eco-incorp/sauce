import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Liquity V2",
  slug: "liquity-v2",
  description:
    "Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.",
  website: "https://liquity.org",
  github: "https://github.com/liquity/bold",
  category: "cdp",
  chains: deployments,
  audited: true,
};
