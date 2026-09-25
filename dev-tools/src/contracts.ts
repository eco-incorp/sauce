/**
 * Multi-chain contract address registry
 *
 * Common contract addresses organized by chain ID.
 * Used by scripts and examples for convenient address lookup.
 */

export const contracts = {
  // Base (8453)
  8453: {
    tokens: {
      WETH: "0x4200000000000000000000000000000000000006",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    },
    amm: {
      uni: {
        v3: {
          factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
          swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
          quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        },
      },
    },
  },
  // Arbitrum (42161)
  42161: {
    tokens: {
      WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    },
    amm: {
      uni: {
        v3: {
          factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
          quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        },
      },
    },
  },
  // BNB Chain (56)
  56: {
    tokens: {
      WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      USDT: "0x55d398326f99059fF775485246999027B3197955",
    },
    amm: {
      pancake: {
        v3: {
          factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
          swapRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
        },
      },
    },
  },
} as const;
