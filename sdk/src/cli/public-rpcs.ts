/**
 * THE PUBLIC RPC ENDPOINTS THE `sauce` COMMAND AND ITS MCP SERVER READ A CHAIN THROUGH when they
 * are given none of their own — so neither needs any configuration to run. Precedence: `--rpc-url`
 * (a tool call's `rpcUrl`), then the `--config` file's entry for the chain, then this list
 * (`public-endpoints.ts` reaches it, falling back from one endpoint to the next).
 *
 * The ONE module that holds RPC URLs (`test/no-embedded-rpc.test.ts` allows exactly this file).
 * Nothing outside `sdk/src/cli/` imports it and the package exports none of it, so it never
 * reaches a browser: the SDK itself still ships no endpoint and takes every URL from its caller.
 *
 * Every endpoint is keyless and public. Each was checked live when this list was written: that
 * `eth_chainId` answers the chain's id (Solana: `getGenesisHash` answers mainnet's, `getSlot` a
 * slot, and the USDC mint reads), that `eth_call` honors a state override of code and storage (a
 * simulation's fallback depends on it: an endpoint that ignores one is left out), and whether
 * `eth_simulateV1` runs with `validation: false` and `traceTransfers`, as `sauce simulate` sends it
 * (`simulateV1`: true only where it ran every time; 1rpc's answer varied from one check to the
 * next). An endpoint that failed a check is not here, and neither are Kava, ZetaChain and Evmos: no
 * keyless endpoint of theirs honored a state override. `scripts/check-public-rpcs.mjs` checks them
 * all again; it is run by hand, never in CI.
 *
 * Within a chain the order is the order they are tried: those that run `eth_simulateV1` first
 * (so a simulation and the reads around it go to one endpoint), the chain's own before the others.
 */

/** When every endpoint below was last checked, as `scripts/check-public-rpcs.mjs` checks them. */
export const PUBLIC_RPCS_VERIFIED = "2026-10-02";

/** One public endpoint. */
export interface PublicRpc {
  readonly url: string;
  /** Whether it runs `eth_simulateV1` as the command sends it. EVM endpoints only. */
  readonly simulateV1?: boolean;
  /**
   * Whether it answers `getProgramAccounts` with filters, as `sauce pools` scans a venue's pools.
   * Solana endpoints only: one that refuses it (publicnode answers 403) is never sent a scan.
   */
  readonly programAccounts?: boolean;
}

