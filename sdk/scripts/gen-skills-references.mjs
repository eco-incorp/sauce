#!/usr/bin/env node
// Every generated file of the agent skills and of the manual's reference, from the SDK's
// registries — ONE generator, so the views of the same facts cannot drift from each other or from
// the registry:
//
//   skills/sauce-globals/references/{tokens,stocks,protocols,chains}.md   the NAMES a program uses
//                                                                  with no import (no addresses)
//   skills/sauce-chains/references/index.md, <chain>.md            per chain: whether the release
//                                                                  supports it, ids, native coin,
//                                                                  intents, tokens and every protocol
//                                                                  with its addresses
//   skills/sauce-chains/references/<chain>-stocks.md               a chain's tokenized stocks, with
//                                                                  their addresses
//   skills/sauce-chains/references/deployments.json                the Sauce release's addresses, the
//                                                                  same on every chain: the skills'
//                                                                  one copy of them
//   skills/sauce-protocols/references/index.md                     every protocol by category, with
//                                                                  how to choose between them
//   skills/sauce-protocols/references/registry/<slug>.md           per protocol: its deployments per
//                                                                  chain, how a program names each,
//                                                                  and its ABI functions
//
// and the same chains and protocols for a human reader, under `docs/reference/`:
//
//   chains.md, chains/<chain>.md, chains/<chain>-stocks.md         the chain files, linked as pages
//   deployments.md                                                 the Sauce release: its versions and
//                                                                  addresses, the manual's one copy
//   protocols.md, protocols/<slug>.md                              the protocol index, and one page per
//                                                                  protocol: its registry facts with
//                                                                  its document folded in
//   tokens.md                                                      every chain's tokens and stocks
//   saucescript.md                                                 the SauceScript reference, the
//                                                                  `sauce-script` skill's file verbatim
//   ../guides/distributed-swap.md                                  the `sauce-distributed-swap` skill,
//                                                                  rendered as a guide
//   ../guides/solana-distributed-swap.md                           the `sauce-solana-distributed-swap`
//                                                                  skill and its venues reference
//   ../guides/solidity-examples.md                                 the protocols' own examples ported to
//                                                                  Sauce (`PORTED_EXAMPLES`): each
//                                                                  official source, its line counts
//                                                                  and the program's whole file
//
// The two audiences differ only in their links and in how they name what the other has: a skill
// names another skill (`sauce-swaps`), and a manual page links the page that covers it. The manual
// never links into `skills/`, and a skill never links the manual, so each stands alone: an agent
// with only the skills (over MCP, say) and a reader with only the manual both have every fact.
//
// ONE SOURCE. Names come from `routes.sourceGlobals(chain)`, the function `sauce globals` prints;
// protocols, their categories and deployments from `listProtocols()` and each `protocols/<slug>`
// module; the Sauce release from `/deployments`; intents from the eco-routes registry; which chains
// the `sauce` command supports, and how to request another, from the command's own
// `cli/support.js` (the package exports none of it). Which ABI
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
//   import { freshDocsReference }                                       for the docs checker
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getAddressDecoder, getAddressEncoder } from "@solana/kit";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The repository's skills directory. */
export const SKILLS_DIR = join(SDK, "..", "skills");
/** The manual's generated reference. */
export const DOCS_REFERENCE_DIR = join(SDK, "..", "docs", "reference");
const TARGETS = join(SDK, "test", "fixtures", "registry-abi", "targets.json");
/** The SauceScript reference: hand-written in its skill, and copied into the manual as it is. */
const BUILTINS = join(SKILLS_DIR, "sauce-script", "references", "builtins.md");

const HEADER = "<!-- Generated from the SDK's registries. Do not edit. -->";

/** The eco-routes namespace, which the globals index leaves to the intent syntax. */
const INTENT_PROTOCOL = "eco-routes";

/** Directories whose every `.md` file this generator owns (stale ones are removed). */
export const GENERATED_DIRS = ["sauce-chains/references", "sauce-protocols/references/registry"];
/** The same under the manual's reference, which is generated whole: a page written there by hand
 *  would be removed, so a hand-written reference page belongs in `docs/api/`. */
export const DOCS_GENERATED_DIRS = [".", "chains", "protocols"];
/** The generated pages outside `docs/reference/`: the distributed swaps, guides rendered from their
 *  skills, by path relative to `docs/reference/`. */
export const DISTRIBUTED_SWAP_GUIDE = "../guides/distributed-swap.md";
export const SOLANA_DISTRIBUTED_SWAP_GUIDE = "../guides/solana-distributed-swap.md";
/** The protocols' own examples ported to Sauce, as a guide. */
export const SOLIDITY_EXAMPLES_GUIDE = "../guides/solidity-examples.md";

/**
 * The example programs that port a protocol's own example, in the guide's order: the heading each
 * gets, and its file under `skills/`. Each file's header names its source in a `Ported from` line,
 * which the guide links; an example with such a line that is not listed here is an error.
 */
export const PORTED_EXAMPLES = [
  ["Uniswap V3: the swap examples", "sauce-swaps/examples/uniswap-v3-swap-examples.sauce.ts"],
  ["Uniswap V3: a flash, as a flash swap", "sauce-swaps/examples/uniswap-v3-pair-flash.sauce.ts"],
  [
    "Uniswap V3: the liquidity examples",
    "sauce-protocols/examples/uniswap-v3-liquidity-examples.sauce.ts",
  ],
];

// ---- The names a program uses: sauce globals ----------------------------------------------------

/**
 * The index of globals as data. `sdk` is the package root module and `ecoRoutes` its
 * `protocols/eco-routes` module — passed in, so the skills checker can index the SDK it loaded
 * (an installed package, say) rather than this repository's build.
 */
