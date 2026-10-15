/**
 * The SDK ships no RPC endpoints, and shipped code reads nothing from the environment — but for the
 * `sauce` command's one read of the variable `--password-env` names. Anything that needs a network
 * connection takes its URL, or a client, from the developer — as an argument or a config value,
 * never a default, a public fallback or `process.env` (a browser has none).
 *
 * The ONE exception is the `sauce` command's and its MCP server's list of public endpoints,
 * `sdk/src/cli/public-rpcs.ts`, which they read a chain through when given none: exactly that file
 * may hold RPC URLs, and nothing a browser loads may import it — no module outside `sdk/src/cli/`,
 * and no package export (`cli/` is in none).
 *
 * This guard scans the TRACKED source that ships or that a developer copies from — `sdk/src` (the
 * `sauce` command in `sdk/src/cli` included), `sdk/scripts`, `actions/src`, `dev-tools/src`,
 * `dev-tools/scripts`, `docs/`, the agent skills in `skills/`, the workflows, and
 * every file at the top of the repo and of each workspace (the READMEs, `CLAUDE.md`, manifests,
 * `sdk/rpc.config.example.json`) — for a URL shaped like an RPC endpoint:
 *
 *   - one bound as an endpoint: to an RPC-named key or variable (`rpcUrls: [...]`, `rpcUrl:`,
 *     `const RPC =`, `["ETH_RPC_URL", ...]`), a Viem chain's `http: [...]`, or a transport or
 *     connection constructor (`http("…")`, `createSolanaRpc("…")`);
 *   - one on a known RPC provider or public-endpoint host, or a host that says `rpc`;
 *   - one with an RPC path shape (`/rpc`, Avalanche's `/ext/bc/…`, a `/v2/<key>`-style key path).
 *
 * Allowed: loopback hosts (dev-tools' own nodes, the unroutable LiteSVM stub), reserved example
 * domains, `${…}` hosts computed at runtime, and URLs on the explicitly non-RPC fields — protocol
 * `website`/`github` and block explorers. A URL that is none of the above but not RPC-shaped (an ABI
 * source, a package registry) is simply not matched.
 *
 * The npm registry is the `sauce` command's one other network access, and one module names it and
 * reads it, `sdk/src/cli/npm-registry.ts`: for `sauce update` when it runs, and for the update
 * check's refresh (`update-check.ts`), in a process of its own. Only the command's own modules
 * import either, and only its executable (`main.ts`) creates the check, so neither a browser nor a
 * library import ever reaches the registry. npm reaches it too, as the user's npm configuration
 * says, where the command runs npm: `sauce init --install`, the package managers of `sauce update`,
 * and `npm ci` into a runtime folder (`runtime.ts`, which only the executable gives the process).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directories scanned recursively. */
const ROOTS = [
  "sdk/src",
  "sdk/scripts",
  "actions/src",
  "dev-tools/src",
  "dev-tools/scripts",
  "docs",
  "skills",
  ".github",
];
/** Directories whose own files (not their subdirectories) are scanned. */
const TOP_LEVELS = [".", "sdk", "actions", "dev-tools"];
/** Files the scan must include, so a move cannot leave it passing over nothing. */
const REQUIRED = [
  "README.md",
  "CLAUDE.md",
  "sdk/README.md",
  "actions/README.md",
  "dev-tools/README.md",
  "sdk/rpc.config.example.json",
  // The `sauce` command, whose network access is --rpc-url, --config and the public list alone.
  "sdk/src/cli/run.ts",
  "sdk/src/cli/commands.ts",
];
/** Loading Node.js's child_process module, however it is spelled: a static import or re-export, a
 *  `require`, a dynamic `import()`, with or without the `node:` prefix. */
