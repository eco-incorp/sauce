/**
 * `Chain(() => { ... }).reward({ ... })` — creating an Eco intent from inside a Sauce program,
 * with no import, no Portal, no selector and no approve written by hand.
 *
 * ```js
 * function main() {
 *   const amount = USDC.balanceOf(ctx.self());
 *   Base(() => {
 *     USDC.transfer(RECIPIENT, amount);
 *   }).reward({ tokens: [{ token: USDC, amount }] });
 * }
 * ```
 *
 * WHAT THIS IS. A source rewrite, run before the compiler ever sees the program — the same class of
 * thing as `token-rewrite.ts`'s `Token(x)` -> `IERC20.at(x)`, and for the same reason: the compiler
 * has no notion of a closure, a chain, or an intent, and does not need one. By the time it runs, the
 * expression above has become ordinary statements it already supports.
 *
 * WHAT `amount` IS. It is a local of the ENCLOSING program, whose value exists only while that
 * program runs. So the child intent cannot be encoded with it — it is encoded with a sentinel in its
 * place, cut there, and the program splices the local in at run time (`template.ts`). Every captured
 * variable is one slot. This is the identical mechanism `nest-dynamic.ts` uses for a measured
 * balance; a capture is just a value that arrives by a different route.
 *
 * WHAT IS LOWERED, AND WHAT IS REFUSED. Each statement of the closure becomes one entry in the
 * child's `route.calls` — which is what an eco-routes route IS, a list of calls, so the mapping is
 * the natural one rather than a convention. A statement that is not one call (a loop, a balance
 * read, arithmetic) has no entry to become and is REFUSED, by name, pointing at the explicit
 * compiled-program form. An identifier that is neither a compile-time value nor an enclosing local
 * is refused the same way. Nothing here guesses: the failure mode this exists to avoid is a
 * plausible-looking intent carrying a number nobody chose.
 *
 * WHERE THE ADDRESSES COME FROM. The Portal on each side, and the prover for the pair, are looked up
 * in the SDK's eco-routes deployment registry (`protocols/eco-routes`). A caller supplies what has
 * no correct default — deadlines, and a creator when the refund must not go to the executing Pot.
 */
