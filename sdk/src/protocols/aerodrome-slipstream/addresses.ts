import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Aero Lite, the Slipstream concentrated-liquidity DEX (aero.xyz "Aero Lite is Live
    // on Arc"; code dromos-labs/metadex-public). Aero publishes no address table, so each address is
    // established on-chain: all three are Sourcify-verified from that codebase; clFactory is the
    // factory() of the Aero CL pools KyberSwap's Arc routes API returns, and positionManager.factory()
    // == clFactory. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436). No voter or gauges are deployed on Arc yet.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      clFactory: "0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03",
      nonfungiblePositionManager: "0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473",
      metarouter: "0x7275FA44c67BbA8d921422e600B4ed396209c886",
    },
  },
];
