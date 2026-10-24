import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Benqi",
  slug: "benqi",
  description:
    "Lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.",
  website: "https://benqi.fi",
  github: "https://github.com/Benqi-fi",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
