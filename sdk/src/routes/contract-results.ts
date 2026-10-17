/**
 * A registry call's result, called straight on: `UniswapV3.Factory.getPool(USDC, WETH, 500).liquidity()`.
 *
 * The registry knows which contract some functions return (`targets.json`'s `returns`, generated
 * into each descriptor method's `returns`): a factory's pool, a pool's tokens, a vault's asset. A
 * method called on such a result (the call itself, a field of the record it returns, or a `const`
 * holding either) is rewritten to the spelling that names the contract, which the later passes
 * lower as they always have:
 *
 *   `UniswapV3.Factory.getPool(a, b, 500).liquidity()`
 *     -> `UniswapV3.Pool(UniswapV3.Factory.getPool(a, b, 500)).liquidity()`          an interface
 *   `AerodromeSlipstream.NonfungiblePositionManager.factory().tickSpacingToFee(100)`
 *     -> `AerodromeSlipstream.CLFactory.at(<the call>).tickSpacingToFee(100)`        a named contract
 *   `Erc4626.Vault(vault).asset().transfer(to, amount)`
 *     -> `Token(Erc4626.Vault(vault).asset()).transfer(to, amount)`                  a token's write
 *   `Erc4626.Vault(vault).asset().decimals()`
 *     -> `Erc20.ERC20(Erc4626.Vault(vault).asset()).decimals()`                      a token's read
 *
 * So a chained program IS the explicit one, byte for byte: nothing new reaches the compiler. A
 * token's writes take `Token(...)`, whose lowering (the token pass) is `@sauce/token`'s SafeERC20
 * write, never the ABI's unchecked `transfer`. `const pool = UniswapV3.Factory.getPool(...)` keeps
 * the address, and each `pool.<method>(...)` is rewritten the same way, so `pool` stays a value the
 * program may compare, pass or return. That `const` must be the program's only declaration of the
 * name, the whole-program rule the other passes apply, so every `pool` is that one.
 *
 * It runs BEFORE the token pass (`sauce-route.ts`), whose `Token(...)` lowering a token's writes
 * rely on, and claims only CALLS: `pool.USDC`, a member that is not called, is the token pass's
 * balance read. A builtin value method (`.catch(...)`, `.toBytesBe(...)`) is the compiler's, on any
 * result.
 *
 * A method called on an address a registry function returns that the registry does not know the
 * contract of is refused here, naming the explicit spelling, rather than reaching the compiler as a
 * call that "does not name a function".
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { DESCRIPTORS } from "../descriptors/registry.js";
import type { ContractDescriptor, DescriptorMethod } from "../descriptors/types.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { countDeclarations, walk, type AstNode } from "./ast-walk.js";
import { isChainKey, resolveNamespace } from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";
import { parseSauce } from "./parse.js";
import { decomposeMemberChain, resolveContractReference } from "./protocol-rewrite.js";
import { methodCall, SAFE_WRITES, TOKEN_FACTORY_NAME } from "./token-rewrite.js";

/**
 * The language's own methods on a value (`skills/sauce-script/references/builtins.json`'s `method`
 * group, and `.catch`), which any result takes: never a contract's.
 */
export const VALUE_METHODS: ReadonlySet<string> = new Set([
  "catch",
  "concat",
  "slice",
  "toBe",
  "toBytesBe",
  "toBytesLe",
  "toLe",
]);

export interface ContractResultsResult {
  readonly source: string;
  readonly rewrote: boolean;
  /** Count of method calls rewritten onto the contract their receiver is. */
  readonly sites: number;
}

function fail(message: string): never {
  throw new Error(`rewriteContractResults: ${message}`);
}

/** A registry contract as a program names it: `UniswapV3.Pool`. */
const named = (contract: ContractDescriptor): string =>
  `${pascalOfSlug(contract.protocol)}.${contract.contract}`;

const isToken = (contract: ContractDescriptor): boolean => contract.abi === ERC20ABI;