/** The public endpoints of each canonical chain, by chain id, in the order they are tried. */
export const PUBLIC_RPCS: Readonly<Record<number, readonly PublicRpc[]>> = {
  // Ethereum
  1: [
    { url: "https://ethereum-rpc.publicnode.com", simulateV1: true },
    { url: "https://eth.drpc.org", simulateV1: true },
    { url: "https://ethereum.public.blockpi.network/v1/rpc/public", simulateV1: true },
  ],
  // Optimism
  10: [
    { url: "https://mainnet.optimism.io", simulateV1: true },
    { url: "https://optimism-rpc.publicnode.com", simulateV1: true },
    { url: "https://1rpc.io/op", simulateV1: false },
  ],
  // Cronos
  25: [
    { url: "https://evm.cronos.org", simulateV1: true },
    { url: "https://cronos-evm-rpc.publicnode.com", simulateV1: true },
    { url: "https://cronos.drpc.org", simulateV1: true },
  ],
  // BNB Chain
  56: [
    { url: "https://bsc-dataseed.bnbchain.org", simulateV1: true },
    { url: "https://bsc-rpc.publicnode.com", simulateV1: true },
  ],
  // Gnosis
  100: [
    { url: "https://rpc.gnosischain.com", simulateV1: true },
    { url: "https://gnosis-rpc.publicnode.com", simulateV1: true },
    { url: "https://gnosis.drpc.org", simulateV1: true },
  ],
  // Fuse
  122: [{ url: "https://fuse.liquify.com", simulateV1: true }],
  // Unichain
  130: [
    { url: "https://unichain-rpc.publicnode.com", simulateV1: true },
    { url: "https://mainnet.unichain.org", simulateV1: false },
  ],
  // Polygon
  137: [
    { url: "https://polygon-bor-rpc.publicnode.com", simulateV1: true },
    { url: "https://polygon.drpc.org", simulateV1: true },
    { url: "https://1rpc.io/matic", simulateV1: false },
  ],
  // Monad
  143: [
    { url: "https://rpc.monad.xyz", simulateV1: false },
    { url: "https://rpc1.monad.xyz", simulateV1: false },
    { url: "https://rpc2.monad.xyz", simulateV1: false },
  ],
  // Sonic
  146: [
    { url: "https://rpc.soniclabs.com", simulateV1: true },
    { url: "https://sonic-rpc.publicnode.com", simulateV1: true },
  ],
  // Manta Pacific
  169: [
    { url: "https://pacific-rpc.manta.network/http", simulateV1: true },
    { url: "https://1rpc.io/manta", simulateV1: false },
  ],
  // opBNB
  204: [
    { url: "https://opbnb-mainnet-rpc.bnbchain.org", simulateV1: false },
    { url: "https://opbnb-rpc.publicnode.com", simulateV1: false },
    { url: "https://1rpc.io/opbnb", simulateV1: false },
  ],
  // Fantom
  250: [
    { url: "https://rpcapi.fantom.network", simulateV1: false },
    { url: "https://fantom.drpc.org", simulateV1: false },
  ],
  // Boba
  288: [
    { url: "https://mainnet.boba.network", simulateV1: false },
    { url: "https://gateway.tenderly.co/public/boba-ethereum", simulateV1: false },
  ],
  // zkSync Era
  324: [
    { url: "https://mainnet.era.zksync.io", simulateV1: false },
    { url: "https://zksync.drpc.org", simulateV1: false },
    { url: "https://1rpc.io/zksync2-era", simulateV1: false },
  ],
  // PulseChain
  369: [{ url: "https://pulsechain-rpc.publicnode.com", simulateV1: false }],
  // Metis
  1088: [
    { url: "https://andromeda.metis.io/?owner=1088", simulateV1: false },
    { url: "https://metis-rpc.publicnode.com", simulateV1: false },
    { url: "https://metis.drpc.org", simulateV1: false },
  ],
  // Core
  1116: [
    { url: "https://rpc.coredao.org", simulateV1: true },
    { url: "https://core.drpc.org", simulateV1: true },
  ],
  // Moonbeam
  1284: [{ url: "https://moonbeam.api.onfinality.io/public", simulateV1: false }],
  // Sei
  1329: [
    { url: "https://evm-rpc.sei-apis.com", simulateV1: false },
    { url: "https://sei-evm-rpc.publicnode.com", simulateV1: false },
  ],
  // Ronin
  2020: [{ url: "https://api.roninchain.com/rpc", simulateV1: false }],
  // Mantle
  5000: [
    { url: "https://rpc.mantle.xyz", simulateV1: true },
    { url: "https://mantle-rpc.publicnode.com", simulateV1: true },
  ],
  // Arc
  5042: [
    { url: "https://arc-rpc.publicnode.com", simulateV1: true },
    { url: "https://arc.drpc.org", simulateV1: true },
  ],
  // Klaytn (Kaia)
  8217: [
    { url: "https://public-en.node.kaia.io", simulateV1: false },
    { url: "https://1rpc.io/klay", simulateV1: false },
  ],
  // Base
  8453: [
    { url: "https://mainnet.base.org", simulateV1: true },
    { url: "https://base-rpc.publicnode.com", simulateV1: true },
    { url: "https://base.drpc.org", simulateV1: true },
  ],
  // Plasma
  9745: [{ url: "https://rpc.plasma.to", simulateV1: true }],
  // Mode
  34443: [
    { url: "https://mainnet.mode.network", simulateV1: true },
    { url: "https://1rpc.io/mode", simulateV1: false },
  ],
  // Arbitrum One
  42161: [
    { url: "https://arb1.arbitrum.io/rpc", simulateV1: true },
    { url: "https://arbitrum-one-rpc.publicnode.com", simulateV1: true },
    { url: "https://1rpc.io/arb", simulateV1: false },
  ],
  // Celo
  42220: [
    { url: "https://celo-rpc.publicnode.com", simulateV1: true },
    { url: "https://forno.celo.org", simulateV1: false },
    { url: "https://1rpc.io/celo", simulateV1: false },
  ],
  // Avalanche C-Chain
  43114: [
    { url: "https://api.avax.network/ext/bc/C/rpc", simulateV1: false },
    { url: "https://avalanche-c-chain-rpc.publicnode.com", simulateV1: false },
    { url: "https://avalanche.drpc.org", simulateV1: false },
  ],
  // Ink
  57073: [
    { url: "https://rpc-gel.inkonchain.com", simulateV1: true },
    { url: "https://rpc-qnd.inkonchain.com", simulateV1: true },
    { url: "https://ink-rpc.publicnode.com", simulateV1: true },
  ],
  // Linea
  59144: [
    { url: "https://linea-rpc.publicnode.com", simulateV1: true },
    { url: "https://rpc.linea.build", simulateV1: false },
    { url: "https://1rpc.io/linea", simulateV1: false },
  ],
  // Berachain
  80094: [
    { url: "https://rpc.berachain.com", simulateV1: true },
    { url: "https://berachain-rpc.publicnode.com", simulateV1: true },
  ],
  // Blast
  81457: [
    { url: "https://rpc.blast.io", simulateV1: false },
    { url: "https://blast-rpc.publicnode.com", simulateV1: false },
  ],
  // Base Sepolia (testnet), checked 2026-10-26
  84532: [
    { url: "https://sepolia.base.org", simulateV1: true },
    { url: "https://base-sepolia-rpc.publicnode.com", simulateV1: true },
    // Its eth_simulateV1 ran on one check of two.
    { url: "https://base-sepolia.api.onfinality.io/public", simulateV1: false },
  ],
  // Scroll
  534352: [
    { url: "https://rpc.scroll.io", simulateV1: false },
    { url: "https://scroll-rpc.publicnode.com", simulateV1: false },
    { url: "https://1rpc.io/scroll", simulateV1: false },
  ],
  // Arc Testnet, checked 2026-10-26: dRPC is the endpoint Arc's docs list; Circle's own runs no
  // eth_simulateV1 ("method not supported"), so it is tried last.
  5042002: [
    { url: "https://rpc.drpc.testnet.arc.io", simulateV1: true },
    { url: "https://arc-testnet-rpc.publicnode.com", simulateV1: true },
    { url: "https://rpc.testnet.arc.io", simulateV1: false },
  ],
  // Zora
  7777777: [{ url: "https://rpc.zora.energy", simulateV1: true }],
  // Ethereum Sepolia (testnet), checked 2026-10-26: Tatum's and 1rpc's keyless endpoints refused
  // or dropped the state-override eth_call, and dRPC serves Sepolia on paid plans only.
  11155111: [
    { url: "https://ethereum-sepolia-rpc.publicnode.com", simulateV1: true },
    { url: "https://sepolia.gateway.tenderly.co", simulateV1: false },
  ],
  // Aurora
  1313161554: [
    { url: "https://mainnet.aurora.dev", simulateV1: false },
    { url: "https://1rpc.io/aurora", simulateV1: false },
  ],
  // Solana (mainnet-beta), under the chain id the SDK gives it
  1399811149: [
    { url: "https://api.mainnet-beta.solana.com", programAccounts: true },
    { url: "https://solana-rpc.publicnode.com", programAccounts: false },
  ],
  // Solana devnet, under the chain id the SDK gives it (the devnet engine's CHAIN_ID), checked
  // 2026-10-26
  1399811150: [{ url: "https://api.devnet.solana.com", programAccounts: true }],
};
