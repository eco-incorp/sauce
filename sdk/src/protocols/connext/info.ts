import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Connext (Everclear)",
  slug: "connext",
  description:
    "Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.",
  website: "https://everclear.org",
  github: "https://github.com/connext/monorepo",
  npm: "@connext/sdk",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
