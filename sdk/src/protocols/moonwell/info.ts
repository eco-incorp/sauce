import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Moonwell",
  slug: "moonwell",
  description:
    "Lending protocol on Base. Compound V2 fork with governance and safety module features.",
  website: "https://moonwell.fi",
  github: "https://github.com/moonwell-fi/moonwell-contracts-v2",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
