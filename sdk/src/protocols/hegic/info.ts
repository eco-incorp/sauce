import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Hegic",
  slug: "hegic",
  description:
    "On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.",
  website: "https://hegic.co",
  github: "https://github.com/hegic",
  category: "options",
  chains: deployments,
  audited: true,
};