export function globalsIndex(sdk, ecoRoutes, support) {
  const { routes, CANONICAL_CHAINS, nativeErc20, getChain } = sdk;
  const { chainSupport } = support;
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

      // Solana's are mints: the base58 address beside the 32-byte key a program holds, and the
      // token program that owns the mint. A tokenized stock carries its issuer, name and ticker,
      // and on Solana whether its issuer's mints charge a transfer fee.
      const row = ({ symbol, address, decimals, mint, tokenProgram, stock }) => ({
        symbol,
        address,
        decimals,
        ...(mint === undefined ? {} : { mint }),
        ...(tokenProgram === undefined ? {} : { tokenProgram }),
        ...(stock === undefined
          ? {}
          : {
              stock: {
                ...stock,
                issuer: routes.STOCK_ISSUERS[stock.issuer].name,
                ...(chain.kind === "svm"
                  ? { transferFee: routes.STOCK_ISSUERS[stock.issuer].transferFee === true }
                  : {}),
              },
            }),
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
        // `Arbitrum.hop({ ... }).then(...)` (`sauce-intents`), never by calling them by name.
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
    .map((chain) => ({
      ...chain,
      intents: intents(chain.slug),
      support: chainSupport(chain.slug),
    }));

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
  // address it holds, `Namespace.Contract(address).method(...)`. The first method whose inputs
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
 * support, loadProtocol(slug) }` — modules the caller loaded, so the checker can pass the installed
 * package's; `support` is the `sauce` command's `cli/support.js` — and `documented(slug)` says
 * whether the skill carries that protocol's document.
 */
export async function skillsReferences(api, documented) {
  const { sdk, ecoRoutes, deployments, cctp, compiler, support, loadProtocol } = api;
  // An export a program can import: the compile serves `./protocols/<slug>/<Export>.json`.
  const served = (slug, name) =>
    compiler.resolveSdkModule(`./protocols/${slug}/${name}.json`) !== undefined;
  const targets = JSON.parse(readFileSync(TARGETS, "utf8")).protocols;
  const globals = globalsIndex(sdk, ecoRoutes, support);
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
      support: support.chainSupport(chain.slug),
      request: support.chainSupportRequest(chain.slug),
      key: names.chain.key,
      // Whether the package root exports the chain by that name, for TypeScript.
      exported: sdk[names.chain.key] !== undefined,
      aliases: chain.aliases ?? [],
      coin,
      native: tokens?.native,
      tokens: tokens?.tokens ?? [],
      devnet: tokens?.devnet ?? [],
      intents,
      cctp: cctp.CCTP_DOMAIN?.[chain.slug],
      protocols: protocols
        .filter((p) => p.chains.includes(chain.slug))
        .map((p) => ({ ...p, deployed: p.deployed.filter((d) => d.chain === chain.slug) })),
    };
  });

  // The Sauce release: one address per contract on every EVM chain and one id per program on every
  // Solana cluster, so it is rendered once (deployments.json, deployments.md) and never per chain.
  // The shared intent Pot is the Kitchen's Pot for the eco-routes Executor under salt zero: one
  // Executor serves every chain that takes intents, so one Pot does, and a chain's file names its
  // Executor.
  const release = deployments.v12DeployedAddresses();
  const intentPots = new Map(
    chains.filter((c) => c.intents?.executor).map((c) => [c.intents.pot, c.intents.executor]),
  );
  if (intentPots.size !== 1) {
    throw new Error(
      `eco-routes records ${intentPots.size} shared intent Pots (${[...intentPots.keys()].join(", ")}): ` +
        "the deployments file gives one, so give it one per Executor and say so in each chain's file",
    );
  }
  const [[intentPot, intentPotOwner]] = intentPots;
  const { contracts } = release.evm;

  return {
    globals,
    chains,
    protocols,
    familyMembers,
    // What an intent's modifiers are when they are left out: the SDK's own constants.
    intentDefaults: {
      fill: sdk.routes.DEFAULT_FILL_WINDOW,
      refund: sdk.routes.DEFAULT_REFUND_WINDOW,
    },
    deployments: {
      compiler: release.compiler,
      releases: release.releases,
      evm: {
        engine: contracts.engine.address,
        kitchen: contracts.kitchen.address,
        kitchenImplementation: contracts.kitchenImplementation.address,
        router: contracts.router.address,
        routerGeneration: contracts.router.generation,
        quoteRouter: contracts.quoteRouter.address,
        quoteRouterGeneration: contracts.quoteRouter.generation,
        potInitCodeHash: release.evm.pot.initCodeHash,
        intentPot: { address: intentPot, owner: intentPotOwner, salt: sdk.SAUCE_INTENT_POT_SALT },
      },
      svm: {
        engine: release.svm.programs.engine.programId,
        kitchen: release.svm.programs.kitchen.programId,
      },
    },
    support: {
      supported: support.supportedChains().map((chain) => ({ slug: chain.slug, name: chain.name })),
      newIssue: support.CHAIN_SUPPORT_NEW_ISSUE_URL,
      issues: support.CHAIN_SUPPORT_ISSUES_URL,
    },
  };
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
    "Inside a Sauce program, swap with `@sauce/router`'s function for the venue (`sauce-swaps`), every",
    "argument a run-time value, each returning what the recipient received and reverting below its",
    "`minOut`. `uniswapV2` (Uniswap V2 and its forks' pairs), `curve`, `balancerV2`, `dodoV2`,",
    "`traderJoeLB` and `woofi` pay the pool first and call it directly; `uniswapV3` (Uniswap V3 and its",
    "forks: PancakeSwap V3, Aerodrome Slipstream, Algebra pools, Synthra, UnitFlow), `uniswapV4` and",
    "`maverickV2` go through the Pot's Router, which answers the pool's callback. Choose by pool type:",
    "",
    "- **Concentrated liquidity** (V3-style pools through `uniswapV3`, V4 pools through `uniswapV4`):",
    "  the deepest pools for liquid pairs, several fee tiers per pair, and a price limit, so a fill can",
    "  stop part way and leave the rest unspent.",
    "- **Constant-product pairs** (Uniswap V2 and its forks through `uniswapV2`, Solidly-style volatile",
    "  pools): one pool per pair, no price limit; a swap consumes its whole input, bounded only by its",
    "  `minOut`.",
    "- **Stable pools** (Curve through `curve`, Solidly-style stable pools): built for assets meant to",
    "  trade near 1:1, with less price impact there than a constant-product pair.",
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
  arc: [
    "Arc pays gas in USDC, and has one USDC balance at two decimal scales: the native coin",
    "(`msg.value`, `eth_getBalance`, gas) has 18 decimals, and the ERC-20 `USDC` at",
    "`0x3600000000000000000000000000000000000000` has 6. Sending native value and calling",
    "`USDC.transfer` move the same money.",
    "",
    "- A Pot that spends its whole `USDC` balance and also pays a native fee (a bridge's or a",
    "  messenger's fee, the Kitchen's execution fee) runs out: the fee comes from the same balance.",
    "  Leave room for it.",
    "- `balanceOf` is the native balance divided by 10^12 and rounded down, so less than 10^12 wei",
    "  reads as 0. Compare a native amount with a token amount only after converting one to the",
    "  other's scale.",
    "- Every native amount has 18 decimals: an execution fee, a cook's value, the `nativeAmount` of a",
    "  route or a reward. `1_000_000` of native value is 10^-12 USDC, not 1 USDC.",
    "- The minimum base fee is 20 gwei, and a transaction whose `maxFeePerGas` is below it is dropped",
    "  silently: no error, and no receipt.",
    "- There is no canonical wrapped native, and nothing needs wrapping. `WETH` is bridged ETH, with no",
    "  `deposit()` or `withdraw()`, and Uniswap's Arc periphery reports a `WETH9()` that always",
    "  reverts, so the ETH paths of its routers revert too. Wrapping, unwrapping and staking the",
    "  native coin are refused for Arc.",
    "- Native value sent to the zero address, to or from a blocklisted address, or to a",
    "  self-destructed account reverts, also when a contract forwards it.",
    "- A hop's `send`, the intent's reward, offers native value or `USDC`, not both: Arc's Portal",
    "  takes them for one asset and reverts `RewardTokensNotUnique(USDC)`, so the SDK refuses such a",
    "  `send` when it is built. Fold the two into one amount.",
  ],
  base: [
    "Base's own documentation: `eth_call` and `eth_estimateGas` against the `pending` block tag see",
    "Flashblocks state, so a read right after a send uses `pending` to see it.",
  ],
};

// ---- Rendering ------------------------------------------------------------------------------------

const code = (s) => `\`${s}\``;
/** Text for a table cell: a `|` would end it. */
const cell = (s) => s.replaceAll("|", "\\|");

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
/** A Solana mint's token program, by name and address: what a write's `tokenProgram` account is. */
const tokenProgramName = (program) =>
  program === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    ? `Token-2022 (\`${program}\`)`
    : `SPL Token (\`${program}\`)`;
/** Whether a transfer of a Solana stock mint pays its issuer's fee, as a table cell. */
const transferFee = (t) => (t.stock.transferFee ? "yes: the recipient gets less" : "none");
const categoryName = (category) => CATEGORIES.find(([key]) => key === category)?.[1] ?? category;
const constName = (role) => role.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

// ---- The two audiences ------------------------------------------------------------------------------

/**
 * Where an audience's pages live, each path relative to its root (`skills/`, `docs/reference/`),
 * and how its prose names what the other audience has.
 */
const SKILLS_SITE = {
  chainIndex: "sauce-chains/references/index.md",
  chain: (slug) => `sauce-chains/references/${slug}.md`,
  chainStocks: (slug) => `sauce-chains/references/${slug}-stocks.md`,
  protocolIndex: "sauce-protocols/references/index.md",
  protocol: (slug) => `sauce-protocols/references/registry/${slug}.md`,
  /** The Sauce release, the same on every chain: the one file with its addresses. */
  deployments: "sauce-chains/references/deployments.json",
  /** A protocol's hand-written document, a file of its own beside its registry file. */
  document: (slug) => `sauce-protocols/references/${slug}.md`,
  /** A skill names another skill as it is. */
  prose: (lines) => lines,
  /** A file a skill links is named by its file name. */
  label: (file) => posix.basename(file),
  noun: "file",
};

/**
 * What the manual links where a skill names a skill: the page that covers the same ground, by
 * path relative to `docs/`. A skill with no such page is named as the agent skill it is.
 */
const DOCS_FOR_SKILL = {
  "sauce-overview": ["the documentation", "README.md"],
  "sauce-script": ["the SauceScript reference", "reference/saucescript.md"],
  "sauce-globals": ["tokens", "reference/tokens.md"],
  "sauce-chains": ["chains", "reference/chains.md"],
  "sauce-protocols": ["protocols", "reference/protocols.md"],
  "sauce-swaps": ["the `@sauce/router` reference", "api/router.md"],
  "sauce-distributed-swap": ["the distributed swap", "guides/distributed-swap.md"],
  "sauce-solana-distributed-swap": [
    "the distributed swap on Solana",
    "guides/solana-distributed-swap.md",
  ],
  "sauce-intents": ["intents", "guides/intents.md"],
  "sauce-solana": ["Solana", "guides/solana.md"],
  "sauce-cli": ["the sauce command", "guides/cli.md"],
  "sauce-actions": ["actions", "guides/actions.md"],
  "sauce-typescript": ["the API reference", "api/README.md"],
  "sauce-examples": ["the examples", "examples/README.md"],
};

/**
 * Prose written for the skills, as the manual page at `from` (relative to `docs/reference/`) says
 * it: each skill name becomes a link to the page covering it. Fenced code is left as it is, but for
 * its fence: a ```` ```sauce chain=… ```` block, which the skills checker compiles, is TypeScript
 * syntax to a reader's highlighter.
 */
function docsProse(lines, from) {
  let fenced = false;

  return lines.map((line) => {
    if (line.startsWith("```")) {
      fenced = !fenced;

      return line.replace(/^```sauce\b.*$/, "```ts");
    }
    if (fenced) return line;

    return line.replace(/`(sauce-[a-z-]+)`/g, (whole, skill) => {
      const page = DOCS_FOR_SKILL[skill];
      if (page === undefined) return `the ${whole} agent skill`;
      const href = posix.relative(posix.dirname(`reference/${from}`), page[1]);

      return `[${page[0]}](${href})`;
    });
  });
}

const DOCS_SITE = {
  chainIndex: "chains.md",
  chain: (slug) => `chains/${slug}.md`,
  chainStocks: (slug) => `chains/${slug}-stocks.md`,
  protocolIndex: "protocols.md",
  protocol: (slug) => `protocols/${slug}.md`,
  deployments: "deployments.md",
  /** A protocol's document is folded into its page. */
  document: undefined,
  prose: docsProse,
  /** A page the manual links is named by its title. */
  label: (_file, title) => title,
  noun: "page",
  /** What a reader of the manual also needs about the release's chains. */
  chainIndexNotes: [
    "On a preview chain the `sauce` command and the MCP server still rehearse and read:",
    "`sauce simulate`, `sauce intent publish --dry-run`, `sauce intent fill` without `--send`, and",
    "every read. What they refuse there, before any endpoint is reached or any key is read, is",
    "building or sending a transaction; [the command's](../guides/cli.md#supported-and-preview-chains)",
    "and [the server's](../guides/mcp.md#supported-and-preview-chains) lists name each one. An intent",
    "publishes only when its source and every destination it opens are supported; the later levels",
    "of a cascade (an intent opened inside another's body) are not checked, so keep every level on a",
    "supported chain. Each step after publishing is refused by the chain it is sent on: a fill, a",
    "proof or a cancellation by the destination, a claim or a refund by the source. Every refusal",
    "names the supported chains, and the MCP server's `sauce_chains` gives each chain's support.",
    "",
    "The TypeScript SDK is not gated: its builders take every chain below and build its",
    "transactions, and an integrator who submits one on a preview chain does so at their own risk.",
    "",
    "A chain-support request gives the chain and its id, what you want to run there, the protocols",
    "and tokens it needs, the volume you expect and from when, and optionally how to reach you. Where",
    "a request for the chain exists, add your use case to it as a comment instead of opening another.",
    "A refusal links both, prefilled for the chain it refused.",
    "",
  ],
};

/** A link from the page at `from` to the page at `to`, both relative to the same root. */
const href = (from, to) => posix.relative(posix.dirname(from), to);
const chainLink = (site, from, chain) => `[${chain.name}](${href(from, site.chain(chain.slug))})`;

/** How a program names a deployment: its namespace contract, or its ABI bound to the address. */
const spelling = (d) =>
  d.namespace !== undefined
    ? code(d.namespace)
    : d.abi !== undefined
      ? `${code(`${d.abi}.at(${d.address})`)}`
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
    const stocks = entry.tokens.filter((t) => t.stock).length;
    tokens.push(
      `- **${entry.chain.key}** (\`${entry.chain.slug}\`, [addresses](../../sauce-chains/references/${entry.chain.slug}.md)): ` +
        entry.tokens
          .filter((t) => !t.stock)
          .map((t) => `\`${t.symbol}\` (${t.decimals})`)
          .join(", ") +
        (stocks ? `; and ${stocks} tokenized stocks ([stocks](stocks.md))` : ""),
    );
  }
  if (globals.tokens.some((entry) => entry.chain.kind === "svm")) {
    tokens.push(
      "",
      "On Solana a symbol is the mint's 32-byte key, a value for the `@sauce/token` functions",
      "(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token",
      "methods (`USDC.transfer(...)`) are EVM-only. Devnet's mints, which differ, are in the Solana",
      "file in `sauce-chains`; a program for devnet takes its mint as an `Address` parameter of",
      "`main`. That file also names each mint's token program: legacy SPL Token, or Token-2022, whose",
      "mints a program moves with the checked writes (`sauce-solana`).",
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
    "bound contract where a method is called. One that is not deployed on the program's chain is",
    "`undefined` there: a use of it is a compile error, unless a test (`if (Namespace.Contract)`) rules",
    "its branch out where the chain lacks it. Each contract is also the compile-time value `Namespace_Contract`. A",
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
    "`Namespace.Contract(address).method(...)` (or `.at(address)`), such as a pool its factory",
    "returned.",
    "",
  );
  for (const one of globals.interfaces) {
    protocols.push(
      `- \`${one.name}(<address>)\` ([\`${one.protocol}\`](../../sauce-protocols/references/registry/${one.protocol}.md))`,
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
    "A chain name is its chain id, so `chainId == Ethereum` is decided while compiling and a program",
    "keeps only the branch of the chain it is compiled for. It opens an intent from inside a program",
    "(`Ethereum.hop({ send, receive, refundee }).then(() => { … })`) and qualifies a contract",
    "address (`Ethereum.UniswapV4.UniversalRouter`). An intent needs both chains",
    "to take intents; each line says whether its chain does. Each line also says whether the initial",
    "release supports the chain: a program compiles and simulates on every chain, and its transactions",
    "are built and sent only on a supported one; on a preview chain the `sauce` command and the MCP",
    "server refuse them. Each chain's file in `sauce-chains` has the rest, and how to request a",
    "preview chain.",
    "",
  ];
  for (const chain of globals.chains) {
    chains.push(
      `- \`${chain.key}\`: \`${chain.slug}\`, ${chain.id}, ${chain.kind.toUpperCase()}, ` +
        `${chain.intents ? "takes intents" : "no intents"}, ${chain.support}`,
    );
  }
  chains.push("");

  const stocks = [
    HEADER,
    "",
    "# Stock tokens",
    "",
    "A tokenized stock is a token like any other: a program compiled for its chain names it by its",
    "symbol with no import (`SPCXc.balanceOf(ctx.self())` on Base), and amounts are in its smallest",
    "units (its decimals). The symbol is the issuer's own ticker for the token, with a `.` written",
    "`_` (`BRK.Bx` is `BRK_Bx`). Their addresses are in the chain's stocks file in `sauce-chains`.",
    "",
    "Any contract can hold, receive and send them, a program's Pot included; an issuer can pause its",
    "token or refuse a sanctioned address. Backed's (its xStocks, and bTokens such as `bTSLA`)",
    "rebase: a balance can change between transactions, never within one, and a transfer can credit",
    "one unit less than sent, so paying one into a pool that checks what it received can fail (buying",
    "one is unaffected). Coinbase's are B20 tokens, built into the Base node: they run on Base, and",
    "not in a local copy of the chain.",
    "",
    "On Solana each is a Token-2022 mint: the symbol is the mint's 32-byte key, a value for the",
    "`@sauce/token` functions (`balanceOf(TSLAx, account)`), and a program moves one with the checked",
    "writes (`transferChecked`), which take the mint, its token program and its decimals. Amounts are",
    "raw: the issuer's multiplier, which a wallet shows them times, does not apply to them. A mint",
    "marked with a transfer fee (PreStocks') keeps part of every transfer, so the recipient gets less",
    "than was sent: measure the balance change. The rest is in the skill's",
    "[Tokenized stocks](../SKILL.md#tokenized-stocks).",
    "",
  ];
  for (const entry of globals.tokens) {
    const listed = entry.tokens.filter((t) => t.stock);
    if (listed.length === 0) continue;
    // A Solana mint says whether a transfer of it pays a fee.
    const svm = entry.chain.kind === "svm";
    stocks.push(
      `## ${entry.chain.key} (\`${entry.chain.slug}\`, [addresses](../../sauce-chains/references/${entry.chain.slug}-stocks.md))`,
      "",
      `| Symbol | Token | Ticker | Issuer | Decimals |${svm ? " Transfer fee |" : ""}`,
      `| --- | --- | --- | --- | --- |${svm ? " --- |" : ""}`,
      ...listed.map(
        (t) =>
          `| \`${t.symbol}\` | ${cell(t.stock.name)} | ${cell(t.stock.ticker)} | ${t.stock.issuer} | ${t.decimals} |` +
          (svm ? ` ${transferFee(t)} |` : ""),
      ),
      "",
    );
  }

  return {
    "sauce-globals/references/tokens.md": tokens.join("\n"),
    "sauce-globals/references/stocks.md": stocks.join("\n"),
    "sauce-globals/references/protocols.md": protocols.join("\n"),
    "sauce-globals/references/chains.md": chains.join("\n"),
  };
}

/** A compiled example of the names a chain resolves, or none for a chain with none. */
function chainExample(chain) {
  const namespaced = chain.protocols.flatMap((p) => p.deployed.filter((d) => d.namespace));
  if (chain.tokens.length === 0 && namespaced.length === 0) return [];
  if (chain.kind === "svm") {
    // A Solana program reads a token account by the mint's key: the symbol is that key. USDC where
    // the chain has it, so the example does not move as mints are added.
    const token = chain.tokens.find((t) => t.symbol === "USDC") ?? chain.tokens[0];
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
  // A tokenized stock is a token like any other, but not the one a chain's example should show.
  const token = chain.tokens.find((t) => !t.stock);
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
      `  require(${contract.namespace} != 0);`,
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

/** What a chain's support level means, said at the top of its file. */
function supportLines(chain, supported) {
  const names = andList(supported.map((c) => c.name));
  if (chain.support === "supported") {
    return [
      `**Supported.** For the initial release, Sauce supports transactions on ${names}. On`,
      `${chain.name} a program compiles and simulates, and the \`sauce\` command and the MCP server build`,
      "its transactions and send them.",
      "",
    ];
  }

  return [
    `**Preview chain.** For the initial release, Sauce supports transactions on ${names} only.`,
    `On ${chain.name} a program compiles and simulates (\`sauce compile\`, \`sauce simulate\`, the dry`,
    "runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,",
    "`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are",
    "refused, naming the supported chains and how to request this one.",
    "",
    `To request ${chain.name}, look for [its existing request](${chain.request.searchUrl}) and add your`,
    `use case to it, or [open one](${chain.request.newIssueUrl}) with the chain-support issue form.`,
    "",
  ];
}

/** `["a", "b", "c"]` as "a, b and c". */
const andList = (words) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

function renderChain(chain, supported, site) {
  const path = site.chain(chain.slug);
  const lines = [HEADER, "", `# ${chain.name}`, "", ...supportLines(chain, supported)];
  lines.push(
    "| Fact | Value |",
    "| --- | --- |",
    `| Support | ${chain.support === "supported" ? "supported: transactions are built and sent" : "preview: compile and simulate; no transaction is built or sent"} |`,
    `| Slug (\`--chain\`) | \`${chain.slug}\`${chain.aliases.length ? `; also ${chain.aliases.map(code).join(", ")}` : ""} |`,
    `| Chain id | ${chain.id} |`,
    `| Kind | ${kindName(chain.kind)} |`,
    `| Name in a program | \`${chain.key}\` |`,
  );
  // The manual also serves TypeScript: the chain's export carries the same names.
  if (site === DOCS_SITE && chain.exported) {
    lines.push(
      `| In TypeScript | \`import { ${chain.key} } from "@eco-incorp/sauce"\`: its tokens and protocol namespaces are properties of it |`,
    );
  }
  lines.push(
    `| Native coin | ${chain.coin ? `${chain.coin.symbol} (${chain.coin.name}), ${chain.coin.decimals} decimals` : "not recorded"}${
      chain.native
        ? `; also the ERC-20 \`${chain.native.erc20}\` (${chain.native.erc20Decimals} decimals), one balance`
        : ""
    } |`,
  );
  // The release is the same on every chain, so a chain's file points at the one place it is listed.
  const deployments = `[${site.label(site.deployments, "Deployments")}](${href(path, site.deployments)})`;
  lines.push(
    chain.kind === "evm"
      ? `| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: ${deployments}${site === SKILLS_SITE ? " (`evm`)" : ""} |`
      : `| Sauce | the engine and Kitchen programs, the same ids on every cluster: ${deployments}${site === SKILLS_SITE ? " (`svm`)" : ""} |`,
    `| Intents (eco-routes) | ${chain.intents ? `takes intents; Portal ${addressCode(chain.kind, chain.intents.portal)}` : "none recorded"} |`,
  );
  if (chain.intents?.executor) {
    const intentPot =
      site === SKILLS_SITE
        ? `${deployments} (\`evm.intentPot\`)`
        : `[Deployments](${href(path, site.deployments)}#the-shared-intent-pot)`;
    lines.push(
      `| Intent Executor | ${addressCode(chain.kind, chain.intents.executor)} |`,
      `| Shared intent Pot | the Executor's Pot under salt zero, the same on every chain: ${intentPot}; the Kitchen's \`deployPot(<Executor>, 0x0)\` creates it, from any account |`,
    );
  }
  if (chain.cctp !== undefined) lines.push(`| CCTP domain | ${chain.cctp} |`);
  lines.push("");
  if (CHAIN_NOTES[chain.slug]) lines.push("## Notes", "", ...CHAIN_NOTES[chain.slug], "");
  lines.push(...chainExample(chain));
  lines.push("## Tokens", "");
  const stocksLink = `[${site.label(site.chainStocks(chain.slug), `${chain.name} stock tokens`)}](${href(path, site.chainStocks(chain.slug))})`;
  if (chain.tokens.length === 0) {
    lines.push(
      chain.kind === "svm"
        ? "The registry names no token on this chain: a mint is a define, and a token account an `Account` parameter (`sauce-solana`)."
        : "The registry names no token on this chain: a program uses `Token(<address>)`.",
      "",
    );
  } else if (chain.kind === "svm") {
    const mints = (list) => [
      "| Symbol | Mint | Key, the value a program holds | Decimals | Token program |",
      "| --- | --- | --- | --- | --- |",
      ...list.map(
        (t) =>
          `| \`${t.symbol}\` | \`${t.mint ?? base58(t.address)}\` | \`${t.address}\` | ${t.decimals} | ${tokenProgramName(t.tokenProgram)} |`,
      ),
      "",
    ];
    // Its tokenized stocks, over a thousand mints, are in a file of their own.
    const stocks = chain.tokens.filter((t) => t.stock).length;
    lines.push(...mints(chain.tokens.filter((t) => !t.stock)));
    if (stocks) {
      lines.push(
        `And ${stocks} tokenized stocks, each a Token-2022 mint named by its symbol in the same way:`,
        `they are in ${stocksLink}, with their mints.`,
        "",
      );
    }
    if (chain.devnet.length > 0) {
      lines.push(
        "On devnet these mints differ: a program for devnet takes its mint as an `Address` parameter",
        "of `main`, given to `--args` as the mint's base58 address:",
        "",
        ...mints(chain.devnet),
      );
    }
  } else {
    const stocks = chain.tokens.filter((t) => t.stock).length;
    lines.push("| Symbol | Address | Decimals |", "| --- | --- | --- |");
    for (const t of chain.tokens.filter((t) => !t.stock))
      lines.push(`| \`${t.symbol}\` | \`${t.address}\` | ${t.decimals} |`);
    lines.push("");
    if (stocks) {
      lines.push(
        `And ${stocks} tokenized stocks, each named by its symbol in the same way: they are in`,
        `${stocksLink}, with their addresses.`,
        "",
      );
    }
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
          `| [${p.name}](${href(path, site.protocol(p.slug))}) | ${d.role} | ${addressCode(chain.kind, d.address)} | ${spelling(d)} |`,
        );
      }
    }
    lines.push("");
  }

  return site.prose(lines, path).join("\n");
}

function renderChainStocks(chain, site) {
  const path = site.chainStocks(chain.slug);
  const chainPage = `[${site.label(site.chain(chain.slug), chain.name)}](${href(path, site.chain(chain.slug))})`;
  const listed = chain.tokens.filter((t) => t.stock);
  if (chain.kind === "svm") {
    const lines = [
      HEADER,
      "",
      `# ${chain.name} stock tokens`,
      "",
      `Every tokenized stock a program compiled for \`${chain.slug}\` names by its symbol, with its`,
      `mint. Each is a Token-2022 mint (${tokenProgramName(listed[0].tokenProgram)}), whose writes`,
      "are the checked ones, and the symbol is the mint's key, the value a program holds.",
      `${chainPage} has the chain's other mints; \`sauce-globals\` has what a`,
      "stock token is and how its symbol is spelled. A transfer of a mint with a fee pays it out of",
      "what was sent: the recipient gets less.",
      "",
      "| Symbol | Token | Issuer | Mint | Key, the value a program holds | Decimals | Transfer fee |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...listed.map(
        (t) =>
          `| \`${t.symbol}\` | ${cell(t.stock.name)} | ${t.stock.issuer} | \`${t.mint}\` | \`${t.address}\` | ${t.decimals} | ${transferFee(t)} |`,
      ),
      "",
    ];

    return site.prose(lines, path).join("\n");
  }
  const lines = [
    HEADER,
    "",
    `# ${chain.name} stock tokens`,
    "",
    `Every tokenized stock a program compiled for \`${chain.slug}\` names by its symbol, with its`,
    `address. ${chainPage} has the chain's other tokens and its contracts;`,
    "`sauce-globals` has what a stock token is and how its symbol is spelled.",
    "",
    "| Symbol | Token | Issuer | Address | Decimals |",
    "| --- | --- | --- | --- | --- |",
    ...listed.map(
      (t) =>
        `| \`${t.symbol}\` | ${cell(t.stock.name)} | ${t.stock.issuer} | \`${t.address}\` | ${t.decimals} |`,
    ),
    "",
  ];

  return site.prose(lines, path).join("\n");
}

/** A Solana program id as the 32-byte hex key a program holds. */
const svmKey = (programId) =>
  `0x${[...getAddressEncoder().encode(programId)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

const CONFIRM_CODE =
  "An address is where the contract is deployed, not proof that it is there: before relying on one, " +
  "confirm it has code on the chain (eth_getCode returns more than 0x; on Solana, getAccountInfo " +
  "returns an executable account).";

/**
 * The Sauce release's addresses as the skills' one file of them, `deployments.json`: data an agent
 * reads (over MCP too), each entry with what it is. No version: the skills state no release.
 */
function renderDeploymentsJson(data) {
  const { evm, svm } = data.deployments;
  const document = {
    about: `The Sauce deployment, the same on every chain: one address per contract on every EVM chain, and one id per program on every Solana cluster. ${CONFIRM_CODE}`,
    evm: {
      engine: {
        address: evm.engine,
        about:
          "The engine, the interpreter that runs a program. A cook is the Pot's cook(engine, program), sent by the Pot's owner.",
      },
      kitchen: {
        address: evm.kitchen,
        about:
          "The Kitchen: deployPot(owner, salt) creates a Pot, and executionFee() is the fee every cook pays, in the chain's native coin.",
      },
      kitchenImplementation: {
        address: evm.kitchenImplementation,
        about:
          "The implementation behind the Kitchen, an upgradeable proxy. Call the Kitchen, never this.",
      },
      router: {
        address: evm.router,
        about:
          "The Router a new Pot starts on. The swaps a pool calls back for (Uniswap V3 and V4, Maverick V2) run through the Pot's Router.",
      },
      quoteRouter: {
        address: evm.quoteRouter,
        about:
          "A quote service for Uniswap V3 and V4 swaps, called with eth_call, holding no tokens. No Pot's Router.",
      },
      pot: {
        address: "CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)",
        initCodeHash: evm.potInitCodeHash,
        about:
          "Where the Kitchen deploys the Pot of an owner under a 32-byte salt, zero unless another is chosen.",
      },
      intentPot: {
        address: evm.intentPot.address,
        owner: evm.intentPot.owner,
        salt: evm.intentPot.salt,
        about:
          "The shared Pot an intent's program body cooks on, on every EVM chain that takes intents: the Pot of the eco-routes Executor (owner) under salt zero. The Kitchen's deployPot(owner, salt) creates it, from any account.",
      },
    },
    svm: {
      engine: {
        programId: svm.engine,
        key: svmKey(svm.engine),
        about:
          "The engine program, which owns every Pot: ctx.self() in a program on Solana. key is the 32-byte value a program holds.",
      },
      kitchen: {
        programId: svm.kitchen,
        key: svmKey(svm.kitchen),
        about:
          'The Kitchen program: create_pot creates a Pot, and cook runs a program on it. A Pot is the Kitchen\'s program address for the seeds "pot", the owner and the 32-byte salt. key is the 32-byte value a program holds.',
      },
    },
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The same release for a reader of the manual: the one page that lists its addresses, and its
 *  versions. */
function renderDeploymentsPage(data) {
  const { compiler, releases, evm, svm } = data.deployments;
  const lines = [
    HEADER,
    "",
    "# Deployments",
    "",
    "The Sauce contracts have the same address on every EVM chain, and its programs the same id on",
    "every Solana cluster, so this page is the one place the manual lists them: each chain's page",
    "points here. An address is where the contract is deployed, not proof that it is there: before",
    "relying on one, confirm it has code on the chain (`eth_getCode` returns more than `0x`; on",
    "Solana, `getAccountInfo` returns an executable account). In TypeScript each value comes from",
    "`@eco-incorp/sauce/deployments`, by the function its table names.",
    "",
    "## The release",
    "",
    "The compiler this package pins, and the four components its programs run on. They pair by exact",
    "version, in both directions:",
    "[which engine runs a program](../api/compiler.md#which-engine-runs-a-program).",
    "",
    "| Component | Version |",
    "| --- | --- |",
    `| Compiler, \`@eco-incorp/sauce-compiler\` | ${compiler} |`,
    `| EVM engine, \`v12-evm\` | ${releases["v12-evm"].version} |`,
    `| EVM Kitchen, \`kitchen-evm\` | ${releases["kitchen-evm"].version} |`,
    `| Solana engine, \`v12-svm\` | ${releases["v12-svm"].version} |`,
    `| Solana Kitchen, \`kitchen-svm\` | ${releases["kitchen-svm"].version} |`,
    "",
    "## EVM chains",
    "",
    "| Contract | Address | What it is | In TypeScript |",
    "| --- | --- | --- | --- |",
    `| Engine | \`${evm.engine}\` | the interpreter that runs a program: a cook is the Pot's \`cook(engine, program)\` | \`v12EngineAddress()\` |`,
    `| Kitchen | \`${evm.kitchen}\` | creates Pots (\`deployPot(owner, salt)\`) and sets the fee every cook pays (\`executionFee()\`) | \`v12KitchenAddress()\` |`,
    `| Kitchen implementation | \`${evm.kitchenImplementation}\` | behind the Kitchen, an upgradeable proxy: call the Kitchen | \`v12KitchenImplementationAddress()\` |`,
    `| Router | \`${evm.router}\` | generation ${evm.routerGeneration}: the Router a new Pot starts on, through which the swaps a pool calls back for run | \`v12RouterAddress()\` |`,
    `| Quote Router | \`${evm.quoteRouter}\` | generation ${evm.quoteRouterGeneration}: quotes Uniswap V3 and V4 swaps through \`eth_call\`, holding no tokens; no Pot's Router | \`v12QuoteRouterAddress()\` |`,
    "",
    "### Pots",
    "",
    "The Kitchen deploys an owner's Pot under a 32-byte salt, zero unless another is chosen, at",
    "`CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)`, with the Pot init-code",
    "hash:",
    "",
    `\`${evm.potInitCodeHash}\``,
    "",
    "`v12PredictPot(owner, salt)` computes a Pot's address, `v12PotDerivation()` returns the formula",
    "and the hash, and `sauce pot --owner <address>` prints an owner's Pot.",
    "",
    "### The shared intent Pot",
    "",
    "An intent's program body cooks on the Pot of the destination's eco-routes Executor under salt",
    "zero. One Executor serves every EVM chain that takes intents, so one Pot does:",
    "",
    "| Fact | Value |",
    "| --- | --- |",
    `| Address | \`${evm.intentPot.address}\`: \`destinationPot(chain)\` |`,
    `| Owner, the eco-routes Executor | \`${evm.intentPot.owner}\` |`,
    `| Salt | \`${evm.intentPot.salt}\`: \`SAUCE_INTENT_POT_SALT\` |`,
    "",
    "The Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account.",
    "[The destination Pot](../guides/intents.md#the-destination-pot) says who deploys it and what a",
    "body may leave in it.",
    "",
    "## Solana",
    "",
    "| Program | Program id | Key, the value a program holds | In TypeScript |",
    "| --- | --- | --- | --- |",
    `| Engine | \`${svm.engine}\` | \`${svmKey(svm.engine)}\` | \`v12SvmEngineProgramId()\` |`,
    `| Kitchen | \`${svm.kitchen}\` | \`${svmKey(svm.kitchen)}\` | \`v12SvmKitchenProgramId()\` |`,
    "",
    "The engine owns every Pot, and a program on Solana reads it as `ctx.self()`. A Pot is the",
    'Kitchen\'s program address for the seeds `"pot"`, the owner and the 32-byte salt.',
    "",
  ];

  return lines.join("\n");
}

