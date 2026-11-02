import type { ChainDeployment } from "../../core/types.js";

// `cometRewards` is the chain's CometRewards, which every market of the chain names as its `rewards`
// in compound-finance/comet deployments/<network>/<market>/roots.json; checked on chain 2026-11-02
// (`rewardConfig(comet)` answers COMP for each market).
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
      cWETHv3: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
      cUSDTv3: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
      cometRewards: "0x1B0e765F6224C21223AeA2af16c1C46E38885a40",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      cUSDCv3: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
      cUSDTv3: "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486",
      cometRewards: "0x88730d254A2f7e6AC8388c3198aFd694bA9f7fae",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      cUSDCv3: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
      cWETHv3: "0x46e6b214b524310239732D51387075E0e70970bf",
      cometRewards: "0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      cUSDCv3: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
      cometRewards: "0x45939657d1CA34A8FA39A924B71D28Fe8431e581",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      cUSDCv3: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
      cometRewards: "0x443EA0340cb75a160F31A440722dec7b5bc3C2E9",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      cUSDCv3: "0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44",
      cometRewards: "0x70167D30964cbFDc315ECAe02441Af747bE0c5Ee",
    },
  },
];
