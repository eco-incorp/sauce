import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — deBridge DLN's cross-chain addresses; dln.debridge.finance/v1.0/
    // supported-chains-info lists chain 5042. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): both report deBridgeGate() == the canonical
    // DeBridgeGate 0x43dE2d77BF8027e25dBD179B491e8d64f38398aA.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      dlnSource: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
      dlnDestination: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    },
  },
];