function renderChainIndex(data, site) {
  const path = site.chainIndex;
  const lines = [
    HEADER,
    "",
    "# Chains",
    "",
    `Every chain the SDK knows, with a ${site.noun} each: whether the initial release supports it, ids, native`,
    "coin, intents, its tokens and every protocol recorded there with its addresses. The Sauce",
    "contracts have the same addresses on every EVM chain, and its programs the same ids on Solana:",
    `[${site.label(site.deployments, "Deployments")}](${href(path, site.deployments)}) lists them once, with the shared intent Pot.`,
    "",
    `For the initial release, Sauce supports transactions on ${andList(data.support.supported.map((c) => c.name))}`,
    `(${data.support.supported.map((c) => code(c.slug)).join(", ")}). Every other chain is a preview chain: a program`,
    "compiles and simulates there, but the `sauce` command and the MCP server build and send no",
    "transaction, and say so with the supported chains and how to request that chain. To request one,",
    `look among the [existing requests](${data.support.issues}) and add your use case to the chain's,`,
    `or [open one](${data.support.newIssue}) with the chain-support issue form; each preview chain's`,
    `${site.noun} links its own.`,
    "",
    ...(site.chainIndexNotes ?? []),
    "| Chain | Slug | Id | Kind | Support | Intents | CCTP | Tokens | Protocols |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const chain of data.chains) {
    lines.push(
      `| [${chain.name}](${href(path, site.chain(chain.slug))}) | \`${chain.slug}\` | ${chain.id} | ${kindName(chain.kind)} | ${chain.support} | ${chain.intents ? "yes" : "no"} | ${chain.cctp ?? "—"} | ${chain.tokens.length} | ${chain.protocols.length} |`,
    );
  }
  lines.push("");

  return site.prose(lines, path).join("\n");
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
      "// The contract's address, a `main` argument.",
      "function main(contract: Address) {",
      `  const target = ${e.name}.at(contract);`,
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
      `  require(${first.namespace} != 0);`,
      "}",
      "```",
      "",
    ];
  }
  const constant = constName(first.role);
  return [
    `Where it is not a namespace, a program imports the ABI and binds it to the recorded address,`,
    `as a module constant (here ${chain.name}'s ${first.role}):`,
    "",
    `\`\`\`sauce chain=${chain.slug}`,
    `import ${first.abi} from "./protocols/${p.slug}/${first.abi}.json";`,
    "",
    `const ${constant} = ${first.address};`,
    "",
    "function main() {",
    `  const bound = ${first.abi}.at(${constant});`,
    "}",
    "```",
    "",
  ];
}

