import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Spark",
  slug: "spark",
  description:
    "Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers competitive rates on DAI/USDS borrowing backed by the Maker protocol.",
  website: "https://spark.fi",
  github: "https://github.com/sparkdotfi/sparklend-deployments",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$5B+",
};
