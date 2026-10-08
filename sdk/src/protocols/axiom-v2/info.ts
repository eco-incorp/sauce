import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Axiom V2",
  slug: "axiom-v2",
  description:
    "ZK coprocessor over a chain's history: a query reads block headers, accounts, storage, transactions and receipts, a compute circuit proves a result over them, and AxiomV2Query calls the requester back with the proven results. Axiom ended support for V2 on December 21, 2024: the contracts remain deployed and unfrozen, but no prover has fulfilled a query since.",
  website: "https://www.axiom.xyz",
  github: "https://github.com/axiom-crypto/axiom-v2-contracts",
  npm: "@axiom-crypto/client",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
