import type { ProtocolInfo, ProtocolCategory } from "../core/types.js";

// DEX protocols
import { protocolInfo as uniswapV2 } from "./uniswap-v2/info.js";
import { protocolInfo as uniswapV3 } from "./uniswap-v3/info.js";
import { protocolInfo as uniswapV4 } from "./uniswap-v4/info.js";
import { protocolInfo as sushiswapV2 } from "./sushiswap-v2/info.js";
import { protocolInfo as curveInfo } from "./curve/info.js";
import { protocolInfo as balancerV2 } from "./balancer-v2/info.js";
import { protocolInfo as pancakeswapV2 } from "./pancakeswap-v2/info.js";
import { protocolInfo as pancakeswapV3 } from "./pancakeswap-v3/info.js";
import { protocolInfo as velodrome } from "./velodrome/info.js";
import { protocolInfo as aerodrome } from "./aerodrome/info.js";
import { protocolInfo as camelot } from "./camelot/info.js";
import { protocolInfo as traderJoe } from "./trader-joe/info.js";
import { protocolInfo as kyberswap } from "./kyberswap/info.js";
import { protocolInfo as quickswap } from "./quickswap/info.js";
import { protocolInfo as maverick } from "./maverick/info.js";
import { protocolInfo as ambient } from "./ambient/info.js";
import { protocolInfo as dodo } from "./dodo/info.js";
import { protocolInfo as syncswap } from "./syncswap/info.js";
import { protocolInfo as baseswap } from "./baseswap/info.js";
import { protocolInfo as thruster } from "./thruster/info.js";
import { protocolInfo as spookyswap } from "./spookyswap/info.js";
import { protocolInfo as thena } from "./thena/info.js";
import { protocolInfo as ramses } from "./ramses/info.js";
import { protocolInfo as fenix } from "./fenix/info.js";
import { protocolInfo as lynex } from "./lynex/info.js";
import { protocolInfo as kim } from "./kim/info.js";
import { protocolInfo as synthraV3 } from "./synthra-v3/info.js";
import { protocolInfo as unitflowV3 } from "./unitflow-v3/info.js";
import { protocolInfo as aerodromeSlipstream } from "./aerodrome-slipstream/info.js";

// Lending protocols
import { protocolInfo as aaveV2 } from "./aave-v2/info.js";
import { protocolInfo as aaveV3 } from "./aave-v3/info.js";
import { protocolInfo as aaveV4 } from "./aave-v4/info.js";
import { protocolInfo as cctp } from "./cctp/info.js";
import { protocolInfo as compoundV2 } from "./compound-v2/info.js";
import { protocolInfo as compoundV3 } from "./compound-v3/info.js";
import { protocolInfo as sparkInfo } from "./spark/info.js";
import { protocolInfo as morphoBlue } from "./morpho-blue/info.js";
import { protocolInfo as eulerV2 } from "./euler-v2/info.js";
import { protocolInfo as radiant } from "./radiant/info.js";
import { protocolInfo as benqi } from "./benqi/info.js";
import { protocolInfo as moonwell } from "./moonwell/info.js";
import { protocolInfo as fluid } from "./fluid/info.js";
import { protocolInfo as silo } from "./silo/info.js";
import { protocolInfo as layerbank } from "./layerbank/info.js";
import { protocolInfo as venus } from "./venus/info.js";
import { protocolInfo as zerolend } from "./zerolend/info.js";

