#!/usr/bin/env node
// The `sauce-protocols` agent skill's index of its per-protocol documents,
// `skills/sauce-protocols/references/index.md` at the repository root, which the `/skills` export
// also serves as `getProtocolIndex()`.
//
// ONE SOURCE. Every protocol, its category, the chains it is deployed on and its SauceScript
// templates come from the protocol registry (`listProtocols()` and each `protocols/<slug>` module),
// so the index cannot drift from it; a hand-kept chain table did. The only hand-written parts are
// the prose below and the category headings.
//
// It reads the BUILT SDK (`dist/`), so it runs after `tsc` in `build`, which rewrites the file. The
// file is committed: CI rebuilds and fails when that changed it, and the skills checker
// (`check-skills.mjs`) compares it with `protocolIndex()` the same way.
//
//   node scripts/gen-skills-protocol-index.mjs           write the file
//   node scripts/gen-skills-protocol-index.mjs --check   exit 1 when it is stale
//   import { protocolIndex, renderProtocolIndex }        the data and the file, for the checker
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the file goes, beside the per-protocol documents it indexes. */
export const PROTOCOL_DOCUMENTS = join(SDK, "..", "skills", "sauce-protocols", "references");
export const INDEX_FILE = "index.md";

const HEADER = "<!-- Generated from the SDK's protocol registry. Do not edit. -->";

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

/**
 * The index as data. `sdk` is the package root module, `loadModule(slug)` resolves a protocol
 * module (its string exports are its SauceScript templates), and `documented(slug)` says whether
 * the skill carries that protocol's document — passed in, so the checker can index the package and
 * the skills directory it loaded (an installed package, say).
 */
export async function protocolIndex(sdk, loadModule, documented) {
  const chains = new Map(sdk.CANONICAL_CHAINS.map((chain) => [chain.id, chain]));
  const chainOrder = (id) => [...chains.keys()].sort((a, b) => a - b).indexOf(id);
  const protocols = [];
  for (const info of sdk.listProtocols()) {
    let module = {};
    try {
      module = await loadModule(info.slug);
    } catch {}
    const ids = [...new Set((info.chains ?? []).map((deployment) => deployment.chainId))].sort(
      (a, b) => chainOrder(a) - chainOrder(b),
    );
    protocols.push({
      slug: info.slug,
      name: info.name,
      category: info.category,
      chains: ids.map((id) => chains.get(id)?.slug ?? String(id)),
      templates: Object.entries(module)
        .filter(([, value]) => typeof value === "string")
        .map(([name]) => name)
        .sort(),
      documented: documented(info.slug),
    });
  }
  const byChain = [...chains.values()]
    .sort((a, b) => a.id - b.id)
    .map((chain) => ({
      chain,
      protocols: protocols
        .filter((p) => p.chains.includes(chain.slug))
        .map((p) => p.slug)
        .sort(),
    }))
    .filter((entry) => entry.protocols.length > 0);

  return { protocols, byChain };
}

const link = (p) => (p.documented ? `[${p.name}](${p.slug}.md)` : p.name);
const code = (names) => names.map((name) => `\`${name}\``).join(", ");

/** The file's text. */
export function renderProtocolIndex(index) {
  const lines = [
    HEADER,
    "",
    "# Protocol index",
    "",
    "Every protocol the SDK registers: the chains its registry records deployments on, and the",
    "SauceScript templates its module carries. Each linked protocol has a document beside this file,",
    "`<slug>.md`, with its addresses, ABI notes and templates. A recorded deployment is an address,",
    "not proof of live code on the chain.",
    "",
    "These documents describe each protocol's own contracts. Inside a Sauce program:",
    "",
    "- **Swap** through the Sauce Router, with a price limit and a minimum output (`sauce-swaps`);",
    "  across several pools under one limit, `sauce-distributed-swap`. A protocol's own router is",
    "  for a pool the Sauce Router does not service.",
    "- **Call a protocol** by its namespace where `sauce-globals` lists one (`UniswapV3.Factory`,",
    "  `AaveV3.Pool`); otherwise import its ABI and pass its address as a define (`sauce-protocols`).",
    "- **Continue on another chain** with an intent (`sauce-intents`).",
    "",
    "## From TypeScript",
    "",
    "```typescript",
    "// A protocol module: its info, its deployments, its ABIs and each SauceScript template by name",
    'import { protocolInfo, deployments, supply } from "@eco-incorp/sauce/protocols/aave-v3";',
    "",
    "// The registry queries",
    "import {",
    "  getProtocol,",
    "  listProtocols,",
    "  getProtocolsByCategory,",
    "  getProtocolsByChain,",
    '} from "@eco-incorp/sauce";',
    "",
    'const aave = getProtocol("aave-v3"); // Single protocol by slug',
    'const dexes = getProtocolsByCategory("dex"); // All DEXes',
    "const baseProt = getProtocolsByChain(8453); // All protocols on Base",
    "```",
    "",
    "From TypeScript, `getProtocolSkill(slug)` and `getProtocolIndex()` from",
    "`@eco-incorp/sauce/skills` return these documents.",
    "",
    "## By category",
    "",
  ];
  const named = new Map(CATEGORIES);
  const categories = [
    ...CATEGORIES.map(([category]) => category),
    ...[...new Set(index.protocols.map((p) => p.category))].filter((c) => !named.has(c)).sort(),
  ];
  for (const category of categories) {
    const members = index.protocols
      .filter((p) => p.category === category)
      .sort((a, b) => (a.slug < b.slug ? -1 : 1));
    if (members.length === 0) continue;
    lines.push(
      `### ${named.get(category) ?? category} (${members.length})`,
      "",
      "| Protocol | Slug | Chains | Templates |",
      "| --- | --- | --- | --- |",
    );
    for (const p of members) {
      lines.push(
        `| ${link(p)} | \`${p.slug}\` | ${p.chains.length ? p.chains.join(", ") : "none recorded"} | ` +
          `${p.templates.length ? code(p.templates) : "none"} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## By chain",
    "",
    "Every protocol with a deployment recorded on the chain.",
    "",
    "| Chain | Id | Protocols |",
    "| --- | --- | --- |",
  );
  for (const { chain, protocols } of index.byChain) {
    lines.push(`| ${chain.name} (\`${chain.slug}\`) | ${chain.id} | ${protocols.join(", ")} |`);
  }
  lines.push("");

  return lines.join("\n");
}

/** The file as this repository's build would write it, with whether the one on disk differs. */
export async function freshProtocolIndex(dir = PROTOCOL_DOCUMENTS, sdkRoot = join(SDK, "dist")) {
  const load = (path) => import(pathToFileURL(join(sdkRoot, path)).href);
  const text = renderProtocolIndex(
    await protocolIndex(
      await load("index.js"),
      (slug) => load(`protocols/${slug}/index.js`),
      (slug) => existsSync(join(dir, `${slug}.md`)),
    ),
  );
  const path = join(dir, INDEX_FILE);

  return { path, text, stale: !existsSync(path) || readFileSync(path, "utf8") !== text };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const file = await freshProtocolIndex();
  if (process.argv.includes("--check")) {
    if (file.stale) {
      console.error(
        `gen-skills-protocol-index: stale ${relative(process.cwd(), file.path)} — rebuild the SDK, ` +
          "or run `node scripts/gen-skills-protocol-index.mjs`, and commit the result.",
      );
      process.exit(1);
    }
  } else {
    if (file.stale) writeFileSync(file.path, file.text);
    console.log(
      `gen-skills-protocol-index: ${relative(process.cwd(), file.path)} (${file.stale ? "rewritten" : "current"})`,
    );
  }
}
