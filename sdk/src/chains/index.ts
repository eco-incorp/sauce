import type { Chain, NativeErc20 } from "../core/types.js";
import type { CanonicalChain } from "./canonical.js";

export type { NativeErc20 } from "../core/types.js";

/** All supported EVM chains. No RPC endpoints: callers bring their own. */
export const chains: Record<number, Chain> = {
  // Tier 1
  1: {
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://etherscan.io"],
    testnet: false,
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://arbiscan.io"],
    testnet: false,
  },
  10: {
    id: 10,
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://optimistic.etherscan.io"],
    testnet: false,
  },
  8453: {
    id: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://basescan.org"],
    testnet: false,
  },
  137: {
    id: 137,
    name: "Polygon",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    blockExplorerUrls: ["https://polygonscan.com"],
    testnet: false,
  },
  56: {
    id: 56,
    name: "BNB Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://bscscan.com"],
    testnet: false,
  },
  43114: {
    id: 43114,
    name: "Avalanche C-Chain",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    blockExplorerUrls: ["https://snowtrace.io"],
    testnet: false,
  },
  // Tier 2
  324: {
    id: 324,
    name: "zkSync Era",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://explorer.zksync.io"],
    testnet: false,
  },
  59144: {
    id: 59144,
    name: "Linea",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://lineascan.build"],
    testnet: false,
  },
  534352: {
    id: 534352,
    name: "Scroll",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://scrollscan.com"],
    testnet: false,
  },
  5000: {
    id: 5000,
    name: "Mantle",
    nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
    blockExplorerUrls: ["https://explorer.mantle.xyz"],
    testnet: false,
  },
  81457: {
    id: 81457,
    name: "Blast",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://blastscan.io"],
    testnet: false,
  },
  34443: {
    id: 34443,
    name: "Mode",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://explorer.mode.network"],
    testnet: false,
  },
  100: {
    id: 100,
    name: "Gnosis",
    nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
    blockExplorerUrls: ["https://gnosisscan.io"],
    testnet: false,
  },
  250: {
    id: 250,
    name: "Fantom",
    nativeCurrency: { name: "FTM", symbol: "FTM", decimals: 18 },
    blockExplorerUrls: ["https://ftmscan.com"],
    testnet: false,
  },
  42220: {
    id: 42220,
    name: "Celo",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    blockExplorerUrls: ["https://celoscan.io"],
    testnet: false,
  },
  1284: {
    id: 1284,
    name: "Moonbeam",
    nativeCurrency: { name: "GLMR", symbol: "GLMR", decimals: 18 },
    blockExplorerUrls: ["https://moonbeam.moonscan.io"],
    testnet: false,
  },
  25: {
    id: 25,
    name: "Cronos",
    nativeCurrency: { name: "CRO", symbol: "CRO", decimals: 18 },
    blockExplorerUrls: ["https://cronoscan.com"],
    testnet: false,
  },
  1088: {
    id: 1088,
    name: "Metis",
    nativeCurrency: { name: "METIS", symbol: "METIS", decimals: 18 },
    blockExplorerUrls: ["https://andromeda-explorer.metis.io"],
    testnet: false,
  },
  288: {
    id: 288,
    name: "Boba",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://bobascan.com"],
    testnet: false,
  },
  // Tier 3
  1313161554: {
    id: 1313161554,
    name: "Aurora",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://aurorascan.dev"],
    testnet: false,
  },
  2222: {
    id: 2222,
    name: "Kava",
    nativeCurrency: { name: "KAVA", symbol: "KAVA", decimals: 18 },
    blockExplorerUrls: ["https://kavascan.com"],
    testnet: false,
  },
  8217: {
    id: 8217,
    name: "Klaytn",
    nativeCurrency: { name: "KLAY", symbol: "KLAY", decimals: 18 },
    blockExplorerUrls: ["https://scope.klaytn.com"],
    testnet: false,
  },
  122: {
    id: 122,
    name: "Fuse",
    nativeCurrency: { name: "FUSE", symbol: "FUSE", decimals: 18 },
    blockExplorerUrls: ["https://explorer.fuse.io"],
    testnet: false,
  },
  9001: {
    id: 9001,
    name: "Evmos",
    nativeCurrency: { name: "EVMOS", symbol: "EVMOS", decimals: 18 },
    blockExplorerUrls: ["https://escan.live"],
    testnet: false,
  },
  7000: {
    id: 7000,
    name: "ZetaChain",
    nativeCurrency: { name: "ZETA", symbol: "ZETA", decimals: 18 },
    blockExplorerUrls: ["https://zetachain.blockscout.com"],
    testnet: false,
  },
  169: {
    id: 169,
    name: "Manta Pacific",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://pacific-explorer.manta.network"],
    testnet: false,
  },
  204: {
    id: 204,
    name: "opBNB",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://opbnbscan.com"],
    testnet: false,
  },
  7777777: {
    id: 7777777,
    name: "Zora",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://explorer.zora.energy"],
    testnet: false,
  },
  369: {
    id: 369,
    name: "PulseChain",
    nativeCurrency: { name: "PLS", symbol: "PLS", decimals: 18 },
    blockExplorerUrls: ["https://scan.pulsechain.com"],
    testnet: false,
  },
  1116: {
    id: 1116,
    name: "Core",
    nativeCurrency: { name: "CORE", symbol: "CORE", decimals: 18 },
    blockExplorerUrls: ["https://scan.coredao.org"],
    testnet: false,
  },
  1329: {
    id: 1329,
    name: "Sei",
    nativeCurrency: { name: "SEI", symbol: "SEI", decimals: 18 },
    blockExplorerUrls: ["https://seitrace.com"],
    testnet: false,
  },
  80094: {
    id: 80094,
    name: "Berachain",
    nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
    blockExplorerUrls: ["https://berascan.com"],
    testnet: false,
  },
  // Arc — Circle's L1 (docs.arc.io/arc/references/rpc-endpoints). USDC is the native gas token,
  // and it has TWO decimal scales over ONE balance: the native balance (`eth_getBalance`,
  // `msg.value`, gas) is 18 decimals, while the ERC-20 interface at
  // 0x3600000000000000000000000000000000000000 is 6 decimals
  // (docs.arc.io/arc/concepts/stablecoin-native-model). `balanceOf` is the native value divided
  // by 1e12 and truncated: a native balance below 1e12 wei reads as 0 through the ERC-20.
  // Measured 2026-09-28 at block 23287436: eth_getBalance 19396491158961599350 for an account
  // whose balanceOf is 19396491. Gas cost in USDC ERC-20 units is gasUsed * gasPrice / 1e12.
  // There is no canonical wrapped native, measured 2026-09-28. The registry's `WETH` is bridged
  // ETH (Circle's CrossChainToken: no deposit()/withdraw(), a value send reverts). Uniswap's Arc
  // periphery reports a WETH9() that always reverts with UnsupportedProtocolError(), so every ETH
  // path through those routers reverts. The one WETH9-shaped contract is CCIP's fee token
  // CCIP_USDC (0x8DFa585699CB46ca2a5fA649700f09839B4b8743, the CCIP router's getWrappedNative()),
  // which nothing here registers or treats as Arc's wrapped native.
  5042: {
    id: 5042,
    name: "Arc",
    nativeCurrency: {
      name: "USDC",
      symbol: "USDC",
      decimals: 18,
      erc20: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
    },
    blockExplorerUrls: ["https://explorer.arc.io"],
    testnet: false,
  },
};