// Bridges
import { protocolInfo as stargate } from "./stargate/info.js";
import { protocolInfo as across } from "./across/info.js";
import { protocolInfo as hop } from "./hop/info.js";
import { protocolInfo as synapse } from "./synapse/info.js";
import { protocolInfo as celer } from "./celer/info.js";
import { protocolInfo as connext } from "./connext/info.js";
import { protocolInfo as layerzero } from "./layerzero/info.js";
import { protocolInfo as wormhole } from "./wormhole/info.js";
import { protocolInfo as axelar } from "./axelar/info.js";
import { protocolInfo as chainlinkCcip } from "./chainlink-ccip/info.js";
import { protocolInfo as hyperlane } from "./hyperlane/info.js";
import { protocolInfo as circleGateway } from "./circle-gateway/info.js";
import { protocolInfo as debridge } from "./debridge/info.js";
import { protocolInfo as lifi } from "./lifi/info.js";
import { protocolInfo as socket } from "./socket/info.js";
import { protocolInfo as squid } from "./squid/info.js";
import { protocolInfo as arbitrumBridge } from "./arbitrum-bridge/info.js";
import { protocolInfo as optimismBridge } from "./optimism-bridge/info.js";
import { protocolInfo as baseBridge } from "./base-bridge/info.js";
import { protocolInfo as polygonBridge } from "./polygon-bridge/info.js";
import { protocolInfo as scrollBridge } from "./scroll-bridge/info.js";
import { protocolInfo as lineaBridge } from "./linea-bridge/info.js";
import { protocolInfo as zksyncBridge } from "./zksync-bridge/info.js";

// Yield, Staking & Restaking
import { protocolInfo as lido } from "./lido/info.js";
import { protocolInfo as rocketPool } from "./rocket-pool/info.js";
import { protocolInfo as eigenlayer } from "./eigenlayer/info.js";
import { protocolInfo as etherfi } from "./etherfi/info.js";
import { protocolInfo as renzo } from "./renzo/info.js";
import { protocolInfo as kelp } from "./kelp/info.js";
import { protocolInfo as puffer } from "./puffer/info.js";
import { protocolInfo as swell } from "./swell/info.js";
import { protocolInfo as stader } from "./stader/info.js";
import { protocolInfo as fraxEther } from "./frax-ether/info.js";
import { protocolInfo as cbeth } from "./cbeth/info.js";
import { protocolInfo as mantleMeth } from "./mantle-meth/info.js";
import { protocolInfo as pendle } from "./pendle/info.js";
import { protocolInfo as convex } from "./convex/info.js";
import { protocolInfo as yearnV3 } from "./yearn-v3/info.js";
import { protocolInfo as beefy } from "./beefy/info.js";
import { protocolInfo as arrakis } from "./arrakis/info.js";
import { protocolInfo as gamma } from "./gamma/info.js";
import { protocolInfo as harvestInfo } from "./harvest/info.js";
import { protocolInfo as sommelierInfo } from "./sommelier/info.js";
import { protocolInfo as olympusInfo } from "./olympus/info.js";
import { protocolInfo as tokemakInfo } from "./tokemak/info.js";

// Derivatives
import { protocolInfo as gmxV1 } from "./gmx-v1/info.js";
import { protocolInfo as gmxV2 } from "./gmx-v2/info.js";
import { protocolInfo as synthetixV3 } from "./synthetix-v3/info.js";
import { protocolInfo as gainsNetwork } from "./gains-network/info.js";
import { protocolInfo as vertex } from "./vertex/info.js";
import { protocolInfo as levelFinance } from "./level-finance/info.js";
import { protocolInfo as premia } from "./premia/info.js";
import { protocolInfo as hegic } from "./hegic/info.js";
import { protocolInfo as opyn } from "./opyn/info.js";
import { protocolInfo as thales } from "./thales/info.js";
import { protocolInfo as perpetualProtocol } from "./perpetual-protocol/info.js";
import { protocolInfo as muxProtocol } from "./mux-protocol/info.js";
import { protocolInfo as aevoInfo } from "./aevo/info.js";

// Aggregators
import { protocolInfo as oneInch } from "./oneinch/info.js";
import { protocolInfo as paraswap } from "./paraswap/info.js";
import { protocolInfo as zeroXExchange } from "./zerox/info.js";
import { protocolInfo as cowswap } from "./cowswap/info.js";
import { protocolInfo as openocean } from "./openocean/info.js";
import { protocolInfo as kyberswapAggregator } from "./kyberswap-aggregator/info.js";

// Oracles
import { protocolInfo as chainlink } from "./chainlink/info.js";
import { protocolInfo as pyth } from "./pyth/info.js";

