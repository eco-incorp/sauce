/**
 * `sauce globals`: the names a program on one chain may use without declaring them — everything
 * `routes.sourceGlobals` lists, which reads the same registries and the same resolver the compile
 * path does. Nothing here adds or filters a name beyond what `--tokens`, `--protocols`,
 * `--protocol`, `--stocks` and `--search` ask for. A chain's tokenized stocks (Ethereum has over a
 * thousand) are counted, not listed, until `--stocks` lists them or `--search` finds one.
 */
import { getAddress, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import {
  sourceGlobals,
  type SourceInterface,
  type SourceNamespace,
  type SourceToken,
} from "../routes/source-globals.js";
import { STOCK_ISSUERS } from "../routes/stock-tokens.js";
import { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "../routes/token-registry.js";
import { TOKEN_2022_PROGRAM_ID } from "../svm/token-program.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

export interface GlobalsInput {
  readonly chain: CanonicalChain;
  readonly tokens: boolean;
  readonly protocols: boolean;
  /** One namespace, by what a program writes (`UniswapV4`) or its slug (`uniswap-v4`). */
  readonly protocol?: string;
  /** The chain's tokenized stocks, instead of its other tokens. */
  readonly stocks?: boolean;
  /** The tokens, stocks included, whose symbol, name, ticker or issuer contains this text. */
  readonly search?: string;
}

/** A token as `sauce globals --json` gives it: a stock's with its issuer's name and list. */
function tokenJson(token: SourceToken): object {
  if (token.stock === undefined) return token;
  const issuer = STOCK_ISSUERS[token.stock.issuer];

  return { ...token, stock: { ...token.stock, issuerName: issuer.name, source: issuer.source } };
}

/** What a search for `text` matches a token by: its symbol, and a stock's name, ticker and issuer,
 *  or the ticker of a stock another issuer names that way. Coinbase names SpaceX "Space
 *  Exploration Technologies Corp.", and Backed "SpaceX xStock": both are SPCX. */
function searcher(text: string): (token: SourceToken) => boolean {
  const wanted = text.toLowerCase();
  const has = (field: string): boolean => field.toLowerCase().includes(wanted);
  const tickers = new Set(
    [...Object.values(TOKEN_REGISTRY), ...Object.values(SVM_TOKEN_REGISTRY)].flatMap((rows) =>
      rows.flatMap((row) =>
        row.stock !== undefined && has(row.stock.name) ? [row.stock.ticker] : [],
      ),
    ),
  );

  return (token) =>
    has(token.symbol) ||
    has(token.mint ?? "") ||
    (token.stock !== undefined &&
      (has(token.stock.name) ||
        has(token.stock.ticker) ||
        has(STOCK_ISSUERS[token.stock.issuer].name) ||
        tickers.has(token.stock.ticker)));
}

/** A define as JSON: an address-sized value as its checksummed address, a wider one (a Solana
 *  mint's key) as 32 bytes of hex, anything else in decimal. */
function defineValue(value: bigint | boolean | number): string | boolean | number {
  if (typeof value !== "bigint") return value;
  if (value >= 1n << 160n && value < 1n << 256n) return numberToHex(value, { size: 32 });

  return value >= 1n << 64n && value < 1n << 160n
    ? getAddress(numberToHex(value, { size: 20 }))
    : value.toString();
}

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The namespace `--protocol` names: its deployed contracts on the chain, its interfaces, or
 *  both. */
interface Named {
  readonly namespace?: SourceNamespace;
  readonly interfaces: readonly SourceInterface[];
}

function namespaceNamed(
  namespaces: readonly SourceNamespace[],
  interfaces: readonly SourceInterface[],
  name: string,
): Named {
  const wanted = squash(name);
  const found =
    namespaces.find((ns) => ns.namespace === name) ??
    namespaces.find(
      (ns) =>
        squash(ns.namespace) === wanted ||
        (ns.kind === "protocol" && ns.protocols.some((slug) => squash(slug) === wanted)),
    );
  const key = found?.namespace;
  const bound = interfaces.filter((one) =>
    key === undefined
      ? one.namespace === name ||
        squash(one.namespace) === wanted ||
        squash(one.protocol) === wanted
      : one.namespace === key,
  );
  if (found === undefined && bound.length === 0) {
    const names = [...new Set([...namespaces, ...interfaces].map((ns) => ns.namespace))].sort();
    throw new UsageError(
      `--protocol: '${name}' is not a namespace a program can use here; the chain has ` +
        (names.length === 0 ? "none" : names.join(", ")),
    );
  }

  return { ...(found === undefined ? {} : { namespace: found }), interfaces: bound };
}

/** An interface's lines: how a program binds it, and with `methods` what it can call. */
function interfaceLines(one: SourceInterface, methods: boolean): string[] {
  return [
    `${one.namespace}.${one.name}(<address>)  interface (${one.protocolName}): no fixed address`,
    ...(methods
      ? one.methods.map((method) => `  ${method.declaration}  ${method.stateMutability}`)
      : []),
  ];
}

function namespaceLines(ns: SourceNamespace, methods: boolean): string[] {
  const head =
    ns.kind === "family"
      ? `${ns.namespace}  (alias over ${ns.protocols.join(", ")})`
      : `${ns.namespace}  (${ns.name})`;
  const width = Math.max(...ns.contracts.map((contract) => contract.name.length));

  return [
    head,
    ...ns.contracts.flatMap((contract) => [
      `  ${contract.name.padEnd(width)}  ${contract.address}${contract.default ? "  default" : ""}` +
        (ns.kind === "family" ? `  (${contract.protocol})` : ""),
      ...(methods
        ? contract.methods.map((method) => `    ${method.declaration}  ${method.stateMutability}`)
        : []),
    ]),
  ];
}

/** `sauce globals`: the chain's tokens, protocol namespaces, chain names and ambient functions. */
export function globalsCommand(input: GlobalsInput): CommandOutput {
  const globals = sourceGlobals(input.chain);
  const named =
    input.protocol === undefined
      ? undefined
      : namespaceNamed(globals.protocols, globals.interfaces, input.protocol);
  const one = named?.namespace;
  const search = input.search?.trim();
  if (input.search !== undefined && !search)
    throw new UsageError("--search: give the text to find");
  // No filter shows everything; any filter shows only what it names.
  const all = !input.tokens && !input.protocols && named === undefined && !input.stocks && !search;
  const showTokens = all || input.tokens || input.stocks === true || search !== undefined;
  const showProtocols = all || input.protocols;
  // The tokens listed: a search's matches, the chain's stocks, or its other tokens.
  const stocks = globals.tokens.filter((token) => token.stock !== undefined);
  const listed =
    search !== undefined
      ? globals.tokens.filter(searcher(search))
      : input.stocks === true
        ? stocks
        : globals.tokens.filter((token) => token.stock === undefined);
  const { chain } = globals;
  const text: string[] = [`${chain.key}: ${chain.slug}, chain id ${chain.id} (${chain.kind})`];
  if (one !== undefined) text.push("", ...namespaceLines(one, true));
  for (const bound of named?.interfaces ?? []) text.push("", ...interfaceLines(bound, true));
  const svm = chain.kind === "svm";
  // A devnet program compiles for the same chain, so its mints are not what a symbol resolves to:
  // they are listed for it to pass as defines, which override the registry's. It has no stocks.
  const devnet = !svm || input.stocks === true ? [] : SVM_TOKEN_REGISTRY.devnet;
  if (showTokens && svm) {
    const devnetListed = search === undefined ? devnet : devnet.filter(searcher(search));
    const rows = [...listed, ...devnetListed];
    const width = Math.max(0, ...rows.map((token) => token.symbol.length));
    const mintWidth = Math.max(0, ...rows.map((token) => (token.mint ?? "").length));
    // A Token-2022 mint says so: its writes are the checked ones, and its accounts derive under it.
    // A stock with what it is, so a search for the company finds its token.
    const line = (token: (typeof rows)[number]): string =>
      `${token.symbol.padEnd(width)}  ${(token.mint ?? "").padEnd(mintWidth)}  ${token.address}  ` +
      `${token.decimals} decimals${token.tokenProgram === TOKEN_2022_PROGRAM_ID ? ", Token-2022" : ""}` +
      (token.stock === undefined
        ? ""
        : `  ${token.stock.name} (${token.stock.ticker}, ${STOCK_ISSUERS[token.stock.issuer].name})`);
    const what =
      search !== undefined
        ? `Tokens matching '${search}' (${listed.length})`
        : input.stocks === true
          ? `Stock tokens (${listed.length}): tokenized stocks, each a Token-2022 mint`
          : `Tokens (${listed.length})`;
    text.push(
      "",
      `${what}: USDC.transfer(to, amount), pot.USDC, USDC.balanceOf(who); the symbol alone is ` +
        "the mint's 32-byte key, a value for the @sauce/token functions: balanceOf(USDC, account)",
      ...listed.map((token) => `  ${line(token)}`),
      ...(search === undefined && input.stocks !== true && stocks.length > 0
        ? [
            `  And ${stocks.length} stock tokens, named the same way: --stocks lists them, and ` +
              "--search <text> finds one by symbol, name or ticker",
          ]
        : []),
      ...(devnetListed.length === 0
        ? []
        : [
            "  On devnet a mint differs: take it as an Address argument of main, and pass its key:",
            ...devnetListed.map((token) => `    ${line(token)}`),
          ]),
      "  Any other mint: Token(mint), with mint an Address argument of main, passed as its base58",
      "  key. A token method's accounts are added to main and derived when the cook is built, so",
      "  its holders are known then: pot (the Pot), an Address argument of main, or a key.",
    );
  } else if (showTokens) {
    const what =
      search !== undefined
        ? `Tokens matching '${search}' (${listed.length})`
        : input.stocks === true
          ? `Stock tokens (${listed.length}): tokenized stocks`
          : `Tokens (${listed.length})`;
    text.push("", `${what}: <Sym>.transfer(…), or the symbol as an address`);
    const width = Math.max(0, ...listed.map((token) => token.symbol.length));
    for (const { symbol, address, decimals, stock } of listed) {
      // A stock with what it is, so a search for the company finds its token.
      const about =
        stock === undefined
          ? ""
          : `  ${stock.name} (${stock.ticker}, ${STOCK_ISSUERS[stock.issuer].name})`;
      text.push(`  ${symbol.padEnd(width)}  ${address}  ${decimals} decimals${about}`);
    }
    if (search === undefined && input.stocks !== true && stocks.length > 0) {
      text.push(
        `  And ${stocks.length} stock tokens, named the same way: --stocks lists them, and ` +
          "--search <text> finds one by symbol, name or ticker",
      );
    }
    text.push("  Any other token: Token(0x…).transfer(…)");
  }
  if (showProtocols && svm) {
    const width = Math.max(0, ...globals.venues.map((venue) => venue.namespace.length));
    text.push(
      "",
      `Venues (${globals.venues.length}): <Protocol>.<Program>.swap(pool, tokenIn, tokenOut, ` +
        "amountIn, priceLimit, minOut), which returns 0 having moved nothing where the pool cannot " +
        "trade and reverts below minOut; the pool's accounts, and the Pot's, are derived when the " +
        "cook is built. Its pool by key, <Protocol>.<Program>.pool(tokenA, tokenB, key), where the " +
        "venue has one: a key with no pool there is an empty slot, which the swap skips",
      ...globals.venues.map((venue) => {
        const pool = venue.methods.find((method) => method.startsWith("pool("));
        const key =
          pool === undefined ? "by address" : /, fee: /.test(pool) ? "by fee" : "by tick spacing";

        return `  ${venue.namespace.padEnd(width)}  ${venue.program}  (${venue.name}; pools ${key})`;
      }),
      "Protocols: none. Protocol namespaces are EVM contracts.",
    );
  } else if (showProtocols) {
    text.push(
      "",
      `Protocols (${globals.protocols.length}): <Namespace>.<Contract>.<method>(…); ` +
        "`sauce globals --protocol <name>` lists the methods",
    );
    for (const ns of globals.protocols)
      text.push(...namespaceLines(ns, false).map((l) => `  ${l}`));
    text.push(
      "",
      `Interfaces (${globals.interfaces.length}): an ABI with no fixed address, bound to one the ` +
        "program gives: <Namespace>.<Interface>(<address>).<method>(…)",
      ...globals.interfaces.map(
        (bound) => `  ${bound.namespace}.${bound.name}  (${bound.protocolName})`,
      ),
    );
  }
  if (all && svm) {
    const width = Math.max(0, ...globals.accounts.map((one) => one.expression.length));
    text.push(
      "",
      `Accounts (${globals.accounts.length}): written where a program uses them, each added to ` +
        "main, derived when the cook is built and checked on chain; read-only unless " +
        ".writable() or .signer() gives it that role",
      ...globals.accounts.map(
        (one) => `  ${one.expression.padEnd(width)}  ${one.account}: ${one.derive}`,
      ),
    );
  }
  if (all) {
    text.push(
      "",
      "Chains: qualify an accessor as <Chain>.<Namespace>",
      `  ${globals.chains.map((other) => other.key).join(", ")}`,
      "",
      svm
        ? "Defines: chainId"
        : "Defines: chainId, and <Namespace>_<Contract> for each contract's address",
    );
    for (const module of globals.modules) {
      text.push("", `Functions from ${module.specifier} (no import):`);
      for (const fn of module.functions) text.push(`  ${fn}`);
    }
  }

  return {
    text: text.join("\n"),
    json: {
      chain,
      ...(one === undefined ? {} : { protocol: one }),
      ...(showTokens ? { tokens: listed.map(tokenJson) } : {}),
      ...(showTokens && svm && input.stocks !== true
        ? { devnetTokens: search === undefined ? devnet : devnet.filter(searcher(search)) }
        : {}),
      // The interfaces asked for: every one beside the namespaces, or --protocol's own.
      ...(showProtocols
        ? {
            protocols: globals.protocols,
            interfaces: globals.interfaces,
            ...(svm ? { venues: globals.venues } : {}),
          }
        : named !== undefined && named.interfaces.length > 0
          ? { interfaces: named.interfaces }
          : {}),
      ...(all
        ? {
            chains: globals.chains,
            defines: Object.fromEntries(
              Object.entries(globals.defines).map(([name, value]) => [name, defineValue(value)]),
            ),
            modules: globals.modules,
            ...(svm ? { accounts: globals.accounts } : {}),
          }
        : {}),
    },
  };
}