/** A registry function's output, and where it was read: the call, or a field of what it returns. */
interface Result {
  /** The contract whose function it is. */
  readonly owner: ContractDescriptor;
  readonly method: DescriptorMethod;
  readonly path: readonly string[];
}

/** The output parameter `path` leads to: the one output, or a field of the record returned. */
function outputAt(method: DescriptorMethod, path: readonly string[]) {
  const { outputs } = method;
  if (path.length === 0) return outputs.length === 1 ? outputs[0] : undefined;
  let fields =
    outputs.length === 1 && outputs[0]!.type === "tuple"
      ? (outputs[0] as { components?: typeof outputs }).components
      : outputs;
  let found: (typeof outputs)[number] | undefined;
  for (const name of path) {
    found = fields?.find((field) => field.name === name);
    if (found === undefined) return undefined;
    fields = (found as { components?: typeof outputs }).components;
  }
  return found;
}

/** The registry contracts whose ABI has `method`, the way a program calls each at an address. */
function spellingsOf(method: string, near: string | undefined): readonly string[] {
  const spellings: string[] = [];
  const seen = new Set<string>();
  const ranked = [...DESCRIPTORS].sort(
    (a, b) => Number(b.protocol === near) - Number(a.protocol === near),
  );
  for (const contract of ranked) {
    if (contract.kind === "address-only" || !contract.methods.some((m) => m.name === method)) {
      continue;
    }
    const spelling = isToken(contract)
      ? Object.hasOwn(SAFE_WRITES, method) || method === "balanceOf"
        ? `${TOKEN_FACTORY_NAME}(<address>).${method}(...)`
        : `${named(contract)}(<address>).${method}(...)`
      : contract.kind === "interface"
        ? `${named(contract)}(<address>).${method}(...)`
        : `${named(contract)}.at(<address>).${method}(...)`;
    if (seen.has(spelling)) continue;
    seen.add(spelling);
    spellings.push(spelling);
    if (spellings.length === 3) break;
  }
  return spellings;
}

/**
 * Rewrites every method call on a registry call's result whose contract the registry knows — see the
 * module doc — over `source`, for `chain` (which only decides what a chain-qualified name such as
 * `Base.UniswapV3.Factory` names). Edits are insertions at parser ranges, so everything else
 * survives byte for byte.
 */
