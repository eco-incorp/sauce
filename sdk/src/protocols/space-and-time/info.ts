import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Space and Time",
  slug: "space-and-time",
  description:
    "ZK-proven SQL over indexed chain data: a contract asks the QueryRouter a query, pays in SXT, and Space and Time's fulfiller answers it with a Proof of SQL that the router verifies against table commitments Space and Time's validators sign, then calls the requester back with the result through the CallbackExecutor.",
  website: "https://www.spaceandtime.io",
  github: "https://github.com/spaceandtimefdn/sxt-chain-examples",
  category: "oracle",
  chains: deployments,
  audited: true,
};
