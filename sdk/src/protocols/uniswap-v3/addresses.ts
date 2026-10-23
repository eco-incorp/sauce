import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Uniswap V3 (developers.uniswap.org/deployments.json, v3-*-arc). getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436):
    // factory.feeAmountTickSpacing(500) == 10; SwapRouter02, QuoterV2 and the position manager
    // each report factory() == factory. Only SwapRouter02 is deployed (no legacy SwapRouter).
    // The legacy Ethereum addresses (0x1F98…F984 etc.) carry UNRELATED code on Arc.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      factory: "0xf0db7b58379503491d857dB50AC9ece64c653918",
      swapRouter02: "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77",
      quoterV2: "0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468",
      nonfungiblePositionManager: "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377",
    },
  },
  {
    // Monad (143) — Uniswap V3 core/periphery v1.0.0, SwapRouter02 v1.1.0
    // (developers.uniswap.org/…/v3-monad-deployments). Every address getCode-verified
    // on-chain 2026-08-31 (rpc-mainnet.monadinfra.com). Only SwapRouter02 was deployed
    // (no legacy SwapRouter), matching Base's shape.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      factory: "0x204faca1764b154221e35c0d20abb3c525710498",
      swapRouter02: "0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900",
      quoterV2: "0x661e93cca42afacb172121ef892830ca3b70f08d",
      nonfungiblePositionManager: "0x7197e214c0b767cfb76fb734ab638e2c192f4e53",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    },
  },
  // QuoterV2 on every chain below, SwapRouter02 on Arbitrum, Optimism and Polygon, and the position
  // manager on BSC, Avalanche and Celo: Uniswap's deployment list (developers.uniswap.org/deployments.json,
  // generated 2026-10-16 from Uniswap/contracts@cd2e8a8, read 2026-10-22). Each verified on-chain
  // 2026-10-22: code at the address, factory() == the factory here, and WETH9() == the chain's wrapped
  // native (WETH; Polygon's WPOL; BSC's WBNB; Avalanche's WAVAX; zero on Celo, which has none).
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
      quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      nonfungiblePositionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      factory: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7",
      swapRouter02: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
      quoterV2: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
      nonfungiblePositionManager: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      factory: "0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD",
      swapRouter02: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE",
      quoterV2: "0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F",
      nonfungiblePositionManager: "0x655C406EBFa14EE2006250925e54ec43AD184f8B",
    },
  },
  {
    chainId: 42220,
    chainName: "Celo",
    addresses: {
      factory: "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc",
      swapRouter02: "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
      quoterV2: "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8",
      nonfungiblePositionManager: "0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A",
    },
  },
];
