/**
 * The SDK ships no RPC endpoints, and shipped code reads nothing from the environment. Anything that
 * needs a network connection takes its URL, or a client, from the developer — as an argument or a
 * config value, never a default, a public fallback or `process.env` (a browser has none).
 *
 * This guard scans the TRACKED source that ships or that a developer copies from — `sdk/src`,
 * `sdk/scripts`, `actions/src`, `dev-tools/src`, `dev-tools/scripts`, `docs/`, the workflows, and
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
];
/** Generated, not authored: its URLs are package tarballs. */
const SKIP = new Set(["pnpm-lock.yaml"]);
/** Shipped code: must not read the environment at all. */
const SHIPPED_ROOTS = ["sdk/src", "actions/src", "dev-tools/src"];

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

  it("no scanned file embeds an RPC-shaped URL", () => {
    const found = [...sources].flatMap(([file, text]) =>
      rpcFindings(text).map((finding) => `${file}:${finding}`),
    );
    expect(found).toEqual([]);
  });

  it("shipped code reads nothing from the environment", () => {
    const found = [...scanned(SHIPPED_ROOTS)].flatMap(([file, text]) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          /\bprocess\.env\b|\bimport\.meta\.env\b/.test(line)
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
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
    ["a key path", url("eth-mainnet.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz"), ""],
    ["a public endpoint with no rpc in its host", url("mainnet.base.org"), ""],
    ["an unknown host bound to rpcUrls", url("node.chain.xyz"), '    rpcUrls: ["'],
    ["an unknown host bound to an RPC variable", url("node.chain.xyz"), 'const RPC = "'],
    ["an unknown host in an env-name table", url("node.chain.xyz"), '  1: ["ETH_RPC_URL", "'],
    ["an unknown host in a Viem chain", url("node.chain.xyz"), "rpcUrls: { default: { http: ["],
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
