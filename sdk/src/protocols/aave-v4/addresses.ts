import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Aave V4 (bgd-labs/aave-address-book src/ts/AaveV4Arc.ts: HUBS.CORE_HUB,
    // SPOKES.MAIN_SPOKE, SPOKES.FOREX_SPOKE). All three are EIP-1967 proxies. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436):
    // coreHub.isUnderlyingListed(USDC) == true, and each spoke's ORACLE() equals the address book's
    // MAIN_SPOKE_ORACLE / FOREX_SPOKE_ORACLE. The core hub's implementation code is byte-identical
    // to Ethereum's.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      coreHub: "0x17288dfc86205301064577b98B02b81017e6F79C",
      mainSpoke: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d",
      forexSpoke: "0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB",
    },
  },
];