/** The sections of a protocol's document that its manual page states itself, from the registry. */
const DOCUMENT_GENERATED_SECTIONS = new Set(["Category", "Deployments and ABI"]);

/**
 * A protocol's hand-written document as its manual page carries it: `lead`, what precedes its
 * first section (the swap pointer, the description), and `sections`, each from its `## ` heading.
 * The title and the sections the page generates are left out, and its links to the registry files
 * become links to the pages that hold them.
 */
function foldDocument(text, slug) {
  const lines = text.replace(/\n+$/, "").split("\n").slice(1);
  let fenced = false;
  const linked = lines.map((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) return line;

    return line.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) return whole;
      const page = /^(?:registry\/)?([a-z0-9-]+)\.md(#.*)?$/.exec(target);
      if (page === null)
        throw new Error(`${slug}.md links ${target}, which the manual has no page for`);

      return `](${page[1]}.md${page[2] ?? ""})`;
    });
  });
  const lead = [];
  const sections = [];
  fenced = false;
  for (const line of linked) {
    if (line.startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) sections.push({ heading: line.slice(3), lines: [line] });
    else if (sections.length) sections.at(-1).lines.push(line);
    else lead.push(line);
  }
  const trim = (block) => {
    const text = block.join("\n").trim();

    return text ? text.split("\n") : [];
  };

  return {
    lead: trim(lead),
    sections: sections
      .filter((section) => !DOCUMENT_GENERATED_SECTIONS.has(section.heading))
      .flatMap((section) => [...trim(section.lines), ""]),
  };
}