import { parse } from "acorn";
import { encodeFunctionData, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { uncheckedApproveStatements } from "../token/unchecked.js";
import { collectDeclaredNames, walk, type AstNode } from "./ast-walk.js";
import { denormalizeToEvm } from "./encode.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "./normalize.js";
import { publishAndFundTx } from "./portal.js";
import { emitTemplate, splitByPlaceholders, type PlaceholderSpec } from "./template.js";
import type { AddressInput, Intent } from "./types.js";

/**
 * One sentinel per captured variable.
 *
 * TWENTY bytes, not thirty-two, and that is the load-bearing detail: a capture can be an amount OR
 * an address, and the same value has to be a legal argument in both positions when viem encodes the
 * call. An address-shaped sentinel is legal as a `uint256` too, while the reverse is not. In the
 * encoded payload it occupies a full left-padded word either way, which is exactly what
 * `.toBytesBe(32)` splices back in.
 *
 * The `0x5acecab7` tag makes a stray one obvious in a trace and the trailing index keeps them
 * distinct. `splitByPlaceholders` counts every occurrence, so a collision with a real value fails
 * loudly rather than quietly overwriting a field.
 */
const CAPTURE_TAG = "5acecab7";

/** The sentinel a captured value occupies in a CHILD PROGRAM's argument tail. A separate tag from
 *  the route-call one so the two can never be mistaken for each other in a payload carrying both. */
const CHILD_CAPTURE_TAG = "5aceb10c";
export const childCaptureSentinel = (index: number): bigint =>
  BigInt(`0x${CHILD_CAPTURE_TAG}${"00".repeat(14)}${index.toString(16).padStart(4, "0")}`);
const captureSentinel = (index: number): bigint =>
  BigInt(`0x${CAPTURE_TAG}${"00".repeat(14)}${index.toString(16).padStart(4, "0")}`);

/** What a caller must supply because the SDK cannot correctly guess it, plus what it may override. */
export interface IntentSugarDefaults {
  /** Absolute Unix seconds. Required: a deadline is a policy decision, and a wrong one either
   *  strands the reward or makes the intent unfulfillable. */
  readonly deadline: bigint;
  /** Defaults to `route.deadline`. */
  readonly rewardDeadline?: bigint;
  /** Who may reclaim the reward after `rewardDeadline`. Defaults to the executing Pot, which is
   *  correct when the program itself funded the reward and wrong when a user did — supply it
   *  explicitly in that case. */
  readonly creator?: AddressInput;
  /** Defaults to the prover the deployment registry records for this source/destination pair. */
  readonly prover?: AddressInput;
  /** Overrides the source-chain Portal the program publishes through. */
  readonly sourcePortal?: AddressInput;
  /** Overrides the destination-chain Portal recorded in the child's route. */
  readonly destinationPortal?: AddressInput;
  /** Route salt, defaulting to 32 zero bytes. Two structurally identical children collapse into one
   *  intent without distinct salts. */
  readonly salt?: Hex;
  /** Passed to `publishAndFund`. Default `false`. */
  readonly allowPartial?: boolean;
  /** The destination Pot a cook-based child runs on. Required as soon as a closure needs a compiled
   *  program: a Pot's address is CREATE2 from its OWNER, the destination `Portal.executor()`, which
   *  is a chain read rather than a constant. */
  readonly pot?: AddressInput;
  /** The interpreter that Pot cooks on. Defaults to the released engine address. */
  readonly engine?: AddressInput;
  /** The destination Kitchen's current execution fee, in wei, paid on every cook. Required for a
   *  cook-based child: it is read from the chain and it changes. */
  readonly executionFee?: bigint;
}

/** Everything the rewrite needs that is not in the source text. */
export interface IntentSugarContext {
  /** The chain the ENCLOSING program runs on — the child's source chain. */
  readonly source: CanonicalChain;
  /** Chain accessor name (`Base`) -> canonical chain. Only these names open an intent. */
  readonly chains: ReadonlyMap<string, CanonicalChain>;
  /**
   * Compile-time scalars in scope, PER CHAIN: the caller's own defines plus that chain's token
   * symbols.
   *
   * Per chain because a symbol is not an address. `USDC` inside `Arbitrum(() => ...)` is Arbitrum's
   * USDC, and resolving it against the enclosing program's chain would put a Base address in a
   * route that executes on Arbitrum — most likely not a token at all, and a transfer to it is
   * funds gone. The enclosing program's own names resolve against `source`.
   */
  readonly definesFor: (chain: CanonicalChain) => ReadonlyMap<string, bigint>;
  /** Resolves the Portal for a chain, and the prover for a pair. Throws with its own diagnostic. */
  readonly portalOf: (chain: CanonicalChain) => AddressInput;
  readonly proverFor: (source: CanonicalChain, destination: CanonicalChain) => AddressInput;
  readonly defaults: Partial<IntentSugarDefaults>;
  /**
   * Compiles a program for `chain`, re-entering the whole route pipeline — token and protocol
   * rewrites for THAT chain, and this same lowering, which is what makes a nested intent work
   * without a second implementation. Supplied by `sauce-route.ts`; a callback rather than an import
   * because this module is one of the passes that pipeline runs.
   */
  readonly compileChild: (
    chain: CanonicalChain,
    source: string,
    captures: readonly string[],
  ) => CompiledChild;
}

export interface CompiledChild {
  /** `cook(engine, bytecode ++ arguments)` calldata, with a sentinel per capture in the argument
   *  tail. `undefined` captures means the program takes none. */
  readonly call: { readonly target: Hex; readonly data: Hex; readonly value: bigint };
  /** The sentinel each capture occupies, in the order the program declares them. */
  readonly captureSentinels: readonly bigint[];
}

export interface IntentSugarResult {
  readonly source: string;
  readonly rewrote: boolean;
  /** One per lowered `Chain(...).reward(...)` site, in source order. */
  readonly intents: readonly LoweredIntent[];
}

export interface LoweredIntent {
  /** The child as encoded, with a sentinel wherever a captured value belongs. */
  readonly intent: Intent;
  /** Enclosing locals spliced into it, in slot order. */
  readonly captures: readonly string[];
  readonly destination: CanonicalChain;
}

class SugarError extends Error {}

const fail = (message: string): never => {
  throw new SugarError(`intent sugar: ${message}`);
};

// ---------------------------------------------------------------------------
// Expression resolution
// ---------------------------------------------------------------------------

/** A value in the closure: known now, or a local of the enclosing program spliced at run time. */
type Value = { readonly literal: bigint } | { readonly capture: string };

interface Resolver {
  (node: AstNode, what: string): Value;
}

function literalOf(node: AstNode): bigint | undefined {
  if (node.type === "Literal") {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "boolean") return value ? 1n : 0n;
  }
  if (node.type === "UnaryExpression" && (node as { operator?: string }).operator === "-") {
    fail("a negative literal is not a valid address or amount");
  }
  return undefined;
}

