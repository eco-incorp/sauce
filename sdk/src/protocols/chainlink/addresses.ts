import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Chainlink data feeds directory (reference-data-directory feeds-arc-mainnet.json,
    // "ETH / USD" proxy). getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): description() == "ETH / USD", decimals() == 8. No feed registry or
    // VRF coordinator is published for Arc.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      ethUsdFeed: "0x50FCDD99D6762D1C170DC6A9111db944AEE6D364",
    },
  },
  {
    // keystoneForwarder — Chainlink CRE's production KeystoneForwarder, the contract that delivers a
    // workflow's signed report to a receiver's `onReport(bytes,bytes)` (docs.chain.link/cre,
    // "Forwarder Directory", Production Forwarders, ethereum-mainnet). typeAndVersion() ==
    // "KeystoneForwarder 1.0.0", verified on-chain 2026-10-08 (Ethereum mainnet, block 26150899),
    // with thousands of ReportProcessed events in the 20,000 blocks before it.
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      ethUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      feedRegistry: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf",
      vrfV2Coordinator: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
      keystoneForwarder: "0x0b93082D9b3C7C97fAcd250082899BAcf3af3885",
    },
  },
  {
    // Base (8453) — Chainlink CRE's production KeystoneForwarder (docs.chain.link/cre, "Forwarder
    // Directory", Production Forwarders, ethereum-mainnet-base-1). typeAndVersion() ==
    // "KeystoneForwarder 1.0.0", verified on-chain 2026-10-08 (Base mainnet, block 52355993), with a
    // thousand ReportProcessed events in the 20,000 blocks before it.
    chainId: 8453,
    chainName: "Base",
    addresses: {
      keystoneForwarder: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482",
    },
  },
];