const CHILD_PROCESS =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'](?:node:)?child_process["']/;
/** Generated, not authored: its URLs are package tarballs. */
const SKIP = new Set(["pnpm-lock.yaml"]);
/** The `sauce` command's public endpoints: the one file that may hold RPC URLs. */
const PUBLIC_RPCS = "sdk/src/cli/public-rpcs.ts";
/** Shipped code, the `sauce` command included: must not read the environment at all. */
const SHIPPED_ROOTS = ["sdk/src", "actions/src", "dev-tools/src"];
/** Where the registry may be named and read, and who may import the modules that read it. */
const NPM_REGISTRY = "sdk/src/cli/npm-registry.ts";
const REGISTRY_READERS = {
  // runtime.ts takes `newer` alone, to order its version folders; it reads nothing.
  "npm-registry": [
    "sdk/src/cli/runtime.ts",
    "sdk/src/cli/update-check.ts",
    "sdk/src/cli/update.ts",
  ],
  "update-check": [
    "sdk/src/cli/main.ts",
    "sdk/src/cli/mcp.ts",
    "sdk/src/cli/run.ts",
    "sdk/src/cli/update-refresh.ts",
  ],
  update: ["sdk/src/cli/main.ts", "sdk/src/cli/run.ts"],
  "update-refresh": [],
} as const;
/** Every workspace's shipped source, the MCP server's included: what may import a registry reader. */
const IMPORTING_ROOTS = [...["sdk/src", "actions/src", "dev-tools/src"], "mcp/src"];
/** Shipped files the environment scan must include, so a move cannot take the command out of it. */
const SHIPPED_REQUIRED = ["sdk/src/cli/main.ts", "sdk/src/cli/run.ts", "sdk/src/cli/commands.ts"];
/**
 * The `sauce` command's ONE deliberate read of the environment: `--password-env <NAME>`, which
 * reads the variable the user names and nothing else (`cli/password.ts`), so an agent's password
 * reaches the process from its `.env` or secret store without ever being an argument. Exactly this
 * line, in exactly this file: a second read, or this one moved or widened, fails the scan.
 */
const DELIBERATE_ENV_READ = {
  file: "sdk/src/cli/run.ts",
  line: "readEnv: (name) => process.env[name],",
};

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>()[\]{}\\,]+/gi;

/** Loopback: dev-tools' own nodes and the LiteSVM stub never leave the machine. */
const LOOPBACK = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[^.]+\.localhost)$/;
/** RFC 2606 / 6761 reserved names: a placeholder there can never be a real endpoint. */
const RESERVED = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/;

/** Hosts that are RPC endpoints or RPC providers, beyond any host that says `rpc` outright. */
const RPC_HOSTS = [
  /(?:^|\.)infura\.io$/,
  /(?:^|\.)alchemy\.com$/,
  /(?:^|\.)alchemyapi\.io$/,
  /(?:^|\.)quiknode\.pro$/,
  /(?:^|\.)quicknode\.com$/,
  /(?:^|\.)ankr\.com$/,
  /(?:^|\.)publicnode\.com$/,
  /(?:^|\.)blastapi\.io$/,
  /(?:^|\.)chainstack\.com$/,
  /(?:^|\.)blockpi\.network$/,
  /(?:^|\.)nodereal\.io$/,
  /(?:^|\.)getblock\.io$/,
  /(?:^|\.)onfinality\.io$/,
  /(?:^|\.)gateway\.tenderly\.co$/,
  /(?:^|\.)helius\.xyz$/,
  /(?:^|\.)triton\.one$/,
  /(?:^|\.)syndica\.io$/,
  /(?:^|\.)dwellir\.com$/,
  /(?:^|\.)pokt\.network$/,
  // Solana's public clusters.
  /^api\.(?:mainnet-beta|devnet|testnet)\.solana\.com$/,
  // Public chain endpoints this repo once shipped, whose hosts do not say `rpc`.
  /^mainnet\./,
  /^evm\./,
  /dataseed/,
  /^forno\.celo\.org$/,
  /^andromeda\.metis\.io$/,
  /^public-en[.-]/,
];