function renderProtocolRegistry(p, data, site, documents = {}) {
  const path = site.protocol(p.slug);
  const chainsBySlug = new Map(data.chains.map((c) => [c.slug, c]));
  // The manual folds the protocol's document into its page; a skill links it as a file of its own.
  const folded =
    site.document === undefined && documents[p.slug] !== undefined
      ? foldDocument(documents[p.slug], p.slug)
      : undefined;
  const lines = [
    HEADER,
    "",
    `# ${p.name} (\`${p.slug}\`)`,
    "",
    ...(folded?.lead.length ? folded.lead : [p.description]),
    "",
  ];
  lines.push(
    "| Fact | Value |",
    "| --- | --- |",
    `| Category | ${categoryName(p.category)} |`,
    `| Family | ${p.family ? `\`${p.family}\`: ${data.familyMembers.get(p.family).map(code).join(", ")}` : "none"} |`,
    `| Namespace | ${p.namespace ? `\`${p.namespace.name}\` on ${p.namespace.chains.join(", ")}` : "none: import its ABI"} |`,
    `| Chains | ${p.chains.length ? p.chains.join(", ") : "none recorded"} |`,
  );
  if (site.document !== undefined) {
    lines.push(
      `| Document | ${p.documented ? `[${p.slug}.md](${href(path, site.document(p.slug))}): what it is for, how to choose it, its pitfalls` : "none"} |`,
    );
  }
  // Beside a document's own "In a Sauce program", the generated section says what it is about.
  lines.push(
    "",
    ...(folded?.sections ?? []),
    folded === undefined ? "## In a program" : "## Its names in a program",
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
        `| ${chainLink(site, path, chainsBySlug.get(d.chain))} | ${d.role} | ${addressCode(chainsBySlug.get(d.chain).kind, d.address)} | ${spelling(d)} |`,
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

  return site.prose(lines, path).join("\n");
}

function renderProtocolIndex(data, site) {
  const path = site.protocolIndex;
  const lines = [HEADER, "", site === DOCS_SITE ? "# Protocols" : "# Protocol index", ""];
  if (site === DOCS_SITE) {
    lines.push(
      "Every protocol the SDK registers, by category: how to choose between them, then each one with",
      "its family, whether a program names it as a namespace (and on which chains), and where it is",
      "deployed. Each protocol's page has what it is for and its pitfalls where the registry documents",
      "them, its addresses per chain, how a program names each contract, and its ABI functions.",
      "",
    );
  } else {
    lines.push(
      "Every protocol the SDK registers, by category: how to choose between them, then each one with",
      "its family, whether a program names it as a namespace (and on which chains), and where it is",
      "deployed. Each protocol's registry file (`registry/<slug>.md`) has its addresses per chain, how a",
      "program names each contract, and its ABI functions; its document (`<slug>.md`) says what it is",
      "for and its pitfalls.",
      "",
    );
  }
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
      const name =
        site.document === undefined
          ? `[${p.name}](${href(path, site.protocol(p.slug))})`
          : `${p.documented ? `[${p.name}](${href(path, site.document(p.slug))})` : p.name} ([registry](${href(path, site.protocol(p.slug))}))`;
      lines.push(
        `| ${name} | ${p.family ? code(p.family) : "—"} | ${
          p.namespace ? `${code(p.namespace.name)}: ${p.namespace.chains.join(", ")}` : "—"
        } | ${p.chains.length ? p.chains.join(", ") : "none recorded"} |`,
      );
    }
    lines.push("");
  }
  // The skills list these names in `sauce-globals`; the manual lists them here, beside their protocols.
  if (site === DOCS_SITE) {
    const protocolLink = (slug) => `[\`${slug}\`](${href(path, site.protocol(slug))})`;
    lines.push(
      "## Family aliases",
      "",
      "A slug ending in `-v<N>` also joins the family named by the rest: `Uniswap` covers",
      "`UniswapV2`, `UniswapV3` and `UniswapV4`. A family names a contract on a chain when exactly one",
      "of its members has one by that name there; any other name, such as one two members share, is",
      "ambiguous, and a program names the versioned namespace instead.",
      "",
      "| Alias | Resolves to | On |",
      "| --- | --- | --- |",
      ...data.globals.aliases.flatMap((alias) =>
        alias.targets.map(
          ({ target, chains }) => `| \`${alias.name}\` | \`${target}\` | ${chains.join(", ")} |`,
        ),
      ),
      "",
      "## Interfaces",
      "",
      "An interface is an ABI with no fixed address, the same on every EVM chain: a program binds it to",
      "an address it holds and calls a method in the same expression,",
      "`Namespace.Contract(address).method(...)` (or `.at(address)`), such as a pool its factory",
      "returned.",
      "",
      "| Interface | Protocol |",
      "| --- | --- |",
      ...data.globals.interfaces.map(
        (one) => `| \`${one.name}(<address>)\` | ${protocolLink(one.protocol)} |`,
      ),
      "",
    );
  }

  return site.prose(lines, path).join("\n");
}