function makeResolver(
  defines: ReadonlyMap<string, bigint>,
  outerLocals: ReadonlySet<string>,
): Resolver {
  return (node, what) => {
    const direct = literalOf(node);
    if (direct !== undefined) return { literal: direct };
    if (node.type === "Identifier") {
      const name = (node as unknown as { name: string }).name;
      const define = defines.get(name);
      if (define !== undefined) return { literal: define };
      if (outerLocals.has(name)) return { capture: name };
      return fail(
        `${what} refers to '${name}', which is neither a compile-time value nor a variable of the ` +
          `enclosing program. Declare it with \`const ${name} = ...\` before the intent, or supply ` +
          `it as a compile-time define.`,
      );
    }
    return fail(
      `${what} is a ${node.type}, which cannot be resolved when the intent is built. Use a literal, ` +
        `a compile-time define, or a variable of the enclosing program.`,
    );
  };
}

// ---------------------------------------------------------------------------
// Statement lowering
// ---------------------------------------------------------------------------

interface LoweredCall {
  readonly target: bigint;
  /** ERC-20 method and its two argument values, in declaration order. */
  readonly method: "transfer" | "approve";
  readonly args: readonly Value[];
}

/** Whether every statement is a plain token write, which lowers to direct `route.calls` entries and
 *  needs no program, no Pot and no Kitchen fee. Anything else — a swap, control flow, a nested
 *  intent — takes the general path. */
function isDirectCallBody(body: readonly AstNode[], defines: ReadonlyMap<string, bigint>): boolean {
  return (
    body.length > 0 &&
    body.every((statement) => {
      try {
        lowerStatement(statement, () => ({ literal: 0n }), defines);

        return true;
      } catch {
        return false;
      }
    })
  );
}

/** `USDC.transfer(to, amount)` or `Token(addr).transfer(to, amount)` -> one call. */
function lowerStatement(
  statement: AstNode,
  resolve: Resolver,
  defines: ReadonlyMap<string, bigint>,
): LoweredCall {
  if (statement.type !== "ExpressionStatement") {
    return fail(
      `a \`${statement.type}\` cannot become a route call. An intent's body is a list of calls, so ` +
        `each statement must be one — for logic that runs on the destination, compile a program and ` +
        `nest it instead.`,
    );
  }
  const call = (statement as { expression?: AstNode }).expression;
  if (call === undefined || call.type !== "CallExpression") {
    return fail("every statement in an intent body must be a call");
  }
  const callee = (call as { callee?: AstNode }).callee;
  if (callee === undefined || callee.type !== "MemberExpression") {
    return fail("an intent body's call must name a token or contract method");
  }
  const property = (callee as { property?: AstNode }).property;
  const method =
    property?.type === "Identifier" ? (property as unknown as { name: string }).name : "";
  if (method === "reward") {
    return fail(
      "an intent cannot be opened inside another intent's body. The inner one would have to be " +
        "published by the outer one's solver, on the destination chain, which is a second execution " +
        'rather than a call. Build the cascade with `.nest(child, { via: "dynamic" })` on the ' +
        "TypeScript builder, which compiles a program for that second execution.",
    );
  }
  if (method !== "transfer" && method !== "approve") {
    return fail(
      `\`.${method || "?"}(...)\` is not a method this lowering knows. Supported today: ` +
        `\`transfer\` and \`approve\` on a token.`,
    );
  }

  const object = (callee as { object?: AstNode }).object!;
  let target: bigint;
  if (object.type === "Identifier") {
    const name = (object as unknown as { name: string }).name;
    const address = defines.get(name);
    if (address === undefined) {
      return fail(
        `'${name}' is not a token this chain registers. Use a registered symbol, or ` +
          `\`Token(address)\` with a literal or define.`,
      );
    }
    target = address;
  } else if (
    object.type === "CallExpression" &&
    (object as { callee?: AstNode }).callee?.type === "Identifier" &&
    ((object as { callee?: AstNode }).callee as unknown as { name: string }).name === "Token"
  ) {
    const inner = ((object as { arguments?: AstNode[] }).arguments ?? [])[0];
    if (inner === undefined) return fail("`Token()` needs an address");
    const value = resolve(inner, "the token address");
    if (!("literal" in value)) {
      return fail(
        "a token address must be known when the intent is built, not captured at run time",
      );
    }
    target = value.literal;
  } else {
    return fail("an intent body's call must be on a token symbol or `Token(address)`");
  }

  const args = ((call as { arguments?: AstNode[] }).arguments ?? []).map((argument, i) =>
    resolve(argument, `argument ${i + 1} of \`.${method}(...)\``),
  );
  if (args.length !== 2) {
    return fail(`\`.${method}(...)\` takes two arguments, got ${args.length}`);
  }
  return { target, method, args };
}