/** Path shapes only an RPC endpoint has. */
const RPC_PATHS = [/(?:^|\/)rpc(?:\/|$)/i, /^\/ext\/bc\//i, /^\/v[23]\/[0-9a-z_-]{20,}\/?$/i];

/**
 * What binds the URL as an RPC endpoint, read from the line before it: an RPC-named key or variable,
 * a Viem chain's `http: [...]` list, or a transport/connection constructor called on a literal.
 */
const RPC_BINDINGS = [
  /[\w$]*rpc[\w$]*["'`]?\s*[:=,]\s*[[{(]?\s*["'`]?\s*$/i,
  /\b(?:http|webSocket)\s*:\s*\[\s*["'`]?\s*$/,
  /\b(?:http|webSocket|createSolanaRpc\w*|Connection|JsonRpcProvider)\s*\(\s*["'`]\s*$/,
];
/** The explicitly non-RPC URL fields: protocol website/github and block explorers. */
const NON_RPC_KEY =
  /\b(?:website|github|homepage|blockExplorerUrls?|explorerUrls?|explorer)["'`]?\s*[:=]\s*\[?\s*["'`]?\s*$/i;

/** Why `url` (found on a line, after `prefix`) looks like an RPC endpoint, or null when it does not. */
function rpcShape(url: string, prefix = ""): string | null {
  // A `${…}` segment is computed at runtime; keep the literal parts, which is what can be embedded.
  const literal = url.replace(/\$\{[^}]*\}/g, "x");
  let parsed: URL;
  try {
    parsed = new URL(literal);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (LOOPBACK.test(host) || RESERVED.test(host)) return null;
  if (NON_RPC_KEY.test(prefix)) return null;
  if (RPC_BINDINGS.some((pattern) => pattern.test(prefix))) return "bound as an RPC endpoint";
  if (host.includes("rpc")) return "an RPC host";
  if (RPC_HOSTS.some((pattern) => pattern.test(host))) return "a known RPC host";
  if (RPC_PATHS.some((pattern) => pattern.test(parsed.pathname))) return "an RPC path";
  return null;
}

/**
 * Every tracked text file matching `pathspecs`, repo-relative. Tracked only, deliberately: a
 * developer's gitignored `sdk/.env` or `sdk/rpc.config.json` holds real endpoints and must never be
 * read here, or printed in a failure. Binaries (anything with a NUL byte) are skipped.
 */
function scanned(pathspecs: readonly string[]): Map<string, string> {
  const listed = execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], {
    cwd: REPO,
    encoding: "utf-8",
  });
  const out = new Map<string, string>();
  for (const file of listed.split("\0")) {
    if (file === "" || SKIP.has(file)) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(REPO, file));
    } catch {
      continue; // deleted in the working tree, not yet staged
    }
    if (bytes.subarray(0, 8192).includes(0)) continue;
    out.set(file, bytes.toString("utf-8"));
  }
  return out;
}

function rpcFindings(text: string): string[] {
  const findings: string[] = [];
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(URL_PATTERN)) {
      const why = rpcShape(match[0], line.slice(0, match.index));
      if (why !== null) findings.push(`${index + 1}: ${match[0]} (${why})`);
    }
  });
  return findings;
}

