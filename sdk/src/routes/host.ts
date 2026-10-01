/**
 * The names a program compiled for one chain can use, given to the compiler as its HOST: the
 * compiler asks `declare` about each name the program reads and does not bind itself, and lowers
 * the answer. Nothing here touches the program's text.
 *
 * What a chain's host declares:
 *
 *  - its token symbols (`USDC`), as constants of the `Token` type, whose methods are `@sauce/token`
 *    functions taking the token first (`USDC.transfer(to, amount)` is `transfer(USDC, to, amount)`,
 *    with SafeERC20 semantics) and whose property makes `holder.USDC` the holder's balance;
 *  - `Token(address)`, a cast of any address to that type;
 *  - `self`, the contract running the program;
 *  - `chainId`/`CHAIN_ID` and each protocol contract's address key (`UniswapV3_Factory`);
 *  - every protocol contract, by the names the registry gives it: `UniswapV3.Factory`, a family's
 *    `Uniswap.UniversalRouter`, a protocol's one contract as `Protocol`, an interface as a contract
 *    with no address (`Erc4626.Vault.at(vault)`), and any of them on another chain as
 *    `Arbitrum.UniswapV3.Factory`.
 *
 * A name some chain has and this one lacks is declared too: as the zero of its type, `unusable`
 * with a message saying so. A program guards on it with a comparison the compiler decides —
 * `if (UniswapV3.Factory != 0) { ... }` — and any other use is that message, located at the use.
 * A name no chain has is not declared, so a typo stays the compiler's own unknown-name error.
 *
 * On a Solana chain the token symbols are the mints' keys, plain words for the `@sauce/token` SVM
 * functions, and there is no `Token` type: an SPL write needs accounts the symbol does not carry.
 */
import type {
  BoundArgument,
  CallSite,
  Declaration,
  HostType,
  ModuleFunction,
  ProgramOptions,
  ProgramSite,
} from "sauce-compiler";

import type { CanonicalChain } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { loadPluginData } from "../plugin/index.js";
import { chainSlugForKey, isChainKey, resolveNamespace, type Namespace } from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";
import type { AccessorTarget, ProtocolNameOptions } from "./protocol-names.js";
import { registryTokenSymbols, resolveTokenMap } from "./token-registry.js";
import type { AddressInput } from "./types.js";

/** The `@sauce/token` functions the `Token` type's methods call. */
const TOKEN_MODULE = "@sauce/token";
/** The module `self` reads through. */
const CONTEXT_MODULE = "@sauce/context";

const token = (name: string): ModuleFunction => ({ module: TOKEN_MODULE, export: name });
const value = { kind: "value" } as const;

/** The token type every EVM chain shares: an address, with SafeERC20 writes and a balance read. */
const TOKEN_TYPE: HostType = {
  of: "Address",
  methods: {
    transfer: { params: [value, value], calls: token("transfer"), recordable: true },
    approve: { params: [value, value], calls: token("approve"), recordable: true },
    transferFrom: { params: [value, value, value], calls: token("transferFrom") },
    balanceOf: { params: [value], calls: token("balanceOf") },
  },
  property: token("balanceOf"),
};

/** The `Token` type's method names, which no registry symbol may share. */
export const TOKEN_METHODS: ReadonlySet<string> = new Set(Object.keys(TOKEN_TYPE.methods ?? {}));

/** What a chain's host is configured with beyond the chain itself. */
export interface ChainHostOptions {
  /** Token symbol -> address overrides, merged per key over the chain's registry. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
  /** The protocol-name policy: chain qualification, widened ABIs, and who hears each contract. */
  readonly accessors?: boolean | ProtocolNameOptions;
  /** This chain's own values for its scalar names (`chainId`, `UniswapV3_Factory`), chosen by the
   *  caller over the registry's — for this chain only, as `tokens` is. */
  readonly values?: Readonly<Record<string, bigint>>;
}

/** Whether `name` is a scalar some chain gives its programs: `chainId`, or a protocol contract's
 *  address key (`UniswapV3_Factory`). */
export function isChainScalar(name: string): boolean {
  return name === "chainId" || name === "CHAIN_ID" || protocolAddressKeys().has(name);
}

/** The host options a compile for one chain passes the compiler. */
export interface ChainHost {
  readonly declare: (name: string) => Declaration | undefined;
  readonly types: Record<string, HostType>;
  readonly hostModules: string[];
  readonly nested?: (site: ProgramSite) => ProgramOptions;
  readonly bind?: (site: CallSite) => BoundArgument[];
}