/**
 * The enclosing program's variables a closure body reads.
 *
 * Whole-program `outerLocals` minus everything the closure declares itself, minus names the
 * destination resolves (tokens, protocols, `ctx`, `abi`…). Conservative in the safe direction: a
 * name wrongly treated as a capture becomes an unused program parameter, while one wrongly left out
 * becomes an undeclared variable the compiler rejects by name.
 */
function collectCaptures(
  body: readonly AstNode[],
  outerLocals: ReadonlySet<string>,
  defines: ReadonlyMap<string, bigint>,
): string[] {
  const declared = new Set<string>();
  const read: string[] = [];
  for (const statement of body) {
    walk(statement, (node) => {
      if (node.type === "VariableDeclarator") {
        const id = (node as { id?: AstNode }).id;
        if (id?.type === "Identifier") declared.add((id as unknown as { name: string }).name);
      }
    });
  }
  for (const statement of body) {
    walk(statement, (node) => {
      if (node.type !== "Identifier") return;
      const name = (node as unknown as { name: string }).name;
      if (declared.has(name) || defines.has(name)) return;
      if (!outerLocals.has(name)) return;
      if (!read.includes(name)) read.push(name);
    });
  }
  return read;
}

/** Is this identifier a PROPERTY (`a.b`) rather than a value read? Those are never captures. */
function stripMemberProperties(body: readonly AstNode[]): Set<string> {
  const properties = new Set<string>();
  for (const statement of body) {
    walk(statement, (node) => {
      if (node.type !== "MemberExpression") return;
      if ((node as { computed?: boolean }).computed === true) return;
      const property = (node as { property?: AstNode }).property;
      if (property?.type === "Identifier") {
        properties.add((property as unknown as { name: string }).name);
      }
    });
  }
  return properties;
}

// ---------------------------------------------------------------------------
// The reward object
// ---------------------------------------------------------------------------

interface RewardSpec {
  readonly tokens: readonly { readonly token: bigint; readonly amount: Value }[];
  readonly nativeAmount?: Value;
}

