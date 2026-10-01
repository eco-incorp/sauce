/**
 * `sauce globals`: the names a program on one chain may use without declaring them — everything
 * `routes.sourceGlobals` lists, which reads the same registries and the same resolver the compile
 * path does. Nothing here adds or filters a name beyond what `--tokens`, `--protocols` and
 * `--protocol` ask for.
 */
import { getAddress, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { sourceGlobals, type SourceNamespace } from "../routes/source-globals.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

export interface GlobalsInput {
  readonly chain: CanonicalChain;
  readonly tokens: boolean;
  readonly protocols: boolean;
  /** One namespace, by what a program writes (`UniswapV4`) or its slug (`uniswap-v4`). */
  readonly protocol?: string;
}

/** A define as JSON: an address-sized value as its checksummed address, anything else in decimal. */
function defineValue(value: bigint | boolean | number): string | boolean | number {
  if (typeof value !== "bigint") return value;

  return value >= 1n << 64n && value < 1n << 160n
    ? getAddress(numberToHex(value, { size: 20 }))
    : value.toString();
}

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function namespaceNamed(namespaces: readonly SourceNamespace[], name: string): SourceNamespace {
  const wanted = squash(name);
  const found =
    namespaces.find((ns) => ns.namespace === name) ??
    namespaces.find(
      (ns) =>
        squash(ns.namespace) === wanted ||
        (ns.kind === "protocol" && ns.protocols.some((slug) => squash(slug) === wanted)),
    );
  if (found === undefined) {
    throw new UsageError(
      `--protocol: '${name}' is not a namespace a program can use here; the chain has ` +
        (namespaces.length === 0 ? "none" : namespaces.map((ns) => ns.namespace).join(", ")),
    );
  }

  return found;
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
  const one =
    input.protocol === undefined ? undefined : namespaceNamed(globals.protocols, input.protocol);
  // No filter shows everything; any filter shows only what it names.
  const all = !input.tokens && !input.protocols && one === undefined;
  const showTokens = all || input.tokens;
  const showProtocols = all || input.protocols;
  const { chain } = globals;
  const text: string[] = [`${chain.key}: ${chain.slug}, chain id ${chain.id} (${chain.kind})`];
  if (one !== undefined) text.push("", ...namespaceLines(one, true));
  const svm = chain.kind === "svm";
  if (showTokens && svm) {
    text.push(
      "",
      "Tokens: none by symbol. An SVM program takes its token accounts as Account parameters and",
      "moves them with the @sauce/token functions below.",
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
      ...(showProtocols ? { protocols: globals.protocols } : {}),
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
