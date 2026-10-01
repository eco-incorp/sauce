#!/usr/bin/env node
// Every generated file of the agent skills, from the SDK's registries — ONE generator, so the
// three views of the same facts cannot drift from each other or from the registry:
//
//   skills/sauce-globals/references/{tokens,protocols,chains}.md   the NAMES a program uses with no
//                                                                  import (no addresses)
//   skills/sauce-chains/references/index.md, <chain>.md            per chain: ids, native coin, the
//                                                                  Sauce release, intents, tokens and
//                                                                  every protocol with its addresses
//   skills/sauce-protocols/references/index.md                     every protocol by category, with
//                                                                  how to choose between them
//   skills/sauce-protocols/references/registry/<slug>.md           per protocol: its deployments per
//                                                                  chain, how a program names each,
//                                                                  and its ABI functions
//
// ONE SOURCE. Names come from `routes.sourceGlobals(chain)`, the function `sauce globals` prints;
// protocols, their categories and deployments from `listProtocols()` and each `protocols/<slug>`
// module; the Sauce release from `/deployments`; intents from the eco-routes registry. Which ABI
// export a deployment role speaks is the registry's own evidence map
// (`test/fixtures/registry-abi/targets.json`, which `registry-abi.test.ts` holds to the deployed
// code). The hand-written parts are the prose below: the category guidance and chain notes.
//
// It reads the BUILT SDK (`dist/`), so it runs after `tsc` in `build`, which rewrites the files.
// They are committed and prettier-ignored: CI rebuilds and fails when that changed them, and the
// skills checker (`check-skills.mjs`) compares them with `renderSkillsReferences()` the same way.
//
//   node scripts/gen-skills-references.mjs           write the files
//   node scripts/gen-skills-references.mjs --check   exit 1, naming each, when a file is stale
//   import { globalsIndex, skillsReferences, renderSkillsReferences }   for the skills checker
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getAddressDecoder } from "@solana/kit";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The repository's skills directory. */
export const SKILLS_DIR = join(SDK, "..", "skills");
const TARGETS = join(SDK, "test", "fixtures", "registry-abi", "targets.json");

const HEADER = "<!-- Generated from the SDK's registries. Do not edit. -->";

/** The eco-routes namespace, which the globals index leaves to the intent syntax. */
const INTENT_PROTOCOL = "eco-routes";

/** Directories whose every `.md` file this generator owns (stale ones are removed). */
export const GENERATED_DIRS = ["sauce-chains/references", "sauce-protocols/references/registry"];

// ---- The names a program uses: sauce globals ----------------------------------------------------

/**
 * The index of globals as data. `sdk` is the package root module and `ecoRoutes` its
 * `protocols/eco-routes` module — passed in, so the skills checker can index the SDK it loaded
 * (an installed package, say) rather than this repository's build.
 */