// CDPs & Stablecoins
import { protocolInfo as maker } from "./maker/info.js";
import { protocolInfo as liquityV1 } from "./liquity-v1/info.js";
import { protocolInfo as liquityV2 } from "./liquity-v2/info.js";
import { protocolInfo as ethena } from "./ethena/info.js";
import { protocolInfo as gho } from "./gho/info.js";
import { protocolInfo as frax } from "./frax/info.js";
import { protocolInfo as crvusd } from "./crvusd/info.js";
import { protocolInfo as reflexerInfo } from "./reflexer/info.js";
import { protocolInfo as abracadabraInfo } from "./abracadabra/info.js";
import { protocolInfo as alchemixInfo } from "./alchemix/info.js";

// Infrastructure
import { protocolInfo as permit2 } from "./permit2/info.js";
import { protocolInfo as safe } from "./safe/info.js";
import { protocolInfo as ens } from "./ens/info.js";
import { protocolInfo as seaport } from "./seaport/info.js";
import { protocolInfo as gelato } from "./gelato/info.js";
import { protocolInfo as erc3156Info } from "./erc3156/info.js";
import { protocolInfo as instadappInfo } from "./instadapp/info.js";

// Standards
import { protocolInfo as erc20Info } from "./erc20/info.js";
import { protocolInfo as erc4626Info } from "./erc4626/info.js";

// Payments & Streaming
import { protocolInfo as sablier } from "./sablier/info.js";
import { protocolInfo as superfluid } from "./superfluid/info.js";

/** All protocol metadata indexed by slug */
export const protocols: Record<string, ProtocolInfo> = {
  // DEX
  "uniswap-v2": uniswapV2,
  "uniswap-v3": uniswapV3,
  "uniswap-v4": uniswapV4,
  "sushiswap-v2": sushiswapV2,
  curve: curveInfo,
  "balancer-v2": balancerV2,
  "pancakeswap-v2": pancakeswapV2,
  "pancakeswap-v3": pancakeswapV3,
  velodrome: velodrome,
  aerodrome: aerodrome,
  camelot: camelot,
  "trader-joe": traderJoe,
  kyberswap: kyberswap,
  quickswap: quickswap,
  maverick: maverick,
  ambient: ambient,
  dodo: dodo,
  syncswap: syncswap,
  baseswap: baseswap,
  thruster: thruster,
  spookyswap: spookyswap,
  thena: thena,
  ramses: ramses,
  fenix: fenix,
  lynex: lynex,
  kim: kim,
  "synthra-v3": synthraV3,
  "unitflow-v3": unitflowV3,
  "aerodrome-slipstream": aerodromeSlipstream,

  // Lending
  "aave-v2": aaveV2,
  "aave-v3": aaveV3,
  "aave-v4": aaveV4,
  // Bridge
  cctp,
  "compound-v2": compoundV2,
  "compound-v3": compoundV3,
  spark: sparkInfo,
  "morpho-blue": morphoBlue,
  "euler-v2": eulerV2,
  radiant: radiant,
  benqi: benqi,
  moonwell: moonwell,
  fluid: fluid,
  silo: silo,
  layerbank: layerbank,
  venus: venus,
  zerolend: zerolend,

  // Bridges
  stargate: stargate,
  across: across,
  hop: hop,
  synapse: synapse,
  celer: celer,
  connext: connext,
  layerzero: layerzero,
  wormhole: wormhole,
  axelar: axelar,
  "chainlink-ccip": chainlinkCcip,
  hyperlane: hyperlane,
  "circle-gateway": circleGateway,
  debridge: debridge,
  lifi: lifi,
  socket: socket,
  squid: squid,
  "arbitrum-bridge": arbitrumBridge,
  "optimism-bridge": optimismBridge,
  "base-bridge": baseBridge,
  "polygon-bridge": polygonBridge,
  "scroll-bridge": scrollBridge,
  "linea-bridge": lineaBridge,
  "zksync-bridge": zksyncBridge,

  // Yield, Staking & Restaking
  lido: lido,
  "rocket-pool": rocketPool,
  eigenlayer: eigenlayer,
  etherfi: etherfi,
  renzo: renzo,
  kelp: kelp,
  puffer: puffer,
  swell: swell,
  stader: stader,
  "frax-ether": fraxEther,
  cbeth: cbeth,
  "mantle-meth": mantleMeth,
  pendle: pendle,
  convex: convex,
  "yearn-v3": yearnV3,
  beefy: beefy,
  arrakis: arrakis,
  gamma: gamma,
  harvest: harvestInfo,
  sommelier: sommelierInfo,
  olympus: olympusInfo,
  tokemak: tokemakInfo,

  // Derivatives
  "gmx-v1": gmxV1,
  "gmx-v2": gmxV2,
  "synthetix-v3": synthetixV3,
  "gains-network": gainsNetwork,
  vertex: vertex,
  "level-finance": levelFinance,
  premia: premia,
  hegic: hegic,
  opyn: opyn,
  thales: thales,
  "perpetual-protocol": perpetualProtocol,
  "mux-protocol": muxProtocol,
  aevo: aevoInfo,

  // Aggregators
  oneinch: oneInch,
  paraswap: paraswap,
  zerox: zeroXExchange,
  cowswap: cowswap,
  openocean: openocean,
  "kyberswap-aggregator": kyberswapAggregator,

  // Oracles
  chainlink: chainlink,
  pyth: pyth,

  // CDPs & Stablecoins
  maker: maker,
  "liquity-v1": liquityV1,
  "liquity-v2": liquityV2,
  ethena: ethena,
  gho: gho,
  frax: frax,
  crvusd: crvusd,
  reflexer: reflexerInfo,
  abracadabra: abracadabraInfo,
  alchemix: alchemixInfo,

  // Infrastructure
  permit2: permit2,
  safe: safe,
  ens: ens,
  seaport: seaport,
  gelato: gelato,
  erc3156: erc3156Info,
  instadapp: instadappInfo,

  // Standards
  erc20: erc20Info,
  erc4626: erc4626Info,

  // Payments & Streaming
  sablier: sablier,
  superfluid: superfluid,
};