export function rewriteContractResults(
  source: string,
  chain: CanonicalChain,
): ContractResultsResult {
  const none: ContractResultsResult = { source, rewrote: false, sites: 0 };
  const program = parseSauce(source);
  const declarations = countDeclarations(program);
  const declared = (name: string): boolean => declarations.has(name);

  /** `const`/`let` bindings of names declared once, by name: their kind and initializer. */
  const bindings = new Map<string, { readonly kind: string; readonly init: AstNode }>();
  walk(program, (n) => {
    if (n.type !== "VariableDeclaration") return;
    const kind = (n as { kind?: string }).kind ?? "var";
    for (const declarator of (n as { declarations?: AstNode[] }).declarations ?? []) {
      const id = declarator.id as AstNode | undefined;
      const init = declarator.init as AstNode | null | undefined;
      if (id?.type !== "Identifier" || !init) continue;
      const name = (id as unknown as { name: string }).name;
      if (declarations.get(name) === 1) bindings.set(name, { kind, init });
    }
  });

  /** A name or member chain naming a registry contract: `UniswapV3.Factory`, `Base.UniswapV3.Factory`,
   *  or a protocol whose one contract is its default (`Aave`). */
  const reference = (node: AstNode): ContractDescriptor | undefined => {
    const chainOf = decomposeMemberChain(node);
    if (chainOf === undefined || declared(chainOf.head)) return undefined;
    const qualified = isChainKey(chainOf.head);
    if (!qualified && resolveNamespace(chainOf.head) === undefined) return undefined;
    // `<Ns>[.<Contract>]`, or `<Chain>.<Ns>[.<Contract>]`: nothing longer names a contract.
    if (chainOf.path.length > (qualified ? 2 : 1)) return undefined;
    try {
      return resolveContractReference(chainOf.head, chainOf.path, chain, undefined, "", "")
        .descriptor;
    } catch {
      return undefined; // the accessor pass reports what is wrong with it
    }
  };

  /** A contract bound to an address: `UniswapV3.Pool(x)`, `AaveV3.Pool.at(x)`. */
  const bound = (node: AstNode): ContractDescriptor | undefined => {
    if (node.type !== "CallExpression") return undefined;
    const callee = node.callee as AstNode;
    if (callee.type !== "MemberExpression") return undefined;
    const viaAt =
      !(callee as { computed?: boolean }).computed &&
      ((callee.property as { name?: string } | undefined)?.name ?? "") === "at";
    const contract = reference(viaAt ? (callee.object as AstNode) : callee);
    if (contract === undefined || contract.kind === "address-only") return undefined;
    return viaAt || contract.kind === "interface" ? contract : undefined;
  };

  const resultMemo = new Map<AstNode, Result | undefined>();
  const knownMemo = new Map<AstNode, ContractDescriptor | undefined>();
  const visiting = new Set<AstNode>();

  /** The contract a method called on `node` is a method of, where it is a registry contract. */
  const receiver = (node: AstNode): ContractDescriptor | undefined =>
    reference(node) ?? bound(node) ?? known(node);

  /** `node` as a registry function's output: its call, a field of it, or a `const` holding either. */
  function result(node: AstNode): Result | undefined {
    if (resultMemo.has(node)) return resultMemo.get(node);
    if (visiting.has(node)) return undefined;
    visiting.add(node);
    let found: Result | undefined;
    const site = methodCall(node);
    if (site !== undefined) {
      const owner = receiver(site.object);
      const args = (node.arguments as AstNode[] | undefined)?.length ?? 0;
      const overloads = owner?.methods.filter((m) => m.name === site.method) ?? [];
      // A call takes the overload of its argument count, as the compiler picks it.
      const method =
        overloads.find((m) => m.inputs.length === args) ??
        (overloads.length === 1 ? overloads[0] : undefined);
      if (owner !== undefined && method !== undefined) found = { owner, method, path: [] };
    } else if (
      node.type === "MemberExpression" &&
      !(node as { computed?: boolean }).computed &&
      (node.property as AstNode | undefined)?.type === "Identifier"
    ) {
      const inner = result(node.object as AstNode);
      if (inner !== undefined) {
        found = {
          ...inner,
          path: [...inner.path, (node.property as unknown as { name: string }).name],
        };
      }
    } else if (node.type === "Identifier") {
      const binding = bindings.get((node as unknown as { name: string }).name);
      if (binding?.kind === "const") found = result(binding.init);
    }
    visiting.delete(node);
    resultMemo.set(node, found);
    return found;
  }

  /** The registry contract `node`'s value is, where the registry knows it. */
  function known(node: AstNode): ContractDescriptor | undefined {
    if (knownMemo.has(node)) return knownMemo.get(node);
    const output = result(node);
    const returned = output?.method.returns?.find(
      (r) => r.path.length === output.path.length && r.path.every((p, i) => p === output.path[i]),
    );
    const ns =
      returned === undefined ? undefined : resolveNamespace(pascalOfSlug(returned.protocol));
    const contract =
      returned !== undefined && ns?.kind === "protocol"
        ? ns.contracts.get(returned.contract)
        : undefined;
    knownMemo.set(node, contract);
    return contract;
  }

  /** `node` as the program spells it, its arguments elided: `UniswapV3.Factory.getPool(...)`. */
  const spelled = (node: AstNode): string => {
    if (node.type === "Identifier") return (node as unknown as { name: string }).name;
    if (node.type === "CallExpression") return `${spelled(node.callee as AstNode)}(...)`;
    if (node.type === "MemberExpression" && !(node as { computed?: boolean }).computed) {
      return `${spelled(node.object as AstNode)}.${(node.property as unknown as { name: string }).name}`;
    }
    return source.slice(node.start, node.end);
  };

  const inserts: { readonly at: number; readonly span: number; readonly text: string }[] = [];
  walk(program, (n) => {
    const site = methodCall(n);
    if (site === undefined || VALUE_METHODS.has(site.method)) return;
    const { object, method } = site;
    // A contract the program names, or binds to an address, is the accessor pass's.
    if (reference(object) !== undefined || bound(object) !== undefined) return;
    const contract = known(object);
    if (contract === undefined) {
      refuseUnknown(object, method);
      return;
    }
    const call = `${spelled(object)}.${method}(...)`;
    if (!contract.methods.some((m) => m.name === method)) {
      const methods = [...new Set(contract.methods.map((m) => m.name))].join(", ");
      fail(
        `'${call}': ${spelled(object)} is ${isToken(contract) ? "a token" : `a ${named(contract)}`}, ` +
          `whose ABI has no '${method}' (its methods: ${methods})`,
      );
    }
    const write = isToken(contract) && Object.hasOwn(SAFE_WRITES, method);
    const head = write ? TOKEN_FACTORY_NAME : pascalOfSlug(contract.protocol);
    if (declared(head)) {
      fail(
        `'${call}' calls the ${write ? "token" : named(contract)} its receiver is, as ` +
          `'${write ? TOKEN_FACTORY_NAME : named(contract)}(...)', but the program declares its own ` +
          `'${head}': rename it`,
      );
    }
    const open = write
      ? `${TOKEN_FACTORY_NAME}(`
      : contract.kind === "interface"
        ? `${named(contract)}(`
        : `${named(contract)}.at(`;
    const span = object.end - object.start;
    inserts.push({ at: object.start, span, text: open }, { at: object.end, span, text: ")" });
  });

  /**
   * A method called on an address a registry function returns, whose contract the registry does not
   * know: refused, naming the spelling that binds it. Anything else is left to the compiler.
   */
  function refuseUnknown(object: AstNode, method: string): void {
    const output = result(object);
    if (output === undefined) {
      // `let pool = UniswapV3.Factory.getPool(...)`: a contract the registry knows, in a variable
      // the program may reassign, so its calls cannot be lowered by name.
      const binding =
        object.type === "Identifier"
          ? bindings.get((object as unknown as { name: string }).name)
          : undefined;
      if (binding !== undefined && binding.kind !== "const") {
        const contract = known(binding.init);
        if (contract !== undefined) {
          const name = spelled(object);
          fail(
            `'${name}.${method}(...)': '${name}' holds a ${isToken(contract) ? "token" : named(contract)} ` +
              `but is declared with '${binding.kind}': declare it 'const', or name the contract ` +
              `'${isToken(contract) ? TOKEN_FACTORY_NAME : named(contract)}(${name}).${method}(...)'`,
          );
        }
      }
      return;
    }
    if (outputAt(output.method, output.path)?.type !== "address") return;
    const spellings = spellingsOf(method, output.owner.protocol);
    fail(
      `'${spelled(object)}.${method}(...)': ${spelled(object)} is an address, and the registry does ` +
        `not record which contract it is, so it has no '${method}'. Name the contract at it: ` +
        (spellings.length > 0
          ? spellings.map((s) => `'${s}'`).join(", or ")
          : `'<Protocol>.<Interface>(<address>).${method}(...)', or the program's own ABI ` +
            `'IAbi.at(<address>).${method}(...)'`),
    );
  }

  if (inserts.length === 0) return none;
  // From the end backward, so earlier offsets hold. At one offset the shorter receiver goes first,
  // so the longer one's text lands outside it: `Erc20.ERC20(UniswapV3.Pool(...).token0())`.
  let out = source;
  for (const insert of [...inserts].sort((a, b) => b.at - a.at || a.span - b.span)) {
    out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  }
  return { source: out, rewrote: true, sites: inserts.length / 2 };
}