/** Every generated file's text, by path relative to the skills directory. */
export function renderSkillsReferences(data) {
  const site = SKILLS_SITE;
  const files = {
    ...renderGlobals(data),
    [site.chainIndex]: renderChainIndex(data, site),
    [site.protocolIndex]: renderProtocolIndex(data, site),
    [INTENT_DEFAULTS_SKILL]: renderIntentDefaults(data),
    [site.deployments]: renderDeploymentsJson(data),
  };
  for (const chain of data.chains) {
    files[site.chain(chain.slug)] = renderChain(chain, data.support.supported, site);
    if (chain.tokens.some((t) => t.stock))
      files[site.chainStocks(chain.slug)] = renderChainStocks(chain, site);
  }
  for (const p of data.protocols)
    files[site.protocol(p.slug)] = renderProtocolRegistry(p, data, site);

  return files;
}

// ---- An intent's defaults: one table, for the skill and the manual ------------------------------

/** The skill's copy of the defaults table, and the manual's. */
const INTENT_DEFAULTS_SKILL = "sauce-intents/references/defaults.md";
const INTENT_DEFAULTS_DOCS = "intent-defaults.md";

/**
 * What each of a hop's fields is when it is left out — `Chain.hop({ send, receive, refundee, … })`
 * — and why, as one table both audiences read. From the SDK's constants, so a
 * changed window changes both.
 */
function renderIntentDefaults(data) {
  const { fill, refund } = data.intentDefaults;
  const days = Number(refund) / 86_400;

  return [
    HEADER,
    "",
    "# Intent defaults",
    "",
    "An intent opened with `Chain.hop({ send, receive, refundee }).then(…)` may give each of these",
    "fields in the same object. Left out, each but the refundee is what Eco's Portal app gives an",
    "intent:",
    "",
    "| Field | Sets | Left out |",
    "| --- | --- | --- |",
    "| `refundee` | The refund address: who may reclaim what was sent, unearned, where an unfilled intent's `send` goes | Required on every intent, at any depth |",
    "| `receive` | What the solver delivers on the destination, for the body: `{ token, amount }` or a list | Nothing delivered |",
    `| \`deadline\` | The last second the intent may be filled, Unix seconds | ${fill} seconds (${Number(fill) / 60} minutes) after the intent opens, the window Eco's solver quotes |`,
    `| \`rewardDeadline\` | From when what was sent, if no fill is proven, may be refunded to the refundee (the Portal reward's deadline) | ${refund} seconds (${days} days) after the fill deadline: Eco's solver fills no intent whose reward is refundable sooner |`,
    "| `prover` | The source chain's prover, which accepts the proof of the fill | The one the registry records on both chains, the HyperProver first |",
    "| `salt` | The route's salt: two otherwise identical intents differ by it | 32 random bytes, as Eco's app picks, mixed with how many intents the transaction has opened, so two intents built alike are two, in one program or in two |",
    "| `fee` | The destination Kitchen's fee, in wei, that the body's cook pays | That Kitchen's fee, read from it when the intent is built, for each destination |",
    "| `{ native: amount }` in `send` | Native coin sent, in wei | None |",
    "",
    "**The refundee has no default.** An intent is published by a program a Pot runs, and the Pot may",
    "be shared, so a refund there could go to anyone: every intent, the one a file opens itself and",
    "every one a body opens below it, names its own `refundee`, usually one of `main`'s parameters",
    "(`refundee: refundTo`), or the compile refuses it. Nothing stands in for it, not even the wallet",
    "that sends the cook.",
    "",
    "**An intent opens when it is built.** The `sauce` command and its MCP server build the intents a",
    "file opens once per run (`sauce intent publish`, `sauce run`), with one time and one random salt",
    "for the run, so each run builds new intents unless `--intent-deadline` and `--intent-salt` are",
    "given. Compiled with no such time, an intent opens when the program that opens it runs, at",
    "`ctx.timestamp()`; an intent a body opens, one level down, always opens when that body runs.",
    "",
    "A field's value may be one the program computes as it runs, such as",
    "`deadline: ctx.timestamp() + 3600`. Only the `sauce` command and its MCP server read a Kitchen,",
    "so compiled any other way, every hop needs a `fee`: its body is a program, whose cook pays it.",
    "",
  ].join("\n");
}

// ---- The manual's reference -------------------------------------------------------------------------

/**
 * One `## ` section of a skill's hand-written file, below its heading, for a manual page: each of
 * its links is replaced as `links` says, `[label, href]` by target, and a link `links` does not
 * name fails, so a new link in the skill cannot leave the manual pointing into `skills/`.
 */
function foldSection(text, heading, links, from) {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" section to copy into docs/reference/${from}`);
  const section = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) break;
    section.push(
      fenced
        ? line
        : line.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, _label, target) => {
            if (/^[a-z]+:/i.test(target)) return whole;
            if (links[target] === undefined)
              throw new Error(
                `"## ${heading}" links ${target}, which docs/reference/${from} cannot`,
              );

            return `[${links[target][0]}](${links[target][1]})`;
          }),
    );
  }

  return docsProse(section.join("\n").trim().split("\n"), from);
}