function lowerReward(node: AstNode, resolve: Resolver): RewardSpec {
  if (node.type !== "ObjectExpression") {
    return fail("`.reward(...)` takes an object, e.g. `{ tokens: [{ token: USDC, amount }] }`");
  }
  let tokens: RewardSpec["tokens"] = [];
  let nativeAmount: Value | undefined;
  for (const property of (node as { properties?: AstNode[] }).properties ?? []) {
    const key = (property as { key?: AstNode }).key;
    const name = key?.type === "Identifier" ? (key as unknown as { name: string }).name : "";
    const value = (property as { value?: AstNode }).value!;
    if (name === "tokens") {
      if (value.type !== "ArrayExpression") return fail("`reward.tokens` must be an array");
      tokens = ((value as { elements?: AstNode[] }).elements ?? []).map((element) => {
        if (element === null || element.type !== "ObjectExpression") {
          return fail("each `reward.tokens` entry must be `{ token, amount }`");
        }
        let token: bigint | undefined;
        let amount: Value | undefined;
        for (const field of (element as { properties?: AstNode[] }).properties ?? []) {
          const fieldKey = (field as { key?: AstNode }).key;
          const fieldName =
            fieldKey?.type === "Identifier" ? (fieldKey as unknown as { name: string }).name : "";
          // `{ token: USDC, amount }` -- shorthand's value IS the identifier.
          const fieldValue = (field as { value?: AstNode }).value!;
          if (fieldName === "token") {
            const resolved = resolve(fieldValue, "`reward.tokens[].token`");
            if (!("literal" in resolved)) {
              return fail("a reward token address must be known when the intent is built");
            }
            token = resolved.literal;
          } else if (fieldName === "amount") {
            amount = resolve(fieldValue, "`reward.tokens[].amount`");
          } else {
            return fail(`\`reward.tokens[].${fieldName}\` is not a field of a token amount`);
          }
        }
        if (token === undefined || amount === undefined) {
          return fail("each `reward.tokens` entry needs both `token` and `amount`");
        }
        return { token, amount };
      });
    } else if (name === "nativeAmount") {
      nativeAmount = resolve(value, "`reward.nativeAmount`");
    } else {
      return fail(
        `\`reward.${name}\` is not settable here. Deadlines, creator and prover come from the ` +
          `route's own options so every intent in a program agrees on them.`,
      );
    }
  }
  if (tokens.length === 0 && nativeAmount === undefined) {
    return fail("`.reward(...)` must offer something — `tokens`, `nativeAmount`, or both");
  }
  return { tokens, nativeAmount };
}

/** `{ tokens: [{ token, amount }] }` — what the solver delivers to run the intent. Same shape as a
 *  reward leg, and deliberately the same parser, since the fields mean the same things. */
function lowerDelivery(node: AstNode, resolve: Resolver): RewardSpec["tokens"] {
  if (node.type !== "ObjectExpression") {
    return fail("an intent's second argument is `{ tokens: [{ token, amount }] }`");
  }
  const spec = lowerReward(node, resolve);
  if (spec.nativeAmount !== undefined) {
    return fail("`nativeAmount` belongs to the reward, not to what the solver delivers");
  }
  return spec.tokens;
}

// ---------------------------------------------------------------------------
// Site discovery
// ---------------------------------------------------------------------------

interface SugarSite {
  readonly start: number;
  readonly end: number;
  readonly chain: CanonicalChain;
  readonly body: AstNode[];
  /** Source range of the closure's block, so a general body is compiled from the text as written. */
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly reward: AstNode;
  /** `Chain(() => {...}, { tokens: [...] })` — what the solver delivers to the destination. */
  readonly delivery: AstNode | undefined;
}

function collectSites(program: AstNode, context: IntentSugarContext): SugarSite[] {
  const sites: SugarSite[] = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = (node as { callee?: AstNode }).callee;
    if (callee?.type !== "MemberExpression") return;
    const property = (callee as { property?: AstNode }).property;
    if (property?.type !== "Identifier") return;
    if ((property as unknown as { name: string }).name !== "reward") return;

    const opener = (callee as { object?: AstNode }).object;
    if (opener?.type !== "CallExpression") return;
    const chainNode = (opener as { callee?: AstNode }).callee;
    if (chainNode?.type !== "Identifier") return;
    const chainName = (chainNode as unknown as { name: string }).name;
    const chain = context.chains.get(chainName);
    if (chain === undefined) return;

    const openerArgs = (opener as { arguments?: AstNode[] }).arguments ?? [];
    const closure = openerArgs[0];
    if (
      openerArgs.length < 1 ||
      openerArgs.length > 2 ||
      closure === undefined ||
      closure.type !== "ArrowFunctionExpression"
    ) {
      fail(
        `\`${chainName}(...)\` opens an intent: \`() => { ... }\`, optionally followed by ` +
          `\`{ tokens: [...] }\` naming what the solver must deliver to run it.`,
      );
    }
    if (((closure as { params?: AstNode[] }).params ?? []).length > 0) {
      fail("an intent body takes no parameters — values come from the enclosing program");
    }
    const closureBody = (closure as { body?: AstNode }).body!;
    if (closureBody.type !== "BlockStatement") {
      fail("an intent body must be a block: `() => { ... }`");
    }
    const rewardArgs = (node as { arguments?: AstNode[] }).arguments ?? [];
    if (rewardArgs.length !== 1) fail("`.reward(...)` takes exactly one argument");

    // A site inside another site's closure is not its own site: the OUTER lowering walks that
    // closure and reports it, with a message about nesting rather than about a stray `.reward`.
    if (sites.some((s) => node.start > s.start && node.end < s.end)) return;
    sites.push({
      start: node.start,
      end: node.end,
      chain,
      body: (closureBody as { body?: AstNode[] }).body ?? [],
      bodyStart: closureBody.start,
      bodyEnd: closureBody.end,
      reward: rewardArgs[0]!,
      delivery: openerArgs[1],
    });
  });
  return sites;
}

