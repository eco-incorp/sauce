import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — metadata.layerzero-api.com deployments, arc-mainnet v2 (eid 30417). Not the
    // 0x1a44…728c address older chains share. getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): eid() == 30417.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      endpointV2: "0x6F475642a6e85809B1c36Fa62763669b1b48DD5B",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 324,
    chainName: "zkSync",
    addresses: {
      // zkSync Era has its own EndpointV2 (eid() = 30165); the address listed before had no code.
      endpointV2: "0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF",
    },
  },
  {
    chainId: 59144,
    chainName: "Linea",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    },
  },
];

/**
 * LayerZero V2 ENDPOINT ids (the `dstEid` of `send`, and the `srcEid` a receiver's `lzReceive` is
 * given) — not chain ids — keyed by canonical chain slug. Each is the endpoint's own `eid()`, read
 * on-chain 2026-10-08.
 */
export const LAYERZERO_EID: Readonly<Record<string, number>> = {
  arc: 30417,
  ethereum: 30101,
  arbitrum: 30110,
  optimism: 30111,
  base: 30184,
  polygon: 30109,
  bsc: 30102,
  avalanche: 30106,
  zksync: 30165,
  linea: 30183,
  scroll: 30214,
};
