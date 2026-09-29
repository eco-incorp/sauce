import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Morpho Blue (docs.morpho.org/get-started/resources/addresses, Arc). Like Monad,
    // NOT the cross-chain 0xBBBB…FFCb vanity address. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): isIrmEnabled(AdaptiveCurveIrm
    // 0xF02615d094Fc02fC031C35fe705e175aA4653f20) == true. bundler3 is not registered for Arc.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      morpho: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD",
    },
  },
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
