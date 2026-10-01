#!/usr/bin/env node
// The `sauce-globals` agent skill's index: every token symbol, protocol contract, chain name and
// zero-import function a program can use, per chain — `skills/sauce-globals/references/{tokens,
// protocols,chains}.md` at the repository root.
//
// ONE SOURCE. Every name comes from `routes.sourceGlobals(chain)`, the function `sauce globals`
// prints, which reads the registries and resolvers the compile reads. Nothing here derives a name of
// its own: it only regroups that per-chain listing by name (a contract and the chains it is on) and
// adds three facts the listing does not carry, each from the SDK — a native coin's ERC-20 twin
// (`nativeErc20`), whether a chain opens and receives intents (`ecoRoutesPortal`), and the devnet
// mints a Solana program passes as defines (`routes.SVM_TOKEN_REGISTRY`).
//
// It reads the BUILT SDK (`dist/`), so it runs after `tsc` in `build`, which rewrites the files.
// The files are committed: CI rebuilds and fails when that changed them, and the skills checker
// (`check-skills.mjs`) compares them with `globalsIndex()` the same way.
//
//   node scripts/gen-skills-globals.mjs           write the three files
//   node scripts/gen-skills-globals.mjs --check   exit 1, naming each, when a file is stale
//   import { globalsIndex, renderGlobalsIndex }   the data and the files, for the skills checker
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the files go, beside the `sauce-globals` skill that links them. */
export const GLOBALS_DIR = join(SDK, "..", "skills", "sauce-globals", "references");

const HEADER =
  "<!-- Generated from the SDK's registries: the names `sauce globals --chain <chain>` lists. Do not edit. -->";

/**
 * The index as data. `sdk` is the package root module and `ecoRoutes` its
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

  // The chain names are the same list on every chain; the first chain's is the one to keep.
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

  return {
    tokens,
    contracts: [...contracts.values()].sort(byName),
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

/** The three files' text, by file name. */
export function renderGlobalsIndex(index) {
  const tokens = [
    HEADER,
    "",
    "# Token globals",
    "",
    "A program compiled for a chain names these symbols with no import. Each is that chain's token",
    "address; amounts are in the token's smallest units (its decimals). Any other ERC-20 is",
    "`Token(<address>)`.",
    "",
  ];
  const tokenLine = (token) =>
    token.mint === undefined
      ? `- \`${token.symbol}\`: \`${token.address}\`, ${token.decimals} decimals`
      : `- \`${token.symbol}\`: mint \`${token.mint}\`, key \`${token.address}\`, ${token.decimals} decimals`;
  for (const entry of index.tokens) {
    tokens.push(`## ${entry.chain.key} (\`${entry.chain.slug}\`, ${entry.chain.id})`, "");
    if (entry.chain.kind === "svm") {
      tokens.push(
        "A symbol is the mint's 32-byte key, a value for the `@sauce/token` functions",
        "(`balanceOf(USDC, account)`); the token accounts are `Account` parameters, and the token",
        "methods (`USDC.transfer(...)`) are EVM-only.",
        "",
      );
    }
    for (const token of entry.tokens) tokens.push(tokenLine(token));
    if (entry.devnet !== undefined) {
      tokens.push(
        "",
        "On devnet, pass a mint that differs as a define, which wins over the symbol",
        "(`--define USDC=<key>`):",
        "",
        ...entry.devnet.map(tokenLine),
      );
    }
    if (entry.native !== undefined) {
      const { coin, coinDecimals, erc20, erc20Decimals } = entry.native;
      tokens.push(
        "",
        `Native coin: ${coin} is also the ERC-20 \`${erc20}\`, one balance: ` +
          `${coinDecimals ?? "?"} decimals natively, ${erc20Decimals} through the ERC-20.`,
      );
    }
    tokens.push("");
  }
  tokens.push(
    "## Token functions",
    "",
    "Every program can call these `@sauce/token` functions with no import. The EVM writes are",
    "SafeERC20: a token that returns nothing works, and one that returns `false` reverts.",
    "",
  );
  for (const module of index.functions) {
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
    "is a compile error. Each contract is also the compile-time define `Namespace_Contract` on the",
    "chains listed. A namespace's default contract (marked) is also called as `Namespace.method(...)`.",
    "",
    "## Contracts",
    "",
  ];
  for (const contract of index.contracts) {
    protocols.push(
      `- \`${contract.name}\` (\`${contract.protocol}\`${contract.default ? ", default" : ""}): ` +
        contract.chains.join(", "),
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
  for (const alias of index.aliases) {
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
    "to take intents; each line says whether its chain does.",
    "",
  ];
  for (const chain of index.chains) {
    chains.push(
      `- \`${chain.key}\`: \`${chain.slug}\`, ${chain.id}, ${chain.kind.toUpperCase()}, ` +
        (chain.intents ? "takes intents" : "no intents"),
    );
  }
  chains.push("");

  return {
    "tokens.md": tokens.join("\n"),
    "protocols.md": protocols.join("\n"),
    "chains.md": chains.join("\n"),
  };
}

/** The files as this repository's build would write them, with whether each on disk differs. */
export async function freshGlobalsIndex(dir = GLOBALS_DIR, sdkRoot = join(SDK, "dist")) {
  const load = (path) => import(pathToFileURL(join(sdkRoot, path)).href);
  const files = renderGlobalsIndex(
    globalsIndex(await load("index.js"), await load("protocols/eco-routes/index.js")),
  );

  return Object.entries(files).map(([name, text]) => {
    const path = join(dir, name);

    return { name, path, text, stale: !existsSync(path) || readFileSync(path, "utf8") !== text };
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const files = await freshGlobalsIndex();
  if (process.argv.includes("--check")) {
    const stale = files.filter((file) => file.stale);
    if (stale.length > 0) {
      console.error(
        `gen-skills-globals: stale ${stale.map((file) => relative(process.cwd(), file.path)).join(", ")}` +
          " — rebuild the SDK, or run `node scripts/gen-skills-globals.mjs`, and commit the result.",
      );
      process.exit(1);
    }
  } else {
    for (const file of files.filter((each) => each.stale)) writeFileSync(file.path, file.text);
    console.log(
      `gen-skills-globals: ${files.length} files in ${relative(process.cwd(), GLOBALS_DIR)}` +
        ` (${files.filter((file) => file.stale).length} rewritten)`,
    );
  }
}
