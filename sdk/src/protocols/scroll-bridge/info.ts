import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Scroll Native Bridge",
  slug: "scroll-bridge",
  description:
    "Official Scroll zkEVM bridge via L1ScrollMessenger. Deposits ETH and ERC-20 tokens with ZK proof-based finality.",
  website: "https://scroll.io/bridge",
  github: "https://github.com/scroll-tech/scroll",
  category: "bridge",
  chains: deployments,
  audited: true,
};