/** `names`, with `more`'s declarations where `names` has none, and its types, modules and calls. */
export function withHost(names: ChainHost, more: ChainHost | undefined): ChainHost {
  if (more === undefined) return names;

  return {
    declare: (name) => names.declare(name) ?? more.declare(name),
    types: { ...names.types, ...more.types },
    hostModules: [...names.hostModules, ...more.hostModules],
    nested: more.nested ?? names.nested,
    bind: more.bind ?? names.bind,
  };
}

class HostNameError extends Error {}

const fail = (message: string): never => {
  throw new HostNameError(message);
};

const word = (value: bigint | string): string =>
  typeof value === "bigint" ? `0x${value.toString(16)}` : value;

/** The zero of `type`, which every use but a comparison refuses with `reason`. */
const absent = (type: string, reason: string): Declaration => ({
  kind: "constant",
  value: "0",
  type,
  unusable: reason,
});

/** The protocol-address keys (`UniswapV3_Factory`) the registry has on some chain, and where. */
let addressKeys: ReadonlyMap<string, Readonly<Record<number, string>>> | undefined;
function protocolAddressKeys(): ReadonlyMap<string, Readonly<Record<number, string>>> {
  addressKeys ??= new Map(
    loadPluginData().protocolAddresses.map((d) => [
      `${pascalOfSlug(d.protocol)}_${d.contract}`,
      d.perChainAddress as Readonly<Record<number, string>>,
    ]),
  );
  return addressKeys;
}

/**
 * The host for a program compiled for `chain`. `declare` answers from the registries the SDK
 * already keeps; nothing is enumerated up front, so a compile asks only about the names it uses.
 */
export function chainHost(chain: CanonicalChain, options: ChainHostOptions = {}): ChainHost {
  const tokens = resolveTokenMap(chain, options.tokens);
  const policy: ProtocolNameOptions =
    typeof options.accessors === "object" ? options.accessors : {};
  const protocols = options.accessors !== false;
  const chainScope =
    policy.chainScope === undefined
      ? undefined
      : new Set(policy.chainScope.map((ref) => requireChain(ref).id));
  const evm = chain.kind === "evm";

  const tokenDeclaration = (symbol: string, on: CanonicalChain): Declaration | undefined => {
    const map = on.id === chain.id ? tokens : resolveTokenMap(on);
    const address = map.get(symbol);
    const type = on.kind === "evm" ? "Token" : "Uint256";
    if (address !== undefined) return { kind: "constant", value: word(address), type };
    if (!registryTokenSymbols().has(symbol) && !(options.tokens ?? {})[symbol]) return undefined;

    return absent(type, `\`${symbol}\` is not a token ${on.slug} registers`);
  };

  /** `<Protocol|Family>[.<Contract>]` on `on`, or `undefined` when the path names no contract. */
  const contractDeclaration = (
    reference: string,
    namespace: Namespace,
    contractName: string | undefined,
    on: CanonicalChain,
  ): Declaration | undefined => {
    const found = descriptorOf(namespace, contractName);
    if (found === undefined) return undefined;
    const { protocol, contract, descriptor } = found;
    const address = addressOn(descriptor, on);
    const where =
      `Contract '${contract}' (${protocol}) is not deployed on '${on.slug}'` +
      ` (available: ${descriptor.chains.length > 0 ? descriptor.chains.join(", ") : "(none)"})`;

    if (descriptor.kind === "address-only") {
      if (address === undefined) return absent("Address", where);
      report(reference, { chain: on, protocol, contract, descriptor, address });

      return { kind: "constant", value: address, type: "Address" };
    }
    const abi = JSON.stringify(descriptor.abi);
    if (descriptor.kind === "interface") return { kind: "contract", abi };
    if (descriptor.coverage.typeFidelity === "widened" && policy.allowWidenedSelectors !== true) {
      return {
        kind: "contract",
        abi,
        address: address ?? "0",
        unusable:
          `${protocol}.${contract}'s vendored ABI is "widened" (computed selectors do NOT match ` +
          `the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — pass accessors: ` +
          "{ allowWidenedSelectors: true } to use it anyway",
      };
    }
    if (address === undefined) return { kind: "contract", abi, address: "0", unusable: where };
    report(reference, { chain: on, protocol, contract, descriptor, address });

    return { kind: "contract", abi, address };
  };

  const report = (reference: string, target: AccessorTarget): void => {
    policy.onContract?.(reference, target);
  };

  /** `rest` — `[Protocol]` or `[Protocol, Contract]` — as a contract on `on`. */
  const protocolPath = (
    reference: string,
    rest: readonly string[],
    on: CanonicalChain,
  ): Declaration | undefined => {
    if (!protocols || rest.length === 0 || rest.length > 2) return undefined;
    const namespace = resolveNamespace(rest[0]!);
    if (namespace === undefined) return undefined;
    // A Solana program calls no EVM contract: every registry name is absent there.
    if (!evm) {
      return rest.length === 2 && descriptorOf(namespace, rest[1]) === undefined
        ? undefined
        : absent("Address", `\`${reference}\` is an EVM contract; ${chain.slug} has none`);
    }
    if (rest.length === 2) return contractDeclaration(reference, namespace, rest[1], on);
    // A protocol's one contract stands for the protocol (`Aave.supply(...)`). A protocol with
    // several is a namespace only: asked about on its own, it names no single contract.
    if (namespace.kind === "protocol" && namespace.defaultContract !== undefined) {
      return contractDeclaration(reference, namespace, undefined, on);
    }
    const known =
      namespace.kind === "protocol"
        ? [...namespace.contracts.keys()]
        : [...namespace.contractOwners.keys()];

    return fail(
      `'${reference}' names no single contract — it has ${known.join(", ")}: use ` +
        `'${reference}.<Contract>'`,
    );
  };

  const declare = (name: string): Declaration | undefined => {
    const segments = name.split(".");
    const [head] = segments as [string, ...string[]];

    if (segments.length === 1) {
      if (head === "self")
        return { kind: "getter", calls: { module: CONTEXT_MODULE, export: "self" } };
      if (head === "Token" && evm) {
        return { kind: "function", signatures: [{ params: [value], returns: "Token" }] };
      }
      const chosen = options.values?.[head];
      if (chosen !== undefined) {
        const address = protocolAddressKeys().has(head);
        return { kind: "constant", value: word(chosen), type: address ? "Address" : "Uint256" };
      }
      if (head === "chainId" || head === "CHAIN_ID") {
        return { kind: "constant", value: String(chain.id) };
      }
      const symbol = tokenDeclaration(head, chain);
      if (symbol !== undefined) return symbol;
      const key = protocolAddressKeys().get(head);
      if (key !== undefined && evm) {
        const address = key[chain.id];
        return address === undefined
          ? absent("Address", `\`${head}\` has no deployment on ${chain.slug}`)
          : { kind: "constant", value: address, type: "Address" };
      }

      return protocolPath(name, segments, chain);
    }

    // `<Chain>.<…>`: a name on another chain — its contract, or its token.
    if (isChainKey(head)) {
      const slug = chainSlugForKey(head)!;
      const on = requireChain(slug);
      if (chainScope !== undefined && !chainScope.has(on.id)) {
        return fail(
          `chain '${on.slug}' (referenced as '${head}....') is outside the allowed chainScope`,
        );
      }
      const rest = segments.slice(1);
      if (rest.length === 1) {
        const symbol = tokenDeclaration(rest[0]!, on);
        if (symbol !== undefined) return symbol;
      }

      return protocolPath(name, rest, on);
    }

    return protocolPath(name, segments, chain);
  };

  return {
    declare,
    types: evm ? { Token: TOKEN_TYPE } : {},
    hostModules: evm ? [TOKEN_MODULE, CONTEXT_MODULE] : [CONTEXT_MODULE],
  };
}

