import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Venus",
  slug: "venus",
  description:
    "Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.",
  website: "https://venus.io",
  github: "https://github.com/VenusProtocol/venus-protocol",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$3B+",
};