export function globalsIndex(sdk, ecoRoutes) {
  const { routes, CANONICAL_CHAINS, nativeErc20, getChain } = sdk;
  const chains = [...CANONICAL_CHAINS].sort((a, b) => a.id - b.id);
  const listed = chains.map((chain) => ({ chain, globals: routes.sourceGlobals(chain.slug) }));

  const tokens = listed
    .filter(({ globals }) => globals.tokens.length > 0)
    .map(({ chain, globals }) => {
      const native = nativeErc20(chain.id);
      const coin = getChain(chain.id)?.nativeCurrency;
      const twin =
        native === undefined
          ? undefined
          : globals.tokens.find(
              (token) => token.address.toLowerCase() === native.address.toLowerCase(),
            );

      // Solana's are mints: the base58 address beside the 32-byte key a program holds.
      const row = ({ symbol, address, decimals, mint }) => ({
        symbol,
        address,
        decimals,
        ...(mint === undefined ? {} : { mint }),
      });

      return {
        chain: { key: globals.chain.key, slug: chain.slug, id: chain.id, kind: chain.kind },
        tokens: globals.tokens.map(row),
        ...(chain.kind === "svm" ? { devnet: routes.SVM_TOKEN_REGISTRY.devnet.map(row) } : {}),
        ...(native === undefined
          ? {}
          : {
              native: {
                coin: coin?.symbol ?? "the native coin",
                coinDecimals: coin?.decimals,
                erc20: twin?.symbol ?? native.address,
                erc20Decimals: native.decimals,
              },
            }),
      };
    });

  // A contract and every chain it resolves on, in chain-id order. A family alias names its
  // member's contract.
  const contracts = new Map();
  const aliases = new Map();
  for (const { chain, globals } of listed) {
    for (const ns of globals.protocols) {
      for (const contract of ns.contracts) {
        // The Portal and its provers are left to the intent syntax: a program opens an intent with
        // `Arbitrum(() => { ... }).reward(...)` (`sauce-intents`), never by calling them by name.
        if (contract.protocol === INTENT_PROTOCOL) continue;
        const name = `${ns.namespace}.${contract.name}`;
        if (ns.kind === "protocol") {
          const entry = contracts.get(name) ?? {
            name,
            protocol: contract.protocol,
            default: contract.default,
            chains: [],
          };
          entry.chains.push(chain.slug);
          contracts.set(name, entry);
        } else {
          const member = globals.protocols.find(
            (other) => other.kind === "protocol" && other.protocols[0] === contract.protocol,
          );
          const target = `${member?.namespace ?? contract.protocol}.${contract.name}`;
          const entry = aliases.get(name) ?? { name, targets: new Map() };
          entry.targets.set(target, [...(entry.targets.get(target) ?? []), chain.slug]);
          aliases.set(name, entry);
        }
      }
    }
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  const intents = (slug) => {
    try {
      ecoRoutes.ecoRoutesPortal(slug);

      return true;
    } catch {
      return false;
    }
  };
  const chainNames = [...listed[0].globals.chains]
    .sort((a, b) => a.id - b.id)
    .map((chain) => ({ ...chain, intents: intents(chain.slug) }));

  // The zero-import functions per target, from the first chain of each kind.
  const functions = ["evm", "svm"].flatMap((kind) => {
    const first = listed.find(({ chain }) => chain.kind === kind);

    return first === undefined
      ? []
      : first.globals.modules.map((module) => ({
          kind,
          specifier: module.specifier,
          functions: module.functions,
        }));
  });

  // Interfaces: ABIs with no fixed address, the same on every EVM chain. A program binds one to an
  // address it holds, `Namespace.Contract.at(address).method(...)`. The first method whose inputs
  // are all scalars is the one the skills checker compiles a call of.
  const evm = listed.find(({ chain }) => chain.kind === "evm");
  const scalar = /^(address|bool|u?int\d*)$/;
  const interfaces = (evm?.globals.interfaces ?? [])
    .map((one) => {
      const call = one.methods.find((m) =>
        /^\w+\((.*)\)$/
          .exec(m.signature)[1]
          .split(",")
          .every((type) => type === "" || scalar.test(type)),
      );
      return {
        name: `${one.namespace}.${one.name}`,
        protocol: one.protocol,
        ...(call === undefined
          ? {}
          : { call: { name: call.name, inputs: /^\w+\((.*)\)$/.exec(call.signature)[1] } }),
      };
    })
    .sort(byName);

  return {
    tokens,
    contracts: [...contracts.values()].sort(byName),
    interfaces,
    aliases: [...aliases.values()]
      .map(({ name, targets }) => ({
        name,
        targets: [...targets].map(([target, on]) => ({ target, chains: on })),
      }))
      .sort(byName),
    chains: chainNames,
    functions,
  };
}

// ---- Everything per chain and per protocol --------------------------------------------------------

/** Each registry ABI export of a protocol module: `{ name, functions }`. */
function abiExports(module) {
  return Object.entries(module)
    .filter(
      ([, value]) =>
        Array.isArray(value) && value.length > 0 && value.every((f) => typeof f?.type === "string"),
    )
    .map(([name, abi]) => ({ name, functions: abi.filter((f) => f.type === "function") }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

const typeOf = (param) =>
  param.type.startsWith("tuple")
    ? `(${(param.components ?? []).map(paramText).join(", ")})${param.type.slice("tuple".length)}`
    : param.type;
function paramText(param) {
  return param.name ? `${typeOf(param)} ${param.name}` : typeOf(param);
}
const functionText = (f) => {
  const mutability =
    f.stateMutability && f.stateMutability !== "nonpayable" ? ` ${f.stateMutability}` : "";
  const outputs = (f.outputs ?? []).length
    ? ` returns (${f.outputs.map(paramText).join(", ")})`
    : "";

  return `${f.name}(${(f.inputs ?? []).map(paramText).join(", ")})${mutability}${outputs}`;
};

/**
 * The data every generated file renders. `api` is `{ sdk, ecoRoutes, deployments, cctp, compiler,
 * loadProtocol(slug) }` — modules the caller loaded, so the checker can pass the installed
 * package's — and `documented(slug)` says whether the skill carries that protocol's document.
 */
export async function skillsReferences(api, documented) {
  const { sdk, ecoRoutes, deployments, cctp, compiler, loadProtocol } = api;
  // An export a program can import: the compile serves `./protocols/<slug>/<Export>.json`.
  const served = (slug, name) =>
    compiler.resolveSdkModule(`./protocols/${slug}/${name}.json`) !== undefined;
  const targets = JSON.parse(readFileSync(TARGETS, "utf8")).protocols;
  const globals = globalsIndex(sdk, ecoRoutes);
  const canonical = [...sdk.CANONICAL_CHAINS].sort((a, b) => a.id - b.id);
  const byId = new Map(canonical.map((chain) => [chain.id, chain]));
  const sourceGlobals = new Map(canonical.map((c) => [c.slug, sdk.routes.sourceGlobals(c.slug)]));

  // Families (an alias namespace and its members) and each protocol's own namespace per chain.
  const family = new Map();
  const namespaceOf = new Map(); // slug -> { name, chains: Map<chain, contracts[]> }
  for (const chain of canonical) {
    for (const ns of sourceGlobals.get(chain.slug).protocols) {
      if (ns.kind === "family") {
        for (const slug of ns.protocols) family.set(slug, ns.namespace);
        continue;
      }
      const slug = ns.protocols[0];
      const entry = namespaceOf.get(slug) ?? { name: ns.namespace, chains: new Map() };
      entry.chains.set(chain.slug, ns.contracts);
      namespaceOf.set(slug, entry);
    }
  }
  const familyMembers = new Map();
  for (const [slug, name] of family)
    familyMembers.set(name, [...(familyMembers.get(name) ?? []), slug].sort());

  const protocols = [];
  const listed = sdk.listProtocols();
  const modules = await Promise.all(
    listed.map((info) => loadProtocol(info.slug).catch(() => ({}))),
  );
  for (const [index, info] of listed.entries()) {
    const module = modules[index];
    const exports = abiExports(module).map((e) => ({ ...e, served: served(info.slug, e.name) }));
    const evidence = targets[info.slug] ?? {};
    const exportFor = (role, chainId) =>
      Object.entries(evidence).find(
        ([name, target]) =>
          (target.roles ?? []).includes(role) &&
          (target.chains === undefined || target.chains.includes(chainId)) &&
          exports.some((e) => e.name === name && e.served),
      )?.[0];
    const namespace = namespaceOf.get(info.slug);
    const deployed = [];
    for (const deployment of info.chains ?? []) {
      const chain = byId.get(deployment.chainId);
      if (chain === undefined) continue;
      const contracts = namespace?.chains.get(chain.slug) ?? [];
      for (const [role, address] of Object.entries(deployment.addresses ?? {})) {
        if (typeof address !== "string") continue;
        const named = contracts.find((c) => c.address.toLowerCase() === address.toLowerCase());
        deployed.push({
          chain: chain.slug,
          role,
          address,
          namespace: named === undefined ? undefined : `${namespace.name}.${named.name}`,
          abi: exportFor(role, deployment.chainId),
        });
      }
    }
    deployed.sort(
      (a, b) =>
        canonical.findIndex((c) => c.slug === a.chain) -
          canonical.findIndex((c) => c.slug === b.chain) || (a.role < b.role ? -1 : 1),
    );
    protocols.push({
      slug: info.slug,
      name: info.name,
      category: info.category,
      description: info.description,
      family: family.get(info.slug),
      namespace:
        namespace === undefined
          ? undefined
          : { name: namespace.name, chains: [...namespace.chains.keys()] },
      chains: [...new Set(deployed.map((d) => d.chain))],
      deployed,
      exports: exports.map((e) => ({
        name: e.name,
        served: e.served,
        roles: [...new Set(evidence[e.name]?.roles ?? [])],
        functions: e.functions.map(functionText),
      })),
      templates: Object.entries(module)
        .filter(([, value]) => typeof value === "string")
        .map(([name]) => name)
        .sort(),
      documented: documented(info.slug),
    });
  }
  protocols.sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const tokensOf = new Map(globals.tokens.map((entry) => [entry.chain.slug, entry]));
  const chains = canonical.map((chain) => {
    const names = sourceGlobals.get(chain.slug);
    let intents;
    try {
      const portal = ecoRoutes.ecoRoutesPortal(chain.slug);
      let executor;
      let pot;
      try {
        executor = ecoRoutes.ecoRoutesExecutor(chain.slug);
        pot = sdk.destinationPot(chain.slug);
      } catch {}
      intents = { portal, executor, pot };
    } catch {}
    const coin = sdk.getChain(chain.id)?.nativeCurrency;
    const tokens = tokensOf.get(chain.slug);

    return {
      id: chain.id,
      slug: chain.slug,
      name: chain.name,
      kind: chain.kind,
      key: names.chain.key,
      aliases: chain.aliases ?? [],
      coin,
      native: tokens?.native,
      tokens: tokens?.tokens ?? [],
      devnet: tokens?.devnet ?? [],
      intents,
      cctp: cctp.CCTP_DOMAIN?.[chain.slug],
      sauce:
        chain.kind === "evm"
          ? {
              engine: deployments.v12EngineAddress(),
              kitchen: deployments.v12KitchenAddress(),
              router: deployments.v12RouterAddress(),
            }
          : {
              engine: deployments.v12SvmEngineProgramId(),
              kitchen: deployments.v12SvmKitchenProgramId(),
            },
      protocols: protocols
        .filter((p) => p.chains.includes(chain.slug))
        .map((p) => ({ ...p, deployed: p.deployed.filter((d) => d.chain === chain.slug) })),
    };
  });

  return { globals, chains, protocols, familyMembers };
}

// ---- Prose: how to choose within a category, and facts about one chain -------------------------

/** Category headings, in the order the index lists them; a category not named here follows. */
const CATEGORIES = [
  ["dex", "DEX"],
  ["aggregator", "Aggregators"],
  ["lending", "Lending"],
  ["cdp", "CDPs and stablecoins"],
  ["bridge", "Bridges"],
  ["cross-chain", "Cross-chain messaging"],
  ["liquid-staking", "Liquid staking"],
  ["restaking", "Restaking"],
  ["staking", "Staking"],
  ["yield", "Yield and vaults"],
  ["perpetuals", "Perpetuals"],
  ["synthetics", "Synthetics"],
  ["options", "Options"],
  ["oracle", "Oracles"],
  ["payments", "Payments and streaming"],
  ["nft-marketplace", "NFT marketplaces"],
  ["infrastructure", "Infrastructure and standards"],
];

/** "Choosing between them", per category. Facts about the protocols' designs, not rankings. */
const CHOOSING = {
  dex: [
    "Inside a Sauce program, swap through the Sauce Router wherever it services the pool",
    "(`sauce-swaps`): Uniswap V3 and its forks (PancakeSwap V3, Aerodrome Slipstream, Algebra pools,",
    "Synthra, UnitFlow) and Uniswap V4 through `swapV3`/`swapV4`, and V2-style pairs, Curve, Balancer",
    "V2, DODO V2, Trader Joe LB and WOOFi through its unified `swap`. Choose by pool type:",
    "",
    "- **Concentrated liquidity** (V3-style, V4): the deepest pools for liquid pairs, several fee tiers",
    "  per pair, and a price limit, so a fill can stop part way and return the rest.",
    "- **Constant-product pairs** (Uniswap V2 and its forks, Solidly-style volatile pools): one pool per",
    "  pair, no price limit; a fill is bounded only by the minimum output you check.",
    "- **Stable pools** (Curve, Solidly-style stable pools): built for assets meant to trade near 1:1,",
    "  with less price impact there than a constant-product pair.",
    "- **One trade across several pools** under one limit: `sauce-distributed-swap`.",
  ],
  aggregator: [
    "An aggregator (1inch, ParaSwap, 0x, KyberSwap, OpenOcean) routes through many pools, but its",
    "calldata comes from an off-chain quote made for one sender, amount and moment. A program can",
    "take that calldata as a `main` input and pass it through, and must still check the output as a",
    "balance delta against a minimum. CoW Swap settles signed orders in off-chain batch auctions, so",
    "a program signs or cancels an order rather than swapping. When the program itself should choose",
    "the route, use the pools directly (`sauce-swaps`).",
  ],
  lending: [
    "- **One pool, many reserves** (Aave V2 and V3 and their forks Spark, Radiant, Seamless, ZeroLend):",
    "  supply and borrow any listed reserve against all your collateral in that market.",
    "- **One base asset per market** (Compound V3, a Comet per base asset): you borrow only that",
    "  asset, against the market's listed collaterals.",
    "- **Isolated markets** (Morpho Blue, Silo): each market pairs one collateral with one loan asset",
    "  and its own oracle, so one market's risk does not reach another.",
    "- **A token per asset** (Compound V2 and its forks Moonwell, Benqi, Venus, LayerBank): supply",
    "  mints a cToken, and the market's comptroller decides borrowing power.",
    "- **Others**: Aave V4 addresses reserves by id on a spoke; Euler V2 is ERC-4626 vaults under one",
    "  controller; Fluid shares one liquidity layer.",
    "",
    "Supplying needs an approval to the market. Borrowing is bounded by collateral factors and oracle",
    "prices, and a position below its liquidation threshold can be liquidated by anyone.",
  ],
  cdp: [
    "Mint a stablecoin against collateral (Maker and Sky's DAI and USDS, Liquity's LUSD and BOLD,",
    "crvUSD, GHO, RAI, MIM, Alchemix's self-repaying alUSD and alETH), or hold a yield-bearing",
    "wrapper of one (sDAI, Ethena's sUSDe). Each sets its own collateral ratio, rate and liquidation",
    "rules. The stablecoin itself is an ordinary ERC-20 to transfer.",
  ],
  bridge: [
    "Each bridge has its own trust model and delay. Canonical rollup bridges (Arbitrum, Optimism,",
    "Base, Scroll, Linea, zkSync, Polygon) trust only the rollup but take days to withdraw to",
    "Ethereum; liquidity and intent bridges (Across, Stargate, Hop, Synapse, Celer, Connext, deBridge)",
    "settle in minutes and trust their relayers and pools; CCTP burns USDC and Circle mints it on the",
    "destination; LI.FI, Socket and Squid route across bridges from an off-chain quote. To continue a",
    "program on another chain, not only move a token, open a Sauce intent (`sauce-intents`).",
  ],
  "cross-chain": [
    "Messaging protocols (LayerZero, Wormhole, Axelar, Chainlink CCIP, Hyperlane) carry arbitrary",
    "messages, each with its own set of verifiers and a fee paid at send time in the native coin (an",
    "`evm.call` with value). Circle Gateway keeps one USDC balance spendable across chains.",
  ],
  "liquid-staking": [
    "Staking ETH returns a liquid token of one of two kinds. A **rebasing** balance (stETH) changes",
    "on its own, so measure it as a delta at the moment you use it, and hold the wrapped form",
    "(wstETH) instead. An **exchange-rate** token (rETH, cbETH, sfrxETH, ETHx, swETH, mETH) keeps its",
    "balance and grows in value. Withdrawals to ETH go through each protocol's queue.",
  ],
  restaking: [
    "Restaking (EigenLayer, and the liquid restaking tokens of ether.fi, Renzo, Kelp and Puffer) adds",
    "the risk of slashing to staking for extra rewards. A liquid restaking token can trade below its",
    "underlying, and withdraws through a queue.",
  ],
  staking: ["Olympus stakes OHM into its staked forms."],
  yield: [
    "- **Vaults** (Yearn V3, Beefy, Sommelier, Tokemak, Harvest; ERC-4626 where they follow it) take",
    "  a deposit and return shares whose value grows: measure shares and assets as deltas.",
    "- **Yield split** (Pendle): PT is the principal, redeemable at a fixed expiry, YT the yield until",
    "  then.",
    "- **Managed liquidity** (Gamma, Arrakis) runs concentrated-liquidity positions for you.",
    "- **Boosted LP** (Convex) stakes Curve LP tokens for boosted rewards.",
  ],
  perpetuals: [
    "Leveraged positions often execute in two steps: the program sends a request, and a keeper",
    "executes it later at a price it reads then (GMX's orders are this way). A program cannot see",
    "that fill in its own transaction, so it bounds the request (acceptable price, deadline) instead.",
  ],
  synthetics: [
    "Synthetix V3 takes collateral into an account and mints against it; positions and rewards are",
    "per account.",
  ],
  options: [
    "Options protocols (Premia, Hegic, Opyn, Thales, Aevo) settle at expiry or exercise; a program",
    "buys, exercises or settles a position it holds.",
  ],
  oracle: [
    "Chainlink feeds are read on chain (`latestRoundData`): check `updatedAt` against a staleness",
    "bound and scale by the feed's decimals. Pyth is pulled: the price is updated in the same",
    "transaction (`updatePriceFeeds`, paying its fee as value) before it is read.",
  ],
  payments: [
    "Sablier locks tokens into a schedule a recipient withdraws from; Superfluid streams Super Tokens",
    "per second, so tokens are wrapped into Super Tokens first.",
  ],
  "nft-marketplace": ["Seaport fills orders that makers signed off chain."],
  infrastructure: [
    "Standards and services a program calls directly: ERC-20 (Sauce's token writes are SafeERC20),",
    "ERC-4626 vaults, ERC-3156 flash loans, Permit2 (signed transfers and allowances), Safe accounts,",
    "ENS, Gelato automation, Instadapp flash-loan routing, and Eco Routes, the intents layer",
    "(`sauce-intents`).",
  ],
};

/** Chain-specific facts, each from a source the reader can check. */
const CHAIN_NOTES = {
  base: [
    "Base's own documentation: `eth_call` and `eth_estimateGas` against the `pending` block tag see",
    "Flashblocks state, so a read right after a send uses `pending` to see it.",
  ],
};

// ---- Rendering ------------------------------------------------------------------------------------

const code = (s) => `\`${s}\``;
const word = (address) => `${address}n`;

/** A Solana key the registry holds as 32 bytes of hex. */
const SVM_KEY = /^0x[0-9a-fA-F]{64}$/;
/** A Solana key in base58, as Solana writes it; a base58 key is returned as it is. */
const base58 = (key) =>
  SVM_KEY.test(key)
    ? getAddressDecoder().decode(Uint8Array.from(key.slice(2).match(/../g), (b) => parseInt(b, 16)))
    : key;
/**
 * An address in inline code, as its chain writes it. On Solana that is base58, and a key the
 * registry holds as hex keeps the hex beside it: the 32-byte value a program holds.
 */
const addressCode = (kind, value) =>
  kind === "svm" && SVM_KEY.test(value)
    ? `${code(base58(value))} (key ${code(value.toLowerCase())})`
    : code(value);
const kindName = (kind) => (kind === "svm" ? "Solana (SVM)" : "EVM");
const categoryName = (category) => CATEGORIES.find(([key]) => key === category)?.[1] ?? category;
const constName = (role) => role.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
const chainLink = (chain, from) =>
  `[${chain.name}](${from}sauce-chains/references/${chain.slug}.md)`;

/** How a program names a deployment: its namespace contract, or its ABI bound to the address. */
const spelling = (d) =>
  d.namespace !== undefined
    ? code(d.namespace)
    : d.abi !== undefined
      ? `${code(`${d.abi}.at(${word(d.address)})`)}`
      : "no registry ABI";

function renderGlobals(data) {
  const { globals } = data;
  const tokens = [
    HEADER,
    "",
    "# Token globals",
    "",
    "A program compiled for a chain names these symbols with no import; each is that chain's token,",
    "and amounts are in its smallest units (its decimals). Their addresses are in the chain's file in",
    "`sauce-chains`. Any other ERC-20 is `Token(<address>)`.",
    "",
  ];
  for (const entry of globals.tokens) {
    tokens.push(
      `- **${entry.chain.key}** (\`${entry.chain.slug}\`, [addresses](../../sauce-chains/references/${entry.chain.slug}.md)): ` +
        entry.tokens.map((t) => `\`${t.symbol}\` (${t.decimals})`).join(", "),
    );
  }
  if (globals.tokens.some((entry) => entry.chain.kind === "svm")) {
    tokens.push(
      "",
      "On Solana a symbol is the mint's 32-byte key, a value for the `@sauce/token` functions",
      "(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token",
      "methods (`USDC.transfer(...)`) are EVM-only. Devnet's mints, which differ, are in the Solana",
      "file in `sauce-chains`, passed as a define that wins over the symbol.",
    );
  }
  tokens.push(
    "",
    "## Token functions",
    "",
    "Every program can call these `@sauce/token` functions with no import. The EVM writes are",
    "SafeERC20: a token that returns nothing works, and one that returns `false` reverts.",
    "",
  );
  for (const module of globals.functions) {
    tokens.push(module.kind === "evm" ? "On EVM chains:" : "On Solana:", "");
    for (const fn of module.functions) tokens.push(`- \`${fn}\``);
    tokens.push("");
  }

  const protocols = [
    HEADER,
    "",
    "# Protocol globals",
    "",
    "A program names a contract as `Namespace.Contract`: its address where a value is expected, a",
    "bound contract where a method is called. Naming one that is not deployed on the program's chain",
    "is a compile error, unless `available(Namespace.Contract)` rules its branch out where the chain",
    "lacks it. Each contract is also the compile-time define `Namespace_Contract`. A",
    "namespace's default contract (marked) is also called as `Namespace.method(...)`. The chains each",
    "is deployed on, with its address there, are in the protocol's registry file in `sauce-protocols`",
    "and in each chain's file in `sauce-chains`.",
    "",
    "## Contracts",
    "",
  ];
  for (const contract of globals.contracts) {
    protocols.push(
      `- \`${contract.name}\` ([\`${contract.protocol}\`](../../sauce-protocols/references/registry/${contract.protocol}.md)` +
        `${contract.default ? ", default" : ""})`,
    );
  }
  protocols.push(
    "",
    "## Interfaces",
    "",
    "An interface is an ABI with no fixed address, the same on every EVM chain: a program binds it to",
    "an address it holds and calls a method in the same expression,",
    "`Namespace.Contract.at(address).method(...)`, such as a pool its factory returned.",
    "",
  );
  for (const one of globals.interfaces) {
    protocols.push(
      `- \`${one.name}.at(<address>)\` ([\`${one.protocol}\`](../../sauce-protocols/references/registry/${one.protocol}.md))`,
    );
  }
  protocols.push(
    "",
    "## Family aliases",
    "",
    "A family names a contract when exactly one of its members has it on the program's chain. Any",
    "other name, such as one that two members share, is ambiguous: name the versioned namespace.",
    "",
  );
  for (const alias of globals.aliases) {
    for (const { target, chains } of alias.targets) {
      protocols.push(`- \`${alias.name}\` → \`${target}\`: ${chains.join(", ")}`);
    }
  }
  protocols.push("");

  const chains = [
    HEADER,
    "",
    "# Chain globals",
    "",
    "A chain name opens an intent from inside a program (`Arbitrum(() => { ... }).reward({ ... })`) and",
    "qualifies a contract address (`Ethereum.UniswapV4.UniversalRouter`). An intent needs both chains",
    "to take intents; each line says whether its chain does. Each chain's file in `sauce-chains` has",
    "the rest.",
    "",
  ];
  for (const chain of globals.chains) {
    chains.push(
      `- \`${chain.key}\`: \`${chain.slug}\`, ${chain.id}, ${chain.kind.toUpperCase()}, ` +
        (chain.intents ? "takes intents" : "no intents"),
    );
  }
  chains.push("");

  return {
    "sauce-globals/references/tokens.md": tokens.join("\n"),
    "sauce-globals/references/protocols.md": protocols.join("\n"),
    "sauce-globals/references/chains.md": chains.join("\n"),
  };
}

/** A compiled example of the names a chain resolves, or none for a chain with none. */
function chainExample(chain) {
  const namespaced = chain.protocols.flatMap((p) => p.deployed.filter((d) => d.namespace));
  if (chain.tokens.length === 0 && namespaced.length === 0) return [];
  if (chain.kind === "svm") {
    // A Solana program reads a token account by the mint's key: the symbol is that key.
    const token = chain.tokens[0];
    if (token === undefined) return [];

    return [
      "## In a program",
      "",
      `Compiled with \`--chain ${chain.slug}\`, a program names ${chain.name}'s mints with no import: a`,
      "symbol is the mint's 32-byte key, a value the `@sauce/token` functions take. A token account",
      "is an `Account` parameter (`sauce-solana`).",
      "",
      `\`\`\`sauce chain=${chain.slug}`,
      "function main(account: Account): Uint256 {",
      `  // \`${token.symbol}\` is the mint \`${token.mint ?? base58(token.address)}\`, as the key \`${token.address}\`.`,
      `  return balanceOf(${token.symbol}, account);`,
      "}",
      "```",
      "",
    ];
  }
  const token = chain.tokens[0];
  const contract = namespaced[0];
  const body = [];
  if (token) {
    body.push(
      `  // \`${token.symbol}\` is ${chain.name}'s ${token.symbol}: \`${token.address}\`.`,
      `  const held = ${token.symbol}.balanceOf(ctx.self());`,
      `  // \`Token(address)\` is any other ERC-20, and works for a symbol's address too.`,
      `  require(Token(${token.symbol}).balanceOf(ctx.self()) == held);`,
    );
  }
  if (contract) {
    body.push(
      `  // \`${contract.namespace}\` is ${chain.name}'s ${contract.role}: \`${contract.address}\`.`,
      `  require(${contract.namespace} != 0n);`,
      `  // The same contract, qualified by the chain's name, from a program on any chain.`,
      `  require(${chain.key}.${contract.namespace} == ${contract.namespace});`,
    );
  }

  return [
    "## In a program",
    "",
    `Compiled with \`--chain ${chain.slug}\`, a program names ${chain.name}'s tokens and contracts with no`,
    "import; the same file compiled for another chain resolves each name there, or fails where the",
    "chain does not have it.",
    "",
    `\`\`\`sauce chain=${chain.slug}`,
    "function main() {",
    ...body,
    "}",
    "```",
    "",
  ];
}

function renderChain(chain) {
  const lines = [HEADER, "", `# ${chain.name}`, ""];
  lines.push(
    "| Fact | Value |",
    "| --- | --- |",
    `| Slug (\`--chain\`) | \`${chain.slug}\`${chain.aliases.length ? `; also ${chain.aliases.map(code).join(", ")}` : ""} |`,
    `| Chain id | ${chain.id} |`,
    `| Kind | ${kindName(chain.kind)} |`,
    `| Name in a program | \`${chain.key}\` |`,
    `| Native coin | ${chain.coin ? `${chain.coin.symbol} (${chain.coin.name}), ${chain.coin.decimals} decimals` : "not recorded"}${
      chain.native
        ? `; also the ERC-20 \`${chain.native.erc20}\` (${chain.native.erc20Decimals} decimals), one balance`
        : ""
    } |`,
  );
  if (chain.kind === "evm") {
    lines.push(
      `| Sauce engine | \`${chain.sauce.engine}\` |`,
      `| Sauce Kitchen | \`${chain.sauce.kitchen}\` |`,
      `| Sauce Router | \`${chain.sauce.router}\` |`,
    );
  } else {
    lines.push(
      `| Sauce engine program | ${addressCode(chain.kind, chain.sauce.engine)} |`,
      `| Sauce Kitchen program | ${addressCode(chain.kind, chain.sauce.kitchen)} |`,
    );
  }
  lines.push(
    `| Intents (eco-routes) | ${chain.intents ? `takes intents; Portal ${addressCode(chain.kind, chain.intents.portal)}` : "none recorded"} |`,
  );
  if (chain.intents?.executor) {
    lines.push(
      `| Intent Executor | ${addressCode(chain.kind, chain.intents.executor)} |`,
      `| Shared intent Pot | ${addressCode(chain.kind, chain.intents.pot)}: the Kitchen's \`deployPot(<Executor>, 0x0)\` creates it, from any account |`,
    );
  }
  if (chain.cctp !== undefined) lines.push(`| CCTP domain | ${chain.cctp} |`);
  lines.push("");
  if (CHAIN_NOTES[chain.slug]) lines.push("## Notes", "", ...CHAIN_NOTES[chain.slug], "");
  lines.push(...chainExample(chain));
  lines.push("## Tokens", "");
  if (chain.tokens.length === 0) {
    lines.push(
      chain.kind === "svm"
        ? "The registry names no token on this chain: a mint is a define, and a token account an `Account` parameter (`sauce-solana`)."
        : "The registry names no token on this chain: a program uses `Token(<address>)`.",
      "",
    );
  } else if (chain.kind === "svm") {
    const mints = (list) => [
      "| Symbol | Mint | Key, the value a program holds | Decimals |",
      "| --- | --- | --- | --- |",
      ...list.map(
        (t) =>
          `| \`${t.symbol}\` | \`${t.mint ?? base58(t.address)}\` | \`${t.address}\` | ${t.decimals} |`,
      ),
      "",
    ];
    lines.push(...mints(chain.tokens));
    if (chain.devnet.length > 0) {
      lines.push(
        "On devnet, pass a mint that differs as a define, which wins over the symbol",
        "(`--define USDC=<key>`):",
        "",
        ...mints(chain.devnet),
      );
    }
  } else {
    lines.push("| Symbol | Address | Decimals |", "| --- | --- | --- |");
    for (const t of chain.tokens)
      lines.push(`| \`${t.symbol}\` | \`${t.address}\` | ${t.decimals} |`);
    lines.push("");
  }
  lines.push("## Protocols", "");
  if (chain.protocols.length === 0) {
    lines.push("The registry records no protocol deployment on this chain.", "");
  } else {
    lines.push(
      "Every protocol the registry records here, each contract with how a program names it: its",
      "namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the",
      "address.",
      "",
      "| Protocol | Contract | Address | In a program |",
      "| --- | --- | --- | --- |",
    );
    for (const p of chain.protocols) {
      for (const d of p.deployed) {
        lines.push(
          `| [${p.name}](../../sauce-protocols/references/registry/${p.slug}.md) | ${d.role} | ${addressCode(chain.kind, d.address)} | ${spelling(d)} |`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderChainIndex(data) {
  const lines = [
    HEADER,
    "",
    "# Chains",
    "",
    "Every chain the SDK knows, with a file each: ids, native coin, the Sauce release, intents, its",
    "tokens and every protocol recorded there with its addresses.",
    "",
    "| Chain | Slug | Id | Kind | Intents | CCTP | Tokens | Protocols |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const chain of data.chains) {
    lines.push(
      `| [${chain.name}](${chain.slug}.md) | \`${chain.slug}\` | ${chain.id} | ${kindName(chain.kind)} | ${chain.intents ? "yes" : "no"} | ${chain.cctp ?? "—"} | ${chain.tokens.length} | ${chain.protocols.length} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

/** A compiled example of how a program names this protocol, on its first chain. */
function protocolExample(p, data) {
  const first = p.deployed.find((d) => d.namespace) ?? p.deployed.find((d) => d.abi);
  if (first === undefined) {
    const e = p.exports.find((x) => x.served);
    if (e === undefined) return [];
    const chain = data.chains.find((c) => c.kind === "evm");
    return [
      `The registry records no deployment: \`${e.name}\` is an interface, bound to an address the`,
      "program is given.",
      "",
      `\`\`\`sauce chain=${chain.slug}`,
      `import ${e.name} from "./protocols/${p.slug}/${e.name}.json";`,
      "",
      "const TARGET = 0n; // the contract's address, as a define",
      "",
      "function main() {",
      `  const target = ${e.name}.at(TARGET);`,
      "}",
      "```",
      "",
    ];
  }
  const chain = data.chains.find((c) => c.slug === first.chain);
  if (first.namespace) {
    return [
      `On ${chain.name}, \`${p.namespace.name}\` is a namespace: its contracts need no import.`,
      "",
      `\`\`\`sauce chain=${chain.slug}`,
      "function main() {",
      `  // ${chain.name}'s ${first.role}, \`${first.address}\`.`,
      `  require(${first.namespace} != 0n);`,
      "}",
      "```",
      "",
    ];
  }
  const constant = constName(first.role);
  return [
    `Where it is not a namespace, a program imports the ABI and binds it to the recorded address,`,
    `as a module constant a define can replace (here ${chain.name}'s ${first.role}):`,
    "",
    `\`\`\`sauce chain=${chain.slug}`,
    `import ${first.abi} from "./protocols/${p.slug}/${first.abi}.json";`,
    "",
    `const ${constant} = ${word(first.address)};`,
    "",
    "function main() {",
    `  const bound = ${first.abi}.at(${constant});`,
    "}",
    "```",
    "",
  ];
}

function renderProtocolRegistry(p, data) {
  const chainsBySlug = new Map(data.chains.map((c) => [c.slug, c]));
  const lines = [HEADER, "", `# ${p.name} (\`${p.slug}\`)`, "", p.description, ""];
  lines.push(
    "| Fact | Value |",
    "| --- | --- |",
    `| Category | ${categoryName(p.category)} |`,
    `| Family | ${p.family ? `\`${p.family}\`: ${data.familyMembers.get(p.family).map(code).join(", ")}` : "none"} |`,
    `| Namespace | ${p.namespace ? `\`${p.namespace.name}\` on ${p.namespace.chains.join(", ")}` : "none: import its ABI"} |`,
    `| Chains | ${p.chains.length ? p.chains.join(", ") : "none recorded"} |`,
    `| Document | ${p.documented ? `[${p.slug}.md](../${p.slug}.md): what it is for, how to choose it, its pitfalls` : "none"} |`,
    "",
    "## In a program",
    "",
    ...protocolExample(p, data),
  );
  if (p.deployed.length) {
    lines.push(
      "## Deployments",
      "",
      "| Chain | Contract | Address | In a program |",
      "| --- | --- | --- | --- |",
    );
    for (const d of p.deployed) {
      lines.push(
        `| ${chainLink(chainsBySlug.get(d.chain), "../../../")} | ${d.role} | ${addressCode(chainsBySlug.get(d.chain).kind, d.address)} | ${spelling(d)} |`,
      );
    }
    lines.push("");
  }
  if (p.exports.length) {
    lines.push("## ABI", "");
    for (const e of p.exports) {
      lines.push(
        `### \`${e.name}\``,
        "",
        (e.served
          ? `\`import ${e.name} from "./protocols/${p.slug}/${e.name}.json";\``
          : "Not served for import: a program calls it by selector.") +
          (e.roles.length ? ` Speaks for: ${e.roles.join(", ")}.` : ""),
        "",
        ...e.functions.map((f) => `- \`${f}\``),
        "",
      );
    }
  }

  return lines.join("\n");
}

function renderProtocolIndex(data) {
  const lines = [
    HEADER,
    "",
    "# Protocol index",
    "",
    "Every protocol the SDK registers, by category: how to choose between them, then each one with",
    "its family, whether a program names it as a namespace (and on which chains), and where it is",
    "deployed. Each protocol's registry file (`registry/<slug>.md`) has its addresses per chain, how a",
    "program names each contract, and its ABI functions; its document (`<slug>.md`) says what it is",
    "for and its pitfalls.",
    "",
  ];
  const named = new Map(CATEGORIES);
  const categories = [
    ...CATEGORIES.map(([category]) => category),
    ...[...new Set(data.protocols.map((p) => p.category))].filter((c) => !named.has(c)).sort(),
  ];
  for (const category of categories) {
    const members = data.protocols.filter((p) => p.category === category);
    if (members.length === 0) continue;
    lines.push(`## ${categoryName(category)} (${members.length})`, "");
    if (CHOOSING[category]) lines.push("### Choosing between them", "", ...CHOOSING[category], "");
    lines.push("| Protocol | Family | Namespace | Chains |", "| --- | --- | --- | --- |");
    for (const p of members) {
      const name = p.documented ? `[${p.name}](${p.slug}.md)` : p.name;
      lines.push(
        `| ${name} ([registry](registry/${p.slug}.md)) | ${p.family ? code(p.family) : "—"} | ${
          p.namespace ? `${code(p.namespace.name)}: ${p.namespace.chains.join(", ")}` : "—"
        } | ${p.chains.length ? p.chains.join(", ") : "none recorded"} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Every generated file's text, by path relative to the skills directory. */
export function renderSkillsReferences(data) {
  const files = {
    ...renderGlobals(data),
    "sauce-chains/references/index.md": renderChainIndex(data),
    "sauce-protocols/references/index.md": renderProtocolIndex(data),
  };
  for (const chain of data.chains)
    files[`sauce-chains/references/${chain.slug}.md`] = renderChain(chain);
  for (const p of data.protocols)
    files[`sauce-protocols/references/registry/${p.slug}.md`] = renderProtocolRegistry(p, data);

  return files;
}

// ---- Writing and checking -------------------------------------------------------------------------

/** The modules the generator reads, loaded from a built SDK root (`sdk/dist`, or an install's). */
export async function loadApi(importFrom) {
  return {
    sdk: await importFrom("index.js"),
    ecoRoutes: await importFrom("protocols/eco-routes/index.js"),
    deployments: await importFrom("deployments/index.js"),
    cctp: await importFrom("protocols/cctp/index.js"),
    compiler: await importFrom("compiler.js"),
    loadProtocol: (slug) => importFrom(`protocols/${slug}/index.js`),
  };
}

/** Each generated file as this repository's build would write it, whether it is stale, and the
 *  generated files on disk that no longer belong. */
export async function freshSkillsReferences(dir = SKILLS_DIR, sdkRoot = join(SDK, "dist")) {
  const api = await loadApi((path) => import(pathToFileURL(join(sdkRoot, path)).href));
  const documents = join(dir, "sauce-protocols", "references");
  const files = renderSkillsReferences(
    await skillsReferences(api, (slug) => existsSync(join(documents, `${slug}.md`))),
  );
  const extra = GENERATED_DIRS.flatMap((sub) =>
    existsSync(join(dir, sub))
      ? readdirSync(join(dir, sub))
          .filter((name) => name.endsWith(".md"))
          .map((name) => `${sub}/${name}`)
          .filter((path) => !(path in files))
      : [],
  );

  return {
    files: Object.entries(files).map(([name, text]) => {
      const path = join(dir, name);

      return { name, path, text, stale: !existsSync(path) || readFileSync(path, "utf8") !== text };
    }),
    extra: extra.map((name) => join(dir, name)),
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { files, extra } = await freshSkillsReferences();
  const stale = files.filter((file) => file.stale);
  if (process.argv.includes("--check")) {
    if (stale.length > 0 || extra.length > 0) {
      console.error(
        `gen-skills-references: stale ${[...stale.map((f) => f.path), ...extra].map((p) => relative(process.cwd(), p)).join(", ")}` +
          " — rebuild the SDK, or run `node scripts/gen-skills-references.mjs`, and commit the result.",
      );
      process.exit(1);
    }
  } else {
    for (const file of stale) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.text);
    }
    for (const path of extra) rmSync(path);
    console.log(
      `gen-skills-references: ${files.length} files under ${relative(process.cwd(), SKILLS_DIR)}` +
        ` (${stale.length} rewritten, ${extra.length} removed)`,
    );
  }
}
