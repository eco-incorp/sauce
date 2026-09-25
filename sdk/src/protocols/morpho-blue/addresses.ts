import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Monad (143) — Morpho Blue. morpho getCode-verified on-chain 2026-08-31. NOTE: Monad's
    // singleton is NOT the usual cross-chain vanity 0xBBBB…FFCb — it is a distinct
    // 0xD5D960E8…, per docs.morpho.org's Monad row (independently re-confirmed). bundler3 is
    // omitted (not registered for Monad yet) — a hole, exactly like a chain that lacks a role.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      morpho: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      bundler3: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    },
  },
];
