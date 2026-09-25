import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Kim",
  slug: "kim",
  description:
    "Mode-native DEX with UniV2-style constant product pools. The primary trading venue on Mode Network with farming incentives.",
  website: "https://kim.exchange",
  github: "https://github.com/nicejudy/kim-exchange-contract",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$10M+",
};