describe("the SDK ships no RPC endpoints", () => {
  const sources = scanned([
    ...ROOTS,
    // `:(glob)` magic: `*` does not cross a `/`, so these name each directory's own files.
    ...TOP_LEVELS.map((dir) => `:(glob)${dir === "." ? "" : `${dir}/`}*`),
  ]);

  it("scans what it claims to", () => {
    // A root that moved would otherwise leave this guard passing over nothing.
    for (const root of ROOTS) {
      expect([...sources.keys()].some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
    for (const file of REQUIRED) expect(sources.has(file)).toBe(true);
  });

  it("no scanned file embeds an RPC-shaped URL, but the command's list of public ones", () => {
    const found = [...sources]
      .filter(([file]) => file !== PUBLIC_RPCS)
      .flatMap(([file, text]) => rpcFindings(text).map((finding) => `${file}:${finding}`));
    expect(found).toEqual([]);
    // The exception is scanned, and is what it claims to be: not an empty file that moved.
    expect(rpcFindings(sources.get(PUBLIC_RPCS)!).length).toBeGreaterThan(30);
  });

  it("nothing a browser loads reaches the public endpoints", () => {
    const shipped = scanned(SHIPPED_ROOTS);
    const importers = [...shipped]
      .filter(([, text]) => /from\s+["'][^"']*\/public-(?:rpcs|endpoints)(?:\.js)?["']/.test(text))
      .map(([file]) => file);
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) expect(file.startsWith("sdk/src/cli/")).toBe(true);
    // No export of the package reaches into the command: its modules are the bin's alone.
    const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(JSON.stringify(manifest.exports)).not.toMatch(/\/cli\//);
  });

  it("shipped code reads nothing from the environment but the variable --password-env names", () => {
    const shipped = scanned(SHIPPED_ROOTS);
    for (const file of SHIPPED_REQUIRED) expect(shipped.has(file)).toBe(true);
    const found = [...shipped].flatMap(([file, text]) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          /\bprocess\.env\b|\bimport\.meta\.env\b/.test(line)
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    const deliberate = found.filter(
      (finding) =>
        finding.startsWith(`${DELIBERATE_ENV_READ.file}:`) &&
        finding.endsWith(`: ${DELIBERATE_ENV_READ.line}`),
    );
    expect(deliberate).toHaveLength(1);
    expect(found.filter((finding) => !deliberate.includes(finding))).toEqual([]);
  });

  it("shipped code runs another process only where npm, a package manager, a password, the update check or a test chain needs one", () => {
    const shipped = scanned(SHIPPED_ROOTS);
    // run.ts: --password-command, and `sauce init --install`'s npm install; update.ts: the package
    // managers `sauce update` runs; runtime.ts: `npm ci` into a runtime folder. The three that reach
    // the npm registry, through npm and its user's configuration. update-check.ts: the update
    // check's refresh, a Node.js process of its own that reads it through `npm-registry.ts`.
    // The testing kit (`/testing`, Node only): node.ts starts anvil, the chain a test runs on (and
    // asks netstat, ss or lsof what holds a port it refuses), and state.ts the recorder, a Node.js
    // process of its own in front of the RPC the test names.
    const spawning = [...shipped]
      .filter(([, text]) => CHILD_PROCESS.test(text))
      .map(([file]) => file)
      .sort();
    // Every spelling of loading the module counts, so a new one cannot slip past.
    for (const spelling of [
      'import { spawn } from "node:child_process";',
      "import * as cp from 'child_process';",
      'const { spawn } = require("child_process");',
      'const cp = require("node:child_process");',
      'const cp = await import("node:child_process");',
      "const cp = await import('child_process');",
      'export { spawn } from "child_process";',
    ]) {
      expect([spelling, CHILD_PROCESS.test(spelling)]).toEqual([spelling, true]);
    }
    expect(spawning).toEqual([
      "dev-tools/src/testing/node.ts",
      "dev-tools/src/testing/state.ts",
      "sdk/src/cli/run.ts",
      "sdk/src/cli/runtime.ts",
      "sdk/src/cli/update-check.ts",
      "sdk/src/cli/update.ts",
    ]);
    // The runtime folder's installer is the process's only where the executable gives it.
    const importers = [...shipped]
      .filter(([, text]) => /from\s+["']\.\/runtime\.js["']/.test(text))
      .map(([file]) => file);
    expect(importers).toEqual(["sdk/src/cli/main.ts"]);
  });

  it("shipped code names the npm registry only in the module that reads it", () => {
    const shipped = scanned(SHIPPED_ROOTS);
    const naming = [...shipped]
      .filter(([, text]) => /registry\.npmjs\.org/.test(text))
      .map(([file]) => file);
    expect(naming).toEqual([NPM_REGISTRY]);
  });

  it("only the sauce command's own modules reach the registry, and only its executable starts it", () => {
    const shipped = scanned(IMPORTING_ROOTS);
    for (const [module, expected] of Object.entries(REGISTRY_READERS)) {
      const imports = new RegExp(String.raw`(?:from|import\()\s*["'][^"']*/${module}(?:\.js)?["']`);
      const found = [...shipped].filter(([, text]) => imports.test(text)).map(([file]) => file);
      expect([module, found.sort()]).toEqual([module, [...expected]]);
    }
    // The registry's only reads: `sauce update`'s packument, and the refresh's latest version.
    const reads = [...shipped].flatMap(([file, text]) =>
      [...text.matchAll(/\b(readPackument|readLatest|startDetached)\(/g)]
        .filter((match) => !/function\s+$/.test(text.slice(0, match.index)))
        .map((match) => `${file}: ${match[1]}`),
    );
    expect(reads.sort()).toEqual([
      "sdk/src/cli/update-check.ts: readLatest",
      "sdk/src/cli/update-check.ts: startDetached",
      "sdk/src/cli/update.ts: readPackument",
    ]);
    // The check and the updater are created by the executable alone: a module that imports
    // `run.ts` (a test, the skills checker) gets neither, so it reaches no registry.
    const created = [...shipped].flatMap(([file, text]) =>
      [...text.matchAll(/\b(nodeUpdateCheck|nodeUpdater)\(/g)]
        .filter((match) => !/function\s+$/.test(text.slice(0, match.index)))
        .map((match) => `${file}: ${match[1]}`),
    );
    expect(created.sort()).toEqual([
      "sdk/src/cli/main.ts: nodeUpdateCheck",
      "sdk/src/cli/main.ts: nodeUpdater",
    ]);
  });

  it("the RPC config example holds placeholders only", () => {
    const example = JSON.parse(sources.get("sdk/rpc.config.example.json")!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(example).length).toBeGreaterThan(0);
    for (const [chainId, value] of Object.entries(example)) {
      expect(chainId).toMatch(/^[1-9][0-9]*$/);
      expect(value).toMatch(/^<[^<>]+>$/);
    }
  });
});

describe("rpcShape", () => {
  // Assembled at runtime so this file never holds the literals it tests for.
  const url = (rest: string) => ["https", "://", rest].join("");

  it.each([
    ["a public chain endpoint on an rpc host", url("polygon-rpc.com"), ""],
    ["an RPC provider", url("mainnet.infura.io/v3/0123456789abcdef0123456789abcdef"), ""],
    ["a Solana public cluster", url("api.mainnet-beta.solana.com"), ""],
    ["a host with no rpc in it, by path", url("arb1.arbitrum.io/rpc"), ""],
    ["Avalanche's C-Chain path", url("api.avax.network/ext/bc/C/rpc"), ""],
    ["a key path on an unknown host", url("node.chain.xyz/v2/abcdefghijklmnopqrstuvwxyz"), ""],
    ["an /rpc path on an unknown host", url("node.chain.xyz/rpc"), ""],
    ["a public endpoint with no rpc in its host", url("mainnet.base.org"), ""],
    ["an unknown host bound to rpcUrls", url("node.chain.xyz"), '    rpcUrls: ["'],
    ["an unknown host bound to an RPC variable", url("node.chain.xyz"), 'const RPC = "'],
    ["an unknown host in an env-name table", url("node.chain.xyz"), '  1: ["ETH_RPC_URL", "'],
    ["an unknown host in a Viem chain", url("node.chain.xyz"), "rpcUrls: { default: { http: ["],
    // `rpcUrls` on an earlier line: only the `http: [` binding sees this one.
    ["an unknown host in a Viem http list", url("node.chain.xyz"), '    default: { http: ["'],
    ["an unknown host passed to a transport", url("node.chain.xyz"), 'transport: http("'],
    ["a templated provider URL", url("${chain}.infura.io/v3/${key}"), ""],
  ])("flags %s", (_name, candidate, prefix) => {
    expect(rpcShape(candidate, prefix)).not.toBeNull();
  });

  it.each([
    ["a loopback node", "http://127.0.0.1:8545", "    rpcUrls: { default: { http: ["],
    ["the LiteSVM stub", "http://127.0.0.1:65535/", "const LOCAL_RPC_URL = "],
    ["localhost", "http://localhost:8899", 'rpcUrl: "'],
    ["a reserved example domain", url("rpc.example.com"), 'rpcUrl: "'],
    ["a protocol website", url("uniswap.org"), '  website: "'],
    ["a block explorer", url("polygonscan.com"), '    blockExplorerUrls: ["'],
    ["an ABI source", url("api.routescan.io/v2/network/mainnet/evm/1/etherscan/api"), ""],
    ["a package registry", url("registry.npmjs.org/"), ""],
    ["a computed host", url("${host}/api/v2/smart-contracts/${address}"), ""],
  ])("allows %s", (_name, candidate, prefix) => {
    expect(rpcShape(candidate, prefix)).toBeNull();
  });
});