/** Up to three of an issuer's symbols on a chain, the best known first, as examples. */
const STOCK_EXAMPLES = ["TSLA", "SPCX", "NVDA", "SPY", "COIN", "MSTR"];
function stockExamples(stocks) {
  const rank = (t) => {
    const at = STOCK_EXAMPLES.indexOf(t.stock.ticker.replace(/\.US$/, ""));

    return at < 0 ? STOCK_EXAMPLES.length : at;
  };

  return [...stocks]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 3)
    .map((t) => code(t.symbol));
}

function renderTokens(data, globalsSkill) {
  const path = "tokens.md";
  const { tokens, functions } = data.globals;
  const chainOf = new Map(data.chains.map((chain) => [chain.slug, chain]));
  const lines = [
    HEADER,
    "",
    "# Tokens",
    "",
    "A program compiled for a chain names that chain's registered tokens by symbol, with no import",
    "(`USDC.balanceOf(ctx.self())`), and any other ERC-20 as `Token(<address>)`. In TypeScript the",
    "same token is a property of the chain's export, `Base.USDC`, with its `address`, `decimals` and",
    "`symbol`. Amounts are integers in the token's smallest units: nothing scales them by decimals.",
    "",
    "On Solana a symbol is the mint's 32-byte key, a value for the `@sauce/token` functions",
    "(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token methods",
    "(`USDC.transfer(...)`) are EVM-only. Each Solana mint's token program is legacy SPL Token or",
    "Token-2022, whose mints a program moves with the checked writes.",
    "",
    "| Chain | Tokens | Tokenized stocks |",
    "| --- | --- | --- |",
  ];
  for (const entry of tokens) {
    const chain = chainOf.get(entry.chain.slug);
    const stocks = entry.tokens.filter((t) => t.stock).length;
    lines.push(
      `| ${chainLink(DOCS_SITE, path, chain)} | ${entry.tokens
        .filter((t) => !t.stock)
        .map((t) => code(t.symbol))
        .join(
          ", ",
        )} | ${stocks ? `[${stocks}](${href(path, DOCS_SITE.chainStocks(chain.slug))})` : "—"} |`,
    );
  }
  lines.push(
    "",
    "Every other chain registers no token: a program there uses `Token(<address>)`.",
    "",
  );
  for (const entry of tokens) {
    const chain = chainOf.get(entry.chain.slug);
    const plain = entry.tokens.filter((t) => !t.stock);
    lines.push(`## ${chain.name}`, "");
    if (entry.chain.kind === "svm") {
      lines.push(
        "| Symbol | Mint | Key, the value a program holds | Decimals | Token program |",
        "| --- | --- | --- | --- | --- |",
        ...plain.map(
          (t) =>
            `| \`${t.symbol}\` | \`${t.mint ?? base58(t.address)}\` | \`${t.address}\` | ${t.decimals} | ${tokenProgramName(t.tokenProgram)} |`,
        ),
      );
    } else {
      lines.push(
        "| Symbol | Address | Decimals |",
        "| --- | --- | --- |",
        ...plain.map((t) => `| \`${t.symbol}\` | \`${t.address}\` | ${t.decimals} |`),
      );
    }
    lines.push("");
    if (entry.native) {
      lines.push(
        `The native coin is ${entry.native.coin} (${entry.native.coinDecimals} decimals), and \`${entry.native.erc20}\``,
        `is its ERC-20 face (${entry.native.erc20Decimals} decimals): one balance, read at two scales.`,
        `[${chain.name}](${href(path, DOCS_SITE.chain(chain.slug))}) has what that changes.`,
        "",
      );
    }
    if (entry.devnet?.length) {
      lines.push(
        `Devnet's mints differ: [${chain.name}](${href(path, DOCS_SITE.chain(chain.slug))}) lists them.`,
        "",
      );
    }
  }
  lines.push(
    "## Tokenized stocks",
    "",
    ...foldSection(
      globalsSkill,
      "Tokenized stocks",
      { "references/stocks.md": ["the stock tokens of each chain", "#stock-tokens-by-issuer"] },
      path,
    ),
    "",
    "### Stock tokens by issuer",
    "",
    "| Chain | Issuer | Tokens | For example |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of tokens) {
    const chain = chainOf.get(entry.chain.slug);
    const byIssuer = new Map();
    for (const t of entry.tokens.filter((t) => t.stock))
      byIssuer.set(t.stock.issuer, [...(byIssuer.get(t.stock.issuer) ?? []), t]);
    for (const [issuer, stocks] of byIssuer) {
      lines.push(
        `| [${chain.name}](${href(path, DOCS_SITE.chainStocks(chain.slug))}) | ${issuer} | ${stocks.length} | ${stockExamples(stocks).join(", ")} |`,
      );
    }
  }
  lines.push(
    "",
    "## Token functions",
    "",
    "Every program can call these `@sauce/token` functions with no import. The EVM writes are",
    "SafeERC20: a token that returns nothing works, and one that returns `false` reverts.",
    "",
  );
  for (const module of functions) {
    lines.push(module.kind === "evm" ? "On EVM chains:" : "On Solana:", "");
    for (const fn of module.functions) lines.push(`- \`${fn}\``);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * A skill's SKILL.md as a guide in the manual, at `from` (relative to `docs/reference/`): its
 * frontmatter dropped, the code block that is its example's code shown as the whole example file
 * (header and all, which the page refers to), each link replaced as `links` says (`[label, href]`,
 * or `[label]` for no link: a file the manual does not ship), and its skill names linked.
 */
function renderSkillGuide(source, skill, example, links, from) {
  const body = skill.replace(/^---\n[^]*?\n---\n+/, "");
  const lines = [];
  let block;
  for (const line of body.split("\n")) {
    if (block === undefined && line.startsWith("```")) {
      block = [line];
      continue;
    }
    if (block !== undefined) {
      if (!line.startsWith("```")) {
        block.push(line);
        continue;
      }
      const code = block.slice(1).join("\n");
      // The example's code, which the skill quotes without its header: the file as it ships.
      const whole = code.length > 0 && example.trimEnd().endsWith(code);
      lines.push(block[0], ...(whole ? example.trimEnd().split("\n") : block.slice(1)), line);
      block = undefined;
      continue;
    }
    lines.push(
      line.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, _label, target) => {
        if (/^[a-z]+:/i.test(target) || target.startsWith("#")) return whole;
        if (links[target] === undefined)
          throw new Error(`the skill links ${target}, which ${from} has no page for`);
        const [label, to] = links[target];

        return to === undefined ? label : `[${label}](${to})`;
      }),
    );
  }

  return [renderedFrom(source), "", ...docsProse(lines, from)].join("\n");
}

/** A file's lines that are neither blank nor only a comment: the code a reader reads. */
function codeLines(text) {
  return text
    .replace(/\/\*[^]*?\*\//g, (comment) => "\n".repeat(comment.split("\n").length - 1))
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length;
}

/** A file's lines, the last newline not counted as another. */
const allLines = (text) => text.trimEnd().split("\n").length;

/**
 * The ported examples as one guide: for each, its official source (from the header's `Ported from`
 * paragraph: `Ported from <repo>, <path> (<n> lines, <m> of code):` and the URL on the next line),
 * both programs' line counts, and the Sauce program's whole file, whose header says what changed.
 */
function renderPortedGuide(examples) {
  const ported = examples.map(({ heading, path, text }) => {
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.startsWith("// Ported from "));
    const source = /^\/\/ Ported from (.+), (\S+) \((\d+) lines, (\d+) of code\):$/.exec(
      lines[at] ?? "",
    );
    const url = /^\/\/ (https:\/\/\S+)$/.exec(lines[at + 1] ?? "");
    if (source === null || url === null)
      throw new Error(
        `${path} has no "// Ported from <repo>, <path> (<n> lines, <m> of code):" line and URL`,
      );
    const [, repo, file, total, code] = source;

    return { heading, path, text, repo, file, total, code, url: url[1] };
  });
  const anchor = (heading) =>
    heading
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/ /g, "-");

  return [
    "<!-- Generated by sdk/scripts/gen-skills-references.mjs from the examples PORTED_EXAMPLES lists. Edit those files, or the generator, not this page. -->",
    "",
    "# From Solidity examples to Sauce",
    "",
    "The protocols publish their own examples in Solidity: a contract you deploy, fund and then call.",
    "Each example below is one of them ported to Sauce: one program, compiled for a chain and sent as",
    "one transaction from your Pot, with nothing deployed. The protocol's contracts are named, never",
    "written as addresses (`UniswapV3.SwapRouter`), each function of the Solidity contract is a",
    "function of the program, and what it took as arguments `main` takes. The header of each program",
    "says what changed and why, and gives the `sauce` command that runs it.",
    "",
    "Every program here runs, not only compiles, before the package ships: through `sauce simulate`",
    "and `sauce run` on Ethereum's state at a fixed block, against the protocols' deployed contracts,",
    "with each result held to the protocol's own quotes and accounts.",
    "",
    "Lines are counted whole, and as code: neither blank nor only a comment. A Solidity count leaves",
    "out the libraries and interfaces the example imports; a Sauce program imports nothing it does",
    "not ship with.",
    "",
    "| Example | Ported from | Solidity lines (code) | Sauce lines (code) |",
    "| --- | --- | ---: | ---: |",
    ...ported.map(
      (p) =>
        `| [${p.heading}](#${anchor(p.heading)}) | [${p.repo}, \`${posix.basename(p.file)}\`](${p.url}) | ` +
        `${p.total} (${p.code}) | ${allLines(p.text)} (${codeLines(p.text)}) |`,
    ),
    "",
    ...ported.flatMap((p) => [
      `## ${p.heading}`,
      "",
      `Ported from ${p.repo}, [\`${p.file}\`](${p.url}): ${p.total} lines of Solidity, ${p.code} of` +
        ` them code. In Sauce, \`${posix.basename(p.path)}\`: ${allLines(p.text)} lines, ` +
        `${codeLines(p.text)} of them code.`,
      "",
      "```ts",
      ...p.text.trimEnd().split("\n"),
      "```",
      "",
    ]),
  ].join("\n");
}

