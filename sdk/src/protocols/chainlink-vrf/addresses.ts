import type { ChainDeployment } from "../../core/types.js";

// VRF v2.5's direct-funding contracts, from Chainlink's supported-networks page
// (docs.chain.link/vrf/v2-5/supported-networks). Each wrapper's `s_vrfCoordinator()` is the
// coordinator beside it and its `typeAndVersion()` is "VRFV2PlusWrapper 1.0.0"; neither contract is
// a proxy (both EIP-1967 slots are zero). getCode + view-call verified on-chain 2026-10-08.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      wrapper: "0x02aae1A04f9828517b3007f83f6181900CaD910c",
      coordinator: "0xD7f86b4b8Cae7D942340FF628F82735b7a20893a",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      wrapper: "0xb0407dbe851f8318bd31404A49e658143C982F23",
      coordinator: "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634",
    },
  },
];