/**
 * The contract `<namespace>.<contractName>` names — the namespace's default contract when no name
 * is given — or `undefined` when the name is not one of its contracts (it may be a method:
 * `Aave.supply` asks about `Aave.supply` before `Aave`). An ambiguous family name is an error.
 */
function descriptorOf(
  namespace: Namespace,
  contractName: string | undefined,
):
  | {
      readonly protocol: string;
      readonly contract: string;
      readonly descriptor: ContractDescriptor;
    }
  | undefined {
  if (namespace.kind === "protocol") {
    const contract = contractName ?? namespace.defaultContract;
    const descriptor = contract === undefined ? undefined : namespace.contracts.get(contract);

    return descriptor === undefined
      ? undefined
      : { protocol: namespace.protocol, contract: contract!, descriptor };
  }
  if (contractName === undefined) return undefined;
  const owners = namespace.contractOwners.get(contractName);
  if (owners === undefined || owners.length === 0) return undefined;
  if (owners.length > 1) {
    const candidates = owners.map((slug) => `${pascalOfSlug(slug)}.${contractName}`).join(" or ");
    return fail(
      `"${contractName}" is ambiguous under ${namespace.familyKey} (${owners.join(", ")}) — use ` +
        candidates,
    );
  }
  const member = resolveNamespace(pascalOfSlug(owners[0]!));
  if (member === undefined || member.kind !== "protocol") return undefined;
  const descriptor = member.contracts.get(contractName);

  return descriptor === undefined
    ? undefined
    : { protocol: owners[0]!, contract: contractName, descriptor };
}

export { HostNameError };
