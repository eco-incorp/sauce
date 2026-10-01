/**
 * `sauce globals`: the names a program on one chain may use without declaring them — everything
 * `routes.sourceGlobals` lists, which reads the same registries and the same resolver the compile
 * path does. Nothing here adds or filters a name beyond what `--tokens`, `--protocols` and
 * `--protocol` ask for.
 */
import { getAddress, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import {
  sourceGlobals,
  type SourceInterface,
  type SourceNamespace,
} from "../routes/source-globals.js";
import { SVM_TOKEN_REGISTRY } from "../routes/token-registry.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

export interface GlobalsInput {
  readonly chain: CanonicalChain;
  readonly tokens: boolean;
  readonly protocols: boolean;
  /** One namespace, by what a program writes (`UniswapV4`) or its slug (`uniswap-v4`). */
  readonly protocol?: string;
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
    `${one.namespace}.${one.name}.at(<address>)  interface (${one.protocolName}): no fixed address`,
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
  // No filter shows everything; any filter shows only what it names.
  const all = !input.tokens && !input.protocols && named === undefined;
  const showTokens = all || input.tokens;
  const showProtocols = all || input.protocols;
  const { chain } = globals;
  const text: string[] = [`${chain.key}: ${chain.slug}, chain id ${chain.id} (${chain.kind})`];
  if (one !== undefined) text.push("", ...namespaceLines(one, true));
  for (const bound of named?.interfaces ?? []) text.push("", ...interfaceLines(bound, true));
  const svm = chain.kind === "svm";
  // A devnet program compiles for the same chain, so its mints are not what a symbol resolves to:
  // they are listed for it to pass as defines, which override the registry's.
  const devnet = svm ? SVM_TOKEN_REGISTRY.devnet : [];
  if (showTokens && svm) {
    const rows = [...globals.tokens, ...devnet];
    const width = Math.max(0, ...rows.map((token) => token.symbol.length));
    const mintWidth = Math.max(0, ...rows.map((token) => (token.mint ?? "").length));
    const line = (token: (typeof rows)[number]): string =>
      `${token.symbol.padEnd(width)}  ${(token.mint ?? "").padEnd(mintWidth)}  ${token.address}  ` +
      `${token.decimals} decimals`;
    text.push(
      "",
      `Tokens (${globals.tokens.length}): the symbol is the mint's 32-byte key, a value for the ` +
        "@sauce/token functions: balanceOf(USDC, account)",
      ...globals.tokens.map((token) => `  ${line(token)}`),
      "  On devnet, pass a mint that differs as a define, which wins (--define USDC=0x…):",
      ...devnet.map((token) => `    ${line(token)}`),
      "  Any other mint: --define MINT=<mint, as 32-byte hex>. Token accounts are Account",
      "  parameters; USDC.transfer(…) and the other token methods are EVM-only.",
    );
  } else if (showTokens) {
    text.push(
      "",
      `Tokens (${globals.tokens.length}): <Sym>.transfer(…), or the symbol as an address`,
    );
    const width = Math.max(0, ...globals.tokens.map((token) => token.symbol.length));
    for (const token of globals.tokens) {
      text.push(`  ${token.symbol.padEnd(width)}  ${token.address}  ${token.decimals} decimals`);
    }
    text.push("  Any other token: Token(0x…).transfer(…)");
  }
  if (showProtocols && svm) {
    text.push("", "Protocols: none. Protocol namespaces are EVM contracts.");
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
        "program gives: <Namespace>.<Contract>.at(<address>).<method>(…)",
      ...globals.interfaces.map(
        (bound) => `  ${bound.namespace}.${bound.name}  (${bound.protocolName})`,
      ),
    );
  }
  if (all) {
    text.push(
      "",
      "Chains: open an intent with <Chain>(() => { … }), or qualify an accessor as <Chain>.<Namespace>",
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
      ...(showTokens ? { tokens: globals.tokens } : {}),
      ...(showTokens && svm ? { devnetTokens: devnet } : {}),
      // The interfaces asked for: every one beside the namespaces, or --protocol's own.
      ...(showProtocols
        ? { protocols: globals.protocols, interfaces: globals.interfaces }
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
          }
        : {}),
    },
  };
}
