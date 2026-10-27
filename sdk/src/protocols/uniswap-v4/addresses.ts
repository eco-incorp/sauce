import type { ChainDeployment } from "../../core/types.js";

// `stateView` is v4-periphery's StateView lens over each chain's PoolManager, from
// developers.uniswap.org/docs/protocols/v4/deployments. Every one was probed on 2026-09-30 over a
// public RPC: code at the address, and `StateView.poolManager()` equal to that chain's `poolManager`
// here. Blast is no longer on that page; its StateView passed the same probe.
export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Uniswap V4 (developers.uniswap.org/docs/protocols/v4/deployments, "Arc: 5042").
    // getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): positionManager.poolManager() and universalRouter.poolManager() == poolManager.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      universalRouter: "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1",
      positionManager: "0x6049c9a0e26405C0985f9E3685C87d0aE917f82B",
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    },
  },
  {
    // Monad (143) — Uniswap V4 (developers.uniswap.org/…/v4/deployments). Every address
    // getCode-verified on-chain 2026-08-31 (rpc-mainnet.monadinfra.com). universalRouter
    // is shared with the V3 deployment (same 0x0d97dc… on this chain).
    chainId: 143,
    chainName: "Monad",
    addresses: {
      poolManager: "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e",
      universalRouter: "0x0D97Dc33264bfC1c226207428A79b26757fb9dc3",
      positionManager: "0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016",
      stateView: "0x77395F3b2E73aE90843717371294fa97cC419D64",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      universalRouter: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      positionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
      stateView: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
      universalRouter: "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3",
      positionManager: "0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869",
      stateView: "0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
      universalRouter: "0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507",
      positionManager: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",
      stateView: "0xc18a3169788F4F75A170290584ECA6395C75Ecdb",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
      universalRouter: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
      positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
      stateView: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      poolManager: "0x67366782805870060151383F4BbFF9daB53e5cD6",
      universalRouter: "0x1095692A6237d83C6a72F3F5eFEdb9A670C49223",
      positionManager: "0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9",
      stateView: "0x5eA1bD7974c8A611cBAB0bDCAFcB1D9CC9b3BA5a",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      poolManager: "0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF",
      universalRouter: "0x1906c1d672b88cD1B9aC7593301cA990F94Eae07",
      positionManager: "0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b",
      stateView: "0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      poolManager: "0x06380C0e0912312B5150364B9DC4542BA0DbBc85",
      universalRouter: "0x94b75331AE8d42C1b61065089B7d48FE14aA73b7",
      positionManager: "0xB74b1F14d2754AcfcbBe1a221023a5cf50Ab8ACD",
      stateView: "0xc3c9e198C735a4b97e3e683f391cCBDD60B69286",
    },
  },
  {
    chainId: 81457,
    chainName: "Blast",
    addresses: {
      poolManager: "0x1631559198A9e474033433b2958daBC135ab6446",
      stateView: "0x12a88AE16F46DCe4e8B15368008Ab3380885df30",
    },
  },
  {
    // Unichain (130), Zora (7777777), Ink (57073) and Celo (42220): V4's PoolManager and StateView,
    // from developers.uniswap.org/docs/protocols/v4/deployments. Probed 2026-09-30 over public RPCs:
    // code at both, and StateView.poolManager() == poolManager on each chain. The routers on these
    // chains are not registered.
    chainId: 130,
    chainName: "Unichain",
    addresses: {
      poolManager: "0x1F98400000000000000000000000000000000004",
      stateView: "0x86e8631A016F9068C3f085fAF484Ee3F5fDee8f2",
    },
  },
  {
    chainId: 7777777,
    chainName: "Zora",
    addresses: {
      poolManager: "0x0575338e4C17006aE181B47900A84404247CA30f",
      stateView: "0x385785Af07d63b50d0a0ea57C4FF89D06adf7328",
    },
  },
  {
    chainId: 57073,
    chainName: "Ink",
    addresses: {
      poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
      stateView: "0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990",
    },
  },
  {
    chainId: 42220,
    chainName: "Celo",
    addresses: {
      poolManager: "0x288dc841A52FCA2707c6947B3A777c5E56cd87BC",
      stateView: "0xbc21f8720BABf4b20d195eE5C6e99c52b76F2bfb",
    },
  },
  // Ethereum Sepolia (11155111) and Base Sepolia (84532) — developers.uniswap.org/docs/protocols/v4/
  // deployments ("Sepolia: 11155111", "Base Sepolia: 84532"; also developers.uniswap.org/
  // deployments.json). Verified on-chain 2026-10-27: code at each address, and poolManager() ==
  // poolManager on the position manager, the Universal Router and StateView. universalRouter is the
  // page's "Universal Router 2.1.2" on both chains. Uniswap documents no V4 on Arc Testnet.
  {
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    addresses: {
      poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
      universalRouter: "0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3",
      positionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
      stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
    },
  },
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    addresses: {
      poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
      universalRouter: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650",
      positionManager: "0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80",
      stateView: "0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4",
    },
  },
];