/** The note a page rendered from a skill opens with: its source, so an edit goes there. */
const renderedFrom = (file) =>
  `<!-- Generated from ${relative(join(SDK, ".."), file)} for the manual. Edit that file, not this one. -->`;

/** The note a copied file opens with: where it is copied from, so an edit goes there. */
const copiedFrom = (file) =>
  `<!-- Generated: a copy of ${relative(join(SDK, ".."), file)}. Edit that file, not this one. -->`;

/**
 * Every file of the manual's reference, by path relative to `docs/reference/`. `skillFiles` gives
 * the hand-written skill files it renders: `documents` (each protocol's document, by slug), `globals`
 * (`sauce-globals`' SKILL.md) and `builtins` (the SauceScript reference).
 */
export function renderDocsReference(data, skillFiles) {
  const site = DOCS_SITE;
  const files = {
    [site.chainIndex]: renderChainIndex(data, site),
    [site.protocolIndex]: renderProtocolIndex(data, site),
    [site.deployments]: renderDeploymentsPage(data),
    "tokens.md": renderTokens(data, skillFiles.globals),
    [INTENT_DEFAULTS_DOCS]: renderIntentDefaults(data),
    // Byte for byte below its note: its anchors are the skill's, and it links nothing outside itself.
    "saucescript.md": `${copiedFrom(BUILTINS)}\n\n${skillFiles.builtins}`,
    // A how-to rather than a reference, so it sits among the guides; this generator owns it.
    [DISTRIBUTED_SWAP_GUIDE]: renderSkillGuide(
      join(SKILLS_DIR, "sauce-distributed-swap", "SKILL.md"),
      skillFiles.distributedSwap,
      skillFiles.distributedSwapExample,
      {
        "examples/distributed-swap.sauce.ts": ["`distributed-swap.sauce.ts`"],
        "examples/distributed-swap.mts": ["`distributed-swap.mts`"],
        "../sauce-globals/references/tokens.md": ["tokens", "../reference/tokens.md"],
        "../sauce-globals/references/stocks.md": [
          "tokenized stocks",
          "../reference/tokens.md#tokenized-stocks",
        ],
      },
      DISTRIBUTED_SWAP_GUIDE,
    ),
    // The Solana one, with its venues reference after it: one page, so a link to it is in-page.
    [SOLANA_DISTRIBUTED_SWAP_GUIDE]: [
      renderSkillGuide(
        join(SKILLS_DIR, "sauce-solana-distributed-swap", "SKILL.md"),
        skillFiles.solanaDistributedSwap,
        skillFiles.solanaDistributedSwapExample,
        {
          "examples/solana-distributed-swap.sauce.ts": ["`solana-distributed-swap.sauce.ts`"],
          "examples/solana-distributed-swap-5.sauce.ts": ["`solana-distributed-swap-5.sauce.ts`"],
          "examples/solana-distributed-swap.mts": ["`solana-distributed-swap.mts`"],
          "references/venues.md": [
            "the venues, their pools and their slots",
            "#the-venues-their-pools-and-their-slots",
          ],
        },
        SOLANA_DISTRIBUTED_SWAP_GUIDE,
      ).trimEnd(),
      "",
      ...docsProse(
        skillFiles.solanaVenues.replace(/^(#+) /gm, "#$1 ").split("\n"),
        SOLANA_DISTRIBUTED_SWAP_GUIDE,
      ),
    ].join("\n"),
  };
  files[SOLIDITY_EXAMPLES_GUIDE] = renderPortedGuide(skillFiles.ported);
  for (const chain of data.chains) {
    files[site.chain(chain.slug)] = renderChain(chain, data.support.supported, site);
    if (chain.tokens.some((t) => t.stock))
      files[site.chainStocks(chain.slug)] = renderChainStocks(chain, site);
  }
  for (const p of data.protocols)
    files[site.protocol(p.slug)] = renderProtocolRegistry(p, data, site, skillFiles.documents);

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
    // The `sauce` command's chain support: the CLI's own module, not a package export.
    support: await importFrom("cli/support.js"),
    loadProtocol: (slug) => importFrom(`protocols/${slug}/index.js`),
  };
}

/** The data both renderings read, from a built SDK root, and the skills directory beside it. */
async function referenceData(dir, sdkRoot) {
  const api = await loadApi((path) => import(pathToFileURL(join(sdkRoot, path)).href));
  const documents = join(dir, "sauce-protocols", "references");

  return skillsReferences(api, (slug) => existsSync(join(documents, `${slug}.md`)));
}

/** The hand-written skill files the manual's reference renders, from the skills directory `dir`. */
function skillFiles(dir, data) {
  const read = (...path) => readFileSync(join(dir, ...path), "utf8");

  return {
    documents: Object.fromEntries(
      data.protocols
        .filter((p) => p.documented)
        .map((p) => [p.slug, read("sauce-protocols", "references", `${p.slug}.md`)]),
    ),
    globals: read("sauce-globals", "SKILL.md"),
    builtins: read(relative(SKILLS_DIR, BUILTINS)),
    distributedSwap: read("sauce-distributed-swap", "SKILL.md"),
    distributedSwapExample: read("sauce-distributed-swap", "examples", "distributed-swap.sauce.ts"),
    solanaDistributedSwap: read("sauce-solana-distributed-swap", "SKILL.md"),
    solanaDistributedSwapExample: read(
      "sauce-solana-distributed-swap",
      "examples",
      "solana-distributed-swap.sauce.ts",
    ),
    solanaVenues: read("sauce-solana-distributed-swap", "references", "venues.md"),
    ported: portedExamples(dir),
  };
}

/** The ported examples under the skills directory `dir`, in `PORTED_EXAMPLES`' order. */
function portedExamples(dir) {
  const listed = new Set(PORTED_EXAMPLES.map(([, path]) => path));
  for (const skill of readdirSync(dir)) {
    const examples = join(dir, skill, "examples");
    if (!existsSync(examples)) continue;
    for (const name of readdirSync(examples).filter((n) => n.endsWith(".sauce.ts"))) {
      const path = `${skill}/examples/${name}`;
      const text = readFileSync(join(examples, name), "utf8");
      if (/^\/\/ Ported from /m.test(text) && !listed.has(path))
        throw new Error(`${path} ports an example, but PORTED_EXAMPLES does not list it`);
    }
  }

  return PORTED_EXAMPLES.map(([heading, path]) => ({
    heading,
    path,
    text: readFileSync(join(dir, path), "utf8"),
  }));
}

/** Each rendered file against the one in `dir`, and the files in its generated directories that
 *  nothing renders any more. */
function staleness(dir, files, generatedDirs) {
  const extra = generatedDirs.flatMap((sub) =>
    existsSync(join(dir, sub))
      ? readdirSync(join(dir, sub))
          .filter((name) => name.endsWith(".md"))
          .map((name) => (sub === "." ? name : `${sub}/${name}`))
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

/** Each generated skills file as this repository's build would write it, whether it is stale, and
 *  the generated files on disk that no longer belong. */
export async function freshSkillsReferences(dir = SKILLS_DIR, sdkRoot = join(SDK, "dist")) {
  return staleness(dir, renderSkillsReferences(await referenceData(dir, sdkRoot)), GENERATED_DIRS);
}

/** The same for the manual's reference, `docs/reference/`, rendered from the skills in `skills`. */
export async function freshDocsReference(
  dir = DOCS_REFERENCE_DIR,
  sdkRoot = join(SDK, "dist"),
  skills = SKILLS_DIR,
) {
  const data = await referenceData(skills, sdkRoot);

  return staleness(dir, renderDocsReference(data, skillFiles(skills, data)), DOCS_GENERATED_DIRS);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const data = await referenceData(SKILLS_DIR, join(SDK, "dist"));
  const outputs = [
    [SKILLS_DIR, staleness(SKILLS_DIR, renderSkillsReferences(data), GENERATED_DIRS)],
    [
      DOCS_REFERENCE_DIR,
      staleness(
        DOCS_REFERENCE_DIR,
        renderDocsReference(data, skillFiles(SKILLS_DIR, data)),
        DOCS_GENERATED_DIRS,
      ),
    ],
  ];
  if (process.argv.includes("--check")) {
    const stale = outputs.flatMap(([, { files, extra }]) => [
      ...files.filter((file) => file.stale).map((file) => file.path),
      ...extra,
    ]);
    if (stale.length > 0) {
      console.error(
        `gen-skills-references: stale ${stale.map((p) => relative(process.cwd(), p)).join(", ")}` +
          " — rebuild the SDK, or run `node scripts/gen-skills-references.mjs`, and commit the result.",
      );
      process.exit(1);
    }
  } else {
    for (const [dir, { files, extra }] of outputs) {
      const stale = files.filter((file) => file.stale);
      for (const file of stale) {
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(file.path, file.text);
      }
      for (const path of extra) rmSync(path);
      console.log(
        `gen-skills-references: ${files.length} files under ${relative(process.cwd(), dir)}` +
          ` (${stale.length} rewritten, ${extra.length} removed)`,
      );
    }
  }
}
