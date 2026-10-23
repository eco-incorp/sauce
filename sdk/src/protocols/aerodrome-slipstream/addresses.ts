import type { ChainDeployment } from "../../core/types.js";

// Aerodrome's Slipstream (concentrated liquidity). The `aerodrome` module carries Aerodrome's
// basic-pool router and factory on Base, and `velodrome` Velodrome's on Optimism; neither carries a
// Slipstream contract, so nothing here duplicates them. Velodrome's own Slipstream deployments
// (Optimism and the Superchain) are not in this module.
export const deployments: ChainDeployment[] = [
  {
    // Base (8453) — aerodrome-finance/slipstream README, "Deployments". Three generations are live,
    // each its own CLFactory and position manager (pools do not move between them): the initial
    // deployment, "Gauge Caps", and "Gauges V3", which new gauges are deployed from. Verified
    // on-chain 2026-09-28 at block 51928697: allPoolsLength() 3646 / 2258 / 2248, each position
    // manager's factory() is its generation's CLFactory, tickSpacingToFee(100) == 500, and
    // Sourcify's verified ABIs match abis.ts. No Metarouter is deployed on Base.
    chainId: 8453,
    chainName: "Base",
    addresses: {
      clFactory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
      nonfungiblePositionManager: "0x827922686190790b37229fd06084350E74485b72",
      clFactoryGaugeCaps: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
      nonfungiblePositionManagerGaugeCaps: "0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F",
      clFactoryGaugesV3: "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
      nonfungiblePositionManagerGaugesV3: "0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53",
    },
  },
  {
    // Arc (5042) — Aero Lite, the Slipstream concentrated-liquidity DEX (aero.xyz "Aero Lite is Live
    // on Arc"; code dromos-labs/metadex-public). Aero publishes no address table, so each address is
    // established on-chain: all three are Sourcify-verified from that codebase; clFactory is the
    // factory() of the Aero CL pools KyberSwap's Arc routes API returns, and positionManager.factory()
    // == clFactory. getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436). No voter or gauges are deployed on Arc yet.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      clFactory: "0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03",
      nonfungiblePositionManager: "0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473",
      metarouter: "0x7275fA44c67bba8D921422e600b4Ed396209C886",
    },
  },
];
