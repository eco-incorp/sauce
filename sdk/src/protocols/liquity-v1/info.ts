import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Liquity V1",
  slug: "liquity-v1",
  description:
    "Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with a minimum 110% collateral ratio.",
  website: "https://liquity.org",
  github: "https://github.com/liquity/dev",
  category: "cdp",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