// ---------------------------------------------------------------------------
// The rewrite
// ---------------------------------------------------------------------------

const addressHex = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

/** Lowers every `Chain(() => { ... }).reward({ ... })` in `source`. Purely textual surgery driven by
 *  acorn ranges, so everything else survives byte for byte. */
export function rewriteIntentSugar(source: string, context: IntentSugarContext): IntentSugarResult {
  const program = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as AstNode;
  const sites = collectSites(program, context);
  if (sites.length === 0) return { source, rewrote: false, intents: [] };

  // Every name the program binds anywhere. A capture must be one of them, and the enclosing
  // program's locals are what this set is -- deliberately whole-program rather than scope-accurate,
  // matching `token-rewrite.ts`'s posture, because SauceScript shares scope across blocks anyway.
  const outerLocals = collectDeclaredNames(program);

  const intents: LoweredIntent[] = [];
  const replacements: { start: number; end: number; text: string }[] = [];

  sites.forEach((site, index) => {
    const prefix = `i${index}_`;
    const captures: string[] = [];
    const placeholders: PlaceholderSpec[] = [];
    /**
     * A capture spliced into an ENCODED FIELD -- a route call's argument, a reward amount. One
     * sentinel per variable, reused wherever that variable appears.
     *
     * Keyed by its own map rather than by `captures`, which is the reported list and also collects
     * the program-argument captures below. Sharing one registry meant a variable already seen there
     * returned its sentinel without ever registering a placeholder for it, and the sentinel shipped
     * unspliced inside a real reward.
     */
    const routeCaptureIndex = new Map<string, number>();
    const sentinelFor = (value: Value): bigint => {
      if ("literal" in value) return value.literal;
      let at = routeCaptureIndex.get(value.capture);
      if (at === undefined) {
        at = routeCaptureIndex.size;
        routeCaptureIndex.set(value.capture, at);
        placeholders.push({ value: captureSentinel(at), source: value.capture });
        if (!captures.includes(value.capture)) captures.push(value.capture);
      }
      return captureSentinel(at);
    };

    // Resolved against the DESTINATION's registry: `USDC` in this closure is the destination's
    // USDC, because that is the chain the calls run on.
    const defines = context.definesFor(site.chain);
    const resolve = makeResolver(defines, outerLocals);

    /**
     * What the solver delivers to the destination Executor so this intent can run.
     *
     * Distinct from the reward, which is what the solver COLLECTS on the source chain for doing it.
     * Given explicitly as a second argument; for a body of plain token writes it is derived instead,
     * because there it is not a judgement call — a `transfer` of N moves N, so N is what has to
     * arrive. A program's needs cannot be read off its source, so the general path asks.
     */
    const explicitDelivery =
      site.delivery === undefined ? undefined : lowerDelivery(site.delivery, resolve);

    // TWO SHAPES, chosen by what the closure actually contains.
    //
    // A body of nothing but token writes needs no program: each statement is already one route
    // call, which is cheaper than a cook and needs neither a Pot nor a Kitchen fee. Anything else --
    // a swap, a condition, a loop, an intent of its own -- is a program, compiled for the
    // destination and run through its Pot. The second shape is strictly more general; the first is
    // kept because it is free.
    const simple = isDirectCallBody(site.body, defines);
    const derivedDelivery: { token: bigint; amount: Value }[] = [];
    const calls: { target: Hex; data: Hex; value: bigint }[] = [];
    const captureWords: { name: string; sentinel: bigint }[] = [];

    if (!simple) {
      const properties = stripMemberProperties(site.body);
      const captured = collectCaptures(site.body, outerLocals, defines).filter(
        (name) => !properties.has(name),
      );
      // Captured values reach the program as ENTRY ARGUMENTS. They cannot be folded in: their
      // values do not exist when it is compiled. Declared as `main`'s parameters, encoded
      // compact-v1 at a declared width so the payload's length does not move with them, and spliced
      // by the parent at a fixed offset -- which is the property `scalarWidth` exists for.
      // UNTYPED parameters on purpose: the rewrite passes downstream are acorn-based and cannot
      // parse an annotation. `rs-compile.ts#ensureTypedMainParams` adds them at the compile seam,
      // after every rewrite has run -- the same staging `ensureVoidMain` already uses.
      const childSource = `function main(${captured.join(", ")}) {\n${source.slice(
        site.bodyStart + 1,
        site.bodyEnd - 1,
      )}\n}`;
      const child = context.compileChild(site.chain, childSource, captured);
      captured.forEach((name, i) => {
        captureWords.push({ name, sentinel: child.captureSentinels[i]! });
      });
      // Delivered tokens land on the Executor; the program runs in the Pot, so move them first.
      for (const token of explicitDelivery ?? []) {
        calls.push({
          target: addressHex(token.token),
          data: encodeFunctionData({
            abi: ERC20ABI,
            functionName: "transfer",
            args: [child.call.target, sentinelFor(token.amount)] as never,
          }),
          value: 0n,
        });
      }
      calls.push(child.call);
    }

    for (const statement of simple ? site.body : []) {
      const lowered = lowerStatement(statement, resolve, defines);
      // A `transfer` moves tokens the Executor must have been given; an `approve` moves nothing.
      if (lowered.method === "transfer" && explicitDelivery === undefined) {
        derivedDelivery.push({ token: lowered.target, amount: lowered.args[1]! });
      }
      calls.push({
        target: addressHex(lowered.target),
        // Encoded by viem against the ERC-20 ABI, so the selector and the word layout are the
        // encoder's rather than this file's. A captured argument goes in as its sentinel, which is
        // address-shaped and therefore legal in either position.
        data: encodeFunctionData({
          abi: ERC20ABI,
          functionName: lowered.method,
          args: [addressHex(sentinelFor(lowered.args[0]!)), sentinelFor(lowered.args[1]!)] as never,
        }),
        value: 0n,
      });
    }

    // A capture the PROGRAM reads is a slot too: its sentinel sits in the argument tail of the cook
    // calldata above, which the parent splices exactly as it splices a reward amount.
    // A program capture gets its OWN placeholder even when the same variable is already spliced
    // into a route call or the reward: the two sit at different offsets in the payload, under
    // different sentinels, and both have to be filled. Skipping one because its NAME had been seen
    // would leave a sentinel in the program's argument tail -- a child that runs with 0x5aceb10c…
    // as its amount, which is exactly the silent-wrong-number failure this design exists to avoid.
    for (const { name, sentinel } of captureWords) {
      placeholders.push({ value: sentinel, source: name });
      if (!captures.includes(name)) captures.push(name);
    }

    const reward = lowerReward(site.reward, resolve);
    const { defaults } = context;
    const rewardDeadline = defaults.rewardDeadline ?? requireDeadline(defaults);
    const child: Intent = {
      destination: BigInt(site.chain.id),
      sourceChainId: BigInt(context.source.id),
      route: normalizeRoute({
        salt: defaults.salt,
        deadline: requireDeadline(defaults),
        portal: defaults.destinationPortal ?? context.portalOf(site.chain),
        // Native the route's own calls need: the Kitchen fee, once per cook.
        nativeAmount: calls.reduce((sum, call) => sum + call.value, 0n),
        // What the SOLVER delivers to run this intent, which is a different thing from the reward
        // it collects for doing so.
        tokens: (explicitDelivery ?? derivedDelivery).map((t) => ({
          token: addressHex(t.token),
          amount: sentinelFor(t.amount),
        })),
        calls,
      }),
      reward: normalizeReward({
        deadline: rewardDeadline,
        // The executing Pot is the default refund recipient: the program funded this reward, so
        // that is where an unclaimed one belongs unless the caller says otherwise.
        creator: requireCreator(defaults),
        prover: defaults.prover ?? context.proverFor(context.source, site.chain),
        nativeAmount: reward.nativeAmount === undefined ? 0n : sentinelFor(reward.nativeAmount),
        tokens: reward.tokens.map((t) => ({
          token: addressHex(t.token),
          amount: sentinelFor(t.amount),
        })),
      }),
    };

    const sourcePortal = defaults.sourcePortal ?? context.portalOf(context.source);
    const tx = publishAndFundTx(child, defaults.allowPartial ?? false, { portal: sourcePortal });
    const template = splitByPlaceholders(tx.data, placeholders);
    // Every sentinel must have become a slot. `splitByPlaceholders` guarantees that for the ones it
    // was TOLD about; this catches the other direction — a sentinel written into the payload whose
    // placeholder was never declared, which leaves it in the literal segments and ships an intent
    // carrying `0x5acecab7…` where an amount belongs. That happened once, silently, which is why it
    // is checked rather than reasoned about.
    for (const segment of template.segments) {
      for (const tag of [CAPTURE_TAG, CHILD_CAPTURE_TAG]) {
        if (segment.includes(tag)) {
          throw new SugarError(
            `intent sugar: a capture sentinel (0x${tag}) survived into the encoded intent — some ` +
              `captured value was written into the payload without a slot to fill it. This is a bug ` +
              `in the lowering, not in the program.`,
          );
        }
      }
    }
    const locals = Object.fromEntries(captures.map((name) => [name, name]));
    const emitted = emitTemplate(template, { prefix, locals });

    const statements: string[] = [...emitted.statements];
    // One approve per distinct reward token, so the Portal can pull the escrow from this Pot.
    // Decode-free (`token/unchecked.ts`): the ERC-20 ABI's `bool` return is decoded even when
    // discarded, and a token like USDT returns nothing.
    const portalWord = {
      literal: BigInt(denormalizeToEvm(toUniversalAddress(sourcePortal))),
    } as const;
    const approved = new Set<string>();
    reward.tokens.forEach((t, i) => {
      const token = addressHex(t.token);
      if (approved.has(token)) return;
      approved.add(token);
      const amount =
        "literal" in t.amount ? { literal: t.amount.literal } : { local: t.amount.capture };
      statements.push(
        ...uncheckedApproveStatements(`${prefix}${i}`, `${BigInt(t.token)}n`, portalWord, amount),
      );
    });
    statements.push(
      `evm.call(${BigInt(denormalizeToEvm(toUniversalAddress(sourcePortal)))}n, 0n, ${emitted.dataVar});`,
    );

    intents.push({ intent: child, captures, destination: site.chain });
    replacements.push({
      start: site.start,
      end: site.end,
      text: statements.join("\n").replace(/;$/, ""),
    });
  });

  // Splice from the end backward so earlier offsets stay valid. Each site is an ExpressionStatement's
  // expression, so the trailing `;` in the source terminates the last emitted statement.
  let out = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
  }
  return { source: out, rewrote: true, intents };
}