export function getChain(chainId: number): Chain | undefined {
  return chains[chainId];
}

/** The native coin of each canonical chain `chains` does not carry, by slug. */
const NATIVE_SYMBOLS: Readonly<Record<string, string>> = {
  unichain: "ETH",
  monad: "MON",
  sonic: "S",
  ronin: "RON",
  plasma: "XPL",
  ink: "ETH",
  solana: "SOL",
};

/**
 * The symbol of `chain`'s native coin — ETH, SOL, AVAX, … — as `chains` records it, or for a
 * canonical chain it does not carry, as the table above does. A program reads a holder's balance of
 * it as `<holder>.<symbol>` (`self.ETH`).
 */
export function nativeCoinSymbol(chain: CanonicalChain): string | undefined {
  return chains[chain.id]?.nativeCurrency.symbol ?? NATIVE_SYMBOLS[chain.slug];
}

export function getAllChainIds(): number[] {
  return Object.keys(chains).map(Number);
}

/**
 * The ERC-20 that IS `chainId`'s native coin, or `undefined` on a chain whose native coin is
 * separate from every token (ETH, POL, …). Where it is defined the chain has no canonical wrapped
 * native (nothing needs wrapping), and the native balance and the token balance are one balance on
 * two decimal scales — see {@link NativeErc20}.
 */
export function nativeErc20(chainId: number): NativeErc20 | undefined {
  return chains[chainId]?.nativeCurrency.erc20;
}

/**
 * Converts a native amount (wei) on `chainId` to its native ERC-20's units, rounding down the way
 * `balanceOf` reads it: on Arc, `floor(wei / 1e12)`, so any amount below 1e12 wei reads as 0.
 * Throws on a chain whose native coin is not an ERC-20.
 */
export function nativeToErc20Amount(chainId: number, wei: bigint): bigint {
  const erc20 = nativeErc20(chainId);
  const chain = chains[chainId];
  if (erc20 === undefined || chain === undefined) {
    throw new Error(
      `nativeToErc20Amount: chain ${chainId}'s native coin is not an ERC-20, so it has no token scale`,
    );
  }
  if (wei < 0n) throw new Error(`nativeToErc20Amount: negative amount ${wei}`);
  return wei / 10n ** BigInt(chain.nativeCurrency.decimals - erc20.decimals);
}

export * from "./canonical.js";
