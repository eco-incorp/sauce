import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Maker",
  slug: "maker",
  description:
    "Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.",
  website: "https://makerdao.com",
  github: "https://github.com/sky-ecosystem/dss",
  category: "cdp",
  chains: deployments,
  audited: true,
  tvl: "$8B+",
};