/**
 * The reward's creator — who may reclaim it once `rewardDeadline` passes.
 *
 * There is no correct default. The executing Pot is the obvious candidate and is the wrong one: it
 * is owned by the Portal's Executor, which every solver can drive, so a refund landing there is a
 * refund anybody can take. `openRoute` fills this from the enclosing intent's own `creator`, which
 * is both correct and invisible in the common case; a direct `compileSauceRoute` caller supplies it.
 */
/** The route and reward deadlines. No default exists: too early and the intent is unfulfillable,
 *  too late and the reward is locked up. */
function requireDeadline(defaults: Partial<IntentSugarDefaults>): bigint {
  if (defaults.deadline === undefined) {
    return fail(
      "the intent needs a `deadline` — the absolute Unix second by which it must be fulfilled. Set " +
        "`IntentOptions.deadline`, or `intents.deadline` in the compile options.",
    );
  }
  return defaults.deadline;
}

function requireCreator(defaults: Partial<IntentSugarDefaults>): AddressInput {
  if (defaults.creator === undefined) {
    return fail(
      "the reward needs a `creator` — the address that can reclaim it after the deadline. It has no " +
        "safe default: the executing Pot is driven by every solver, so a refund there is a refund " +
        "anyone can take. Set `IntentOptions.creator`, or `intents.creator` in the compile options.",
    );
  }
  return defaults.creator;
}

export { SugarError };