/** Get a protocol by slug */
export function getProtocol(slug: string): ProtocolInfo | undefined {
  return protocols[slug];
}

/** List all protocols */
export function listProtocols(): ProtocolInfo[] {
  return Object.values(protocols);
}

/** Get all protocols in a category */
export function getProtocolsByCategory(category: ProtocolCategory): ProtocolInfo[] {
  return Object.values(protocols).filter((p) => p.category === category);
}

/** Get all protocols deployed on a specific chain */
export function getProtocolsByChain(chainId: number): ProtocolInfo[] {
  return Object.values(protocols).filter((p) => p.chains.some((c) => c.chainId === chainId));
}

/** Get all unique slugs */
export function listProtocolSlugs(): string[] {
  return Object.keys(protocols);
}

// Tree-shakeable per-protocol re-exports
export * as uniswapV2 from "./uniswap-v2/index.js";
export * as uniswapV3 from "./uniswap-v3/index.js";
export * as uniswapV4 from "./uniswap-v4/index.js";
export * as sushiswapV2 from "./sushiswap-v2/index.js";
export * as curve from "./curve/index.js";
export * as balancerV2 from "./balancer-v2/index.js";
export * as aaveV2 from "./aave-v2/index.js";
export * as aaveV3 from "./aave-v3/index.js";
export * as cctp from "./cctp/index.js";
export * as compoundV3 from "./compound-v3/index.js";
export * as oneInch from "./oneinch/index.js";
export * as chainlink from "./chainlink/index.js";
export * as pyth from "./pyth/index.js";
export * as permit2 from "./permit2/index.js";
export * as safe from "./safe/index.js";
export * as lido from "./lido/index.js";
export * as eigenlayer from "./eigenlayer/index.js";
export * as erc3156 from "./erc3156/index.js";
export * as instadapp from "./instadapp/index.js";
export * as perpetualProtocol from "./perpetual-protocol/index.js";
export * as muxProtocol from "./mux-protocol/index.js";
export * as aevo from "./aevo/index.js";
export * as reflexer from "./reflexer/index.js";
export * as abracadabra from "./abracadabra/index.js";
export * as alchemix from "./alchemix/index.js";
export * as harvest from "./harvest/index.js";
export * as sommelier from "./sommelier/index.js";
export * as olympus from "./olympus/index.js";
export * as tokemak from "./tokemak/index.js";
export * as erc20 from "./erc20/index.js";
export * as erc4626 from "./erc4626/index.js";
