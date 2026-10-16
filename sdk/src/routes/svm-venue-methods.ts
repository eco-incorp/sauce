/**
 * Solana's price-limit venues as namespaces in a program compiled for Solana, written as a protocol's
 * contracts are on an EVM chain, the protocol then its program:
 *
 *   Orca.Whirlpool.swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)
 *
 * and the same on `Raydium.CLMM`, `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`,
 * `Cropper.Whirlpool`, `Defituna.Fusion`, `Crema.CLMM` and `Phoenix.Market`. `swap` returns what
 * arrived; where the pool cannot trade — past `priceLimit`, empty, paused, a slot with no pool — it
 * returns 0 having moved nothing, and below `minOut` it reverts. `Meteora.DLMM`'s swap is an exact
 * input, its venue's own, with no price limit:
 *
 *   Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)
 *
 * which pays all of `amountIn` or fails the transaction, and reverts below `minOut`. Each lowers to
 * that venue's own `@sauce/router` function (`orcaWhirlpool`), which keeps its every check — its
 * program id, the pool's owner, the pair.
 *
 * The pool is found by its key, as an EVM factory's `getPool(tokenA, tokenB, fee)` finds one:
 *
 *   Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0)
 *
 * `pool(tokenA, tokenB, key)` is the pool the venue's program derives for the pair at the key — a
 * whirlpool's, DefiTuna's and Crema's tick spacing, a Raydium-code pool's fee (`svm/pool-keys.ts`),
 * with the tick spacing after a fee where the program keeps two configs at it, and an adaptive-fee
 * tier's index after a whirlpool's spacing — written as the swap's pool, with the key a number
 * written out. Where the venue has no pool at the key, the slot
 * is empty and the swap returns 0. A loop over keys written out,
 *
 *   for (const spacing of [4, 1]) {
 *     bought += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, spacing), …);
 *   }
 *
 * is written out once per key before anything else is lowered (`unrollPoolKeyLoops`), each key's
 * pool its own slot. Or the pool is a parameter of `main` declared `Address`, or a 32-byte key, as
 * Phoenix's market must be: a market is not derived from its pair.
 *
 * The function takes the pool's slot of nine accounts and the trader's seven as arrays; both are
 * ADDED to `main`, as the token methods' accounts are (`svm-lowering.ts`), each with how it is
 * derived:
 *
 *   slot:<pool>:USDC.<part> the pool's nine accounts paying USDC, read from the pool's own state as
 *                            the cook is built (`svm/pool-slot.ts`): its tick arrays depend on the
 *                            direction, so the slot is the token paid's. A pool by key is written
 *                            `Orca.Whirlpool(USDC,WSOL,4)` there.
 *   self, self:USDC          the authority, and the account it pays from
 *   mint:USDC, mint:WSOL     the two mints
 *   the two token programs and the memo program, by their ids
 *
 * and what is bought lands in the authority's own account for the token bought (`self:WSOL`), which
 * Crema and Phoenix require and which a program then forwards with the token methods. The pool and
 * both tokens are derived as the transaction is built, so each is known then: a registered symbol,
 * a parameter of `main` declared `Address`, or a 32-byte key; the amounts are any value.
 */
import { countDeclarations, walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";
import { applySplices, methodCall, type MethodCall, type Splice } from "./token-rewrite.js";
import {
  base58,
  capitalized,
  keyLiteral,
  nameOf,
  type SvmLowering,
  type TokenRef,
} from "./svm-lowering.js";
import { SVM_SLOT_PARTS, SVM_SLOT_VENUES } from "../svm/pool-slot.js";
import {
  svmPoolKeyProblem,
  SVM_KEYED_VENUES,
  type SvmPoolKind,
  type SvmPoolRefinement,
} from "../svm/pool-keys.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const ROUTER = "@sauce/router";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * A venue's namespace: its name for a person, its program, its `@sauce/router` function, whether
 * its swap is an exact input (no `priceLimit`) rather than at a price, and what its pools are found
 * by.
 */
export interface SvmVenueNamespace {
  readonly name: string;
  readonly program: string;
  readonly swap: string;
  readonly exact?: true;
  /** What its `pool(tokenA, tokenB, key)` takes as the key; none where pools are not found by key. */
  readonly key?: SvmPoolKind;
  /** What its `pool` may take after the key, where one key may name more than one pool. */
  readonly refinement?: SvmPoolRefinement;
}

const venue = (namespace: string, name: string, swap: string, exact?: true): SvmVenueNamespace => {
  const key = SVM_KEYED_VENUES[namespace]?.key;
  const refinement = SVM_KEYED_VENUES[namespace]?.refinement;

  return {
    name,
    program: SVM_SLOT_VENUES.find((one) => one.name === name)!.program,
    swap,
    ...(exact ? { exact } : {}),
    ...(key === undefined ? {} : { key }),
    ...(refinement === undefined ? {} : { refinement }),
  };
};

/** Each venue's namespace, its protocol then its program, as a program writes it. */
export const SVM_VENUE_NAMESPACES: Readonly<Record<string, SvmVenueNamespace>> = {
  "Raydium.CLMM": venue("Raydium.CLMM", "Raydium CLMM", "raydiumClmm"),
  "Pancakeswap.CLMM": venue("Pancakeswap.CLMM", "PancakeSwap CLMM", "pancakeswapClmm"),
  "Byreal.CLMM": venue("Byreal.CLMM", "Byreal", "byreal"),
  "Stabble.CLMM": venue("Stabble.CLMM", "Stabble CLMM", "stabbleClmm"),
  "Orca.Whirlpool": venue("Orca.Whirlpool", "Orca Whirlpools", "orcaWhirlpool"),
  "Cropper.Whirlpool": venue("Cropper.Whirlpool", "Cropper", "cropper"),
  "Defituna.Fusion": venue("Defituna.Fusion", "DefiTuna", "defituna"),
  "Crema.CLMM": venue("Crema.CLMM", "Crema", "crema"),
  "Phoenix.Market": venue("Phoenix.Market", "Phoenix", "phoenix"),
  "Meteora.DLMM": venue("Meteora.DLMM", "Meteora DLMM", "meteoraDlmm", true),
};

const PARAMS = ["pool", "tokenIn", "tokenOut", "amountIn", "priceLimit", "minOut"];
const EXACT_PARAMS = ["pool", "tokenIn", "tokenOut", "amountIn", "minOut"];
/** A venue's swap's arguments: an exact input's take no `priceLimit`. */
const paramsOf = (namespace: string): string[] =>
  SVM_VENUE_NAMESPACES[namespace]!.exact ? EXACT_PARAMS : PARAMS;

/** How a program calls a venue's methods: its swap, and its `pool` where it finds pools by key. */
export function svmVenueMethods(namespace: string): readonly string[] {
  const venue = SVM_VENUE_NAMESPACES[namespace];
  const key = venue?.key === "fee" ? "fee" : "tickSpacing";
  const refinement = venue?.refinement === undefined ? "" : `, ${venue.refinement}?: Uint256`;

  return [
    venue?.exact
      ? "swap(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, minOut: Uint256): Uint256"
      : "swap(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, priceLimit: Uint256, minOut: Uint256): Uint256",
    ...(venue?.key === undefined
      ? []
      : [`pool(tokenA: Address, tokenB: Address, ${key}: Uint256${refinement}): Address`]),
  ];
}

/** Each venue protocol, by the name a program writes first (`Orca`), and its programs' names. */
const PROTOCOLS: ReadonlyMap<string, readonly string[]> = Object.keys(SVM_VENUE_NAMESPACES).reduce(
  (protocols, key) => {
    const [protocol, program] = key.split(".") as [string, string];
    return protocols.set(protocol, [...(protocols.get(protocol) ?? []), program]);
  },
  new Map<string, string[]>(),
);

/** Whether `name` is a venue protocol's, the first name of a venue's namespace (`Orca`). */
export const isVenueProtocol = (name: string): boolean => PROTOCOLS.has(name);

/** A venue namespace's method call, `<Protocol>.<Program>.<method>(…)`, unless the program owns
 *  the protocol's name. */
function venueCall(
  node: AstNode,
  declared: ReadonlySet<string>,
): { readonly site: MethodCall; readonly protocol: string; readonly program: string } | undefined {
  const site = methodCall(node);
  if (site === undefined) return undefined;
  const object = site.object as { type: string; object?: AstNode; property?: AstNode };
  if (
    object.type !== "MemberExpression" ||
    (object as { computed?: boolean }).computed ||
    object.object?.type !== "Identifier" ||
    object.property?.type !== "Identifier"
  ) {
    return undefined;
  }
  const protocol = nameOf(object.object);
  if (!PROTOCOLS.has(protocol) || declared.has(protocol)) return undefined;

  return { site, protocol, program: nameOf(object.property) };
}

/** A program's integer written out (`4`, `400n`), else undefined. */
function integerLiteral(node: AstNode, source: string): bigint | undefined {
  if (node.type !== "Literal") return undefined;
  const raw = source.slice(node.start, node.end);

  return /^\d+n?$/.test(raw) ? BigInt(raw.replace(/n$/, "")) : undefined;
}

/**
 * Writes out each loop over pool keys once per key: `for (const k of [4, 1]) { … }` whose body
 * finds a pool by `k` (`Orca.Whirlpool.pool(USDC, WSOL, k)`) becomes, for each key,
 * `if (true) { const k = 4; … }` with the key written into each such `pool(…)`, so each key's pool is
 * a slot of its own. A loop whose body takes `continue` stays a loop of one key each; one whose body
 * `break`s out of it, or that is labelled, is refused: written out, a `break` would end one key.
 */
export function unrollPoolKeyLoops(source: string): string {
  // Before parsing: a program that finds no pool by key has no such loop.
  if (!source.includes(".pool(")) return source;
  let declared: ReadonlySet<string> = new Set();
  // One parse a level: every outermost loop over keys written out at once, then the loops nested in
  // them, which the copies hold.
  for (let level = 0; level < 16; level++) {
    const program = parseSauce(source);
    declared = new Set(countDeclarations(program).keys());
    const found: AstNode[] = [];
    walk(program, (node) => {
      if (found.some((loop) => loop.start <= node.start && node.end <= loop.end)) return;
      if (node.type === "LabeledStatement" && keyLoopOf(node.body as AstNode) !== undefined) {
        throw new Error(
          `the loop over ${keyLoopOf(node.body as AstNode)!.name} is labelled: a loop over pool ` +
            "keys is written out once per key, so it takes no label",
        );
      }
      if (keyLoopOf(node) !== undefined) found.push(node);
    });
    if (found.length === 0) return source;
    source = applySplices(
      source,
      found.map((loop) => ({
        start: loop.start,
        end: loop.end,
        replacement: unrolled(source, loop),
      })),
    );
  }
  throw new Error("loops over pool keys nest more than 16 deep");

  function keyLoopOf(node: AstNode): ReturnType<typeof keyLoop> {
    return node.type === "ForOfStatement" ? keyLoop(node) : undefined;
  }

  /** The loop's variable and keys, where its body finds a pool by its variable. */
  function keyLoop(
    loop: AstNode,
  ): { readonly name: string; readonly kind: string; readonly keys: bigint[] } | undefined {
    const left = loop.left as AstNode & { declarations?: AstNode[]; kind?: string };
    const right = loop.right as AstNode & { elements?: (AstNode | null)[] };
    const id = left.declarations?.length === 1 ? (left.declarations[0]!.id as AstNode) : undefined;
    if (left.type !== "VariableDeclaration" || id?.type !== "Identifier") return undefined;
    if (right.type !== "ArrayExpression" || (right.elements ?? []).length === 0) return undefined;
    const keys = (right.elements ?? []).map((element) =>
      element === null ? undefined : integerLiteral(element, source),
    );
    if (keys.some((key) => key === undefined)) return undefined;
    const name = nameOf(id);
    if (poolKeySites(loop.body as AstNode, name).length === 0) return undefined;

    return { name, kind: left.kind ?? "const", keys: keys as bigint[] };
  }

  /** The `pool(…)` key arguments in `body` that are the loop's variable. */
  function poolKeySites(body: AstNode, name: string): AstNode[] {
    const sites: AstNode[] = [];
    walk(body, (node) => {
      const call = venueCall(node, declared);
      if (call?.site.method !== "pool") return;
      const key = ((call.site.call as { arguments?: AstNode[] }).arguments ?? [])[2];
      if (key?.type === "Identifier" && nameOf(key) === name) sites.push(key);
    });

    return sites;
  }

  /** `loop` written out once per key, in place of its text in `text`. */
  function unrolled(text: string, loop: AstNode): string {
    const { name, kind, keys } = keyLoop(loop)!;
    const body = loop.body as AstNode;
    const spelled = `the loop over ${name}`;
    if ((countDeclarations(body).get(name) ?? 0) > 0) {
      throw new Error(
        `${spelled} declares ${name} again in its body: a pool's key must be the loop's own ${name}`,
      );
    }
    const { breaks, continues } = exits(body);
    if (breaks) {
      throw new Error(
        `${spelled} breaks out of it: a loop over pool keys is written out once per key, each ` +
          "key's pool its own slot, and a break would end only one key. Skip the rest of a key " +
          "with continue, or an if around it.",
      );
    }
    const sites = poolKeySites(body, name);
    const inner =
      body.type === "BlockStatement" ? { start: body.start + 1, end: body.end - 1 } : body;
    const copies = keys.map((key) => {
      const splices: Splice[] = sites.map((site) => ({
        start: site.start - inner.start,
        end: site.end - inner.start,
        replacement: String(key),
      }));
      const statements = applySplices(text.slice(inner.start, inner.end), splices);

      return continues
        ? `for (${kind} ${name} of [${key}]) {${statements}}`
        : `if (true) { ${kind} ${name} = ${key};${statements}}`;
    });
    const line = text.lastIndexOf("\n", loop.start) + 1;
    const indent = /^[ \t]*/.exec(text.slice(line))![0];

    return copies.join(`\n${indent}`);
  }

  /** Whether `body` breaks out of, or continues, the loop it is the body of. */
  function exits(body: AstNode): { breaks: boolean; continues: boolean } {
    let breaks = false;
    let continues = false;
    const visit = (node: AstNode, inLoop: boolean, inSwitch: boolean): void => {
      if (node.type === "BreakStatement") {
        if (node.label === null || node.label === undefined) {
          if (!inLoop && !inSwitch) breaks = true;
        }
        return;
      }
      if (node.type === "ContinueStatement") {
        if ((node.label === null || node.label === undefined) && !inLoop) continues = true;
        return;
      }
      const loop = /^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(node.type);
      const isFunction = /Function/.test(node.type);
      if (isFunction) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "loc") continue;
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child !== null && typeof child === "object" && typeof child.type === "string") {
            visit(child as AstNode, inLoop || loop, inSwitch || node.type === "SwitchStatement");
          }
        }
      }
    };
    visit(body, false, false);

    return { breaks, continues };
  }
}

/** The venue namespaces' sites, `<Protocol>.<Program>.swap(…)` and the `pool(…)` each names. */
export function collectVenueMethods(l: SvmLowering): void {
  let literalPools = 0;
  /** The `pool(…)` calls a swap names as its pool: lowered with it. */
  const named = new Set<AstNode>();
  walk(l.program, (n) => {
    const call = venueCall(n, l.declared);
    if (call === undefined) return;
    const { site, protocol, program } = call;
    const programs = PROTOCOLS.get(protocol)!;
    const namespace = `${protocol}.${program}`;
    const spelled = `\`${namespace}.${site.method}(…)\``;
    if (!programs.includes(program)) {
      throw new Error(
        `${spelled} on Solana: ${protocol}'s swap is ${programs.map((one) => `${protocol}.${one}`).join(", ")}`,
      );
    }
    if (site.method === "pool") {
      if (named.has(n)) return;
      throw new Error(
        `${spelled} on Solana names the pool a swap trades at, found when the transaction is ` +
          `built: write it as the pool of \`${namespace}.swap(…)\`, its first argument.`,
      );
    }
    if (site.method !== "swap") {
      const pool = SVM_VENUE_NAMESPACES[namespace]!.key === undefined ? "" : " and pool";
      throw new Error(
        `${spelled} on Solana: ${namespace} offers swap${pool}, swap taking (${paramsOf(namespace).join(", ")}): ` +
          "it returns 0 having moved nothing where the pool cannot trade, and reverts below minOut",
      );
    }
    const first = ((site.call as { arguments?: AstNode[] }).arguments ?? [])[0];
    if (first !== undefined && venueCall(first, l.declared)?.site.method === "pool") {
      named.add(first);
    }
    l.site(n, () => lowerSwap(site, namespace, spelled));
  });

  function lowerSwap(site: MethodCall, namespace: string, spelled: string): void {
    l.requireInMain(site.call, spelled, "a venue's swap");
    const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
    const params = paramsOf(namespace);
    if (args.length !== params.length || args.some((arg) => arg.type === "SpreadElement")) {
      throw new Error(
        `${spelled} takes ${params.length} arguments (${params.join(", ")}), got ${args.length}.`,
      );
    }
    const [poolArg, inArg, outArg, amountIn] = args as [AstNode, AstNode, AstNode, AstNode];
    const minOut = args[args.length - 1]!;
    const text = (node: AstNode): string => l.source.slice(node.start, node.end);
    const tokenIn = l.tokenOf(inArg, text(inArg), spelled);
    const tokenOut = l.tokenOf(outArg, text(outArg), spelled);
    if (tokenIn.name === tokenOut.name) {
      throw new Error(`${spelled} on Solana pays and buys the same token, ${text(inArg)}`);
    }
    const pool = poolOf(poolArg, namespace, spelled, [tokenIn, tokenOut]);

    // The pool's nine accounts paying `tokenIn`, each as the router's swap takes it.
    const writable = new Set(["pool", "vaultA", "vaultB", "extra", "ticks0", "ticks1", "ticks2"]);
    const slot = SVM_SLOT_PARTS.map((part) =>
      l.account(
        `slot:${pool.name}:${tokenIn.name}.${part}`,
        `${pool.stem}${part === "pool" ? "Account" : capitalized(part)}`,
        { writable: writable.has(part) },
      ),
    );
    const trader = [
      l.authority(),
      l.tokenAccount({ kind: "self" }, tokenIn, true, spelled).account,
      l.mintAccount(tokenIn),
      l.mintAccount(tokenOut),
      l.account(TOKEN_PROGRAM_ID, "tokenProgram", {}),
      l.account(TOKEN_2022_PROGRAM_ID, "token2022Program", {}),
      l.account(MEMO_PROGRAM, "memoProgram", {}),
    ];
    const recipient = l.tokenAccount({ kind: "self" }, tokenOut, true, spelled).account;
    const fn = SVM_VENUE_NAMESPACES[namespace]!.swap;
    l.spliceCall(
      site,
      amountIn,
      minOut,
      `${l.use(ROUTER, fn, `__sauce_${fn}`)}([${slot.join(", ")}], [${trader.join(", ")}], `,
      `, ${recipient})`,
    );
  }

  /**
   * The pool: the venue's `pool(tokenA, tokenB, key)` with its key written out, a parameter of
   * `main` declared `Address`, or a 32-byte key.
   */
  function poolOf(
    node: AstNode,
    namespace: string,
    spelled: string,
    pair: readonly [TokenRef, TokenRef],
  ): { readonly name: string; readonly stem: string } {
    const call = venueCall(node, l.declared);
    if (call?.site.method === "pool") {
      const by = `${call.protocol}.${call.program}`;
      const text = l.source.slice(node.start, node.end);
      if (by !== namespace) {
        throw new Error(
          `${spelled} trades at a pool of ${namespace}'s, and \`${text}\` is ${by}'s`,
        );
      }
      const venue = SVM_VENUE_NAMESPACES[namespace]!;
      if (venue.key === undefined) {
        throw new Error(
          `\`${text}\` on Solana: ${venue.name}'s markets are not found by key. Name the market ` +
            "by a parameter of main declared `Address`, or a 32-byte key.",
        );
      }
      const args = (call.site.call as { arguments?: AstNode[] }).arguments ?? [];
      const keyName = venue.key === "fee" ? "fee" : "tickSpacing";
      const takes =
        venue.refinement === "tickSpacing"
          ? "3 or 4 arguments (tokenA, tokenB, fee, and the tickSpacing where two configs charge the fee)"
          : venue.refinement === "feeTierIndex"
            ? "3 or 4 arguments (tokenA, tokenB, tickSpacing, and the feeTierIndex of an adaptive-fee tier)"
            : "3 arguments (tokenA, tokenB, tickSpacing)";
      if (
        args.length < 3 ||
        args.length > (venue.refinement === undefined ? 3 : 4) ||
        args.some((arg) => arg.type === "SpreadElement")
      ) {
        throw new Error(`\`${namespace}.pool(…)\` takes ${takes}, got ${args.length}.`);
      }
      const [aArg, bArg, keyArg, refinementArg] = args as [AstNode, AstNode, AstNode, AstNode?];
      const of = (arg: AstNode): string => l.source.slice(arg.start, arg.end);
      const a = l.tokenOf(aArg, of(aArg), `\`${namespace}.pool(…)\``);
      const b = l.tokenOf(bArg, of(bArg), `\`${namespace}.pool(…)\``);
      const names = new Set([a.name, b.name]);
      if (names.size !== 2 || !names.has(pair[0].name) || !names.has(pair[1].name)) {
        throw new Error(
          `\`${text}\` is a pool of ${of(aArg)} and ${of(bArg)}, and ${spelled} pays ` +
            `${pair[0].value} for ${pair[1].value}`,
        );
      }
      const key = integerLiteral(keyArg, l.source);
      if (key === undefined) {
        throw new Error(
          `\`${text}\` on Solana: its ${keyName} must be known when the program compiles, each ` +
            "key's pool a slot of its own: a number written out, or the variable of a loop over " +
            `numbers written out (for (const ${keyName} of ${keyName === "fee" ? "[400, 200]" : "[4, 1]"}) { … }).`,
        );
      }
      const refinement =
        refinementArg === undefined ? undefined : integerLiteral(refinementArg, l.source);
      if (refinementArg !== undefined && refinement === undefined) {
        throw new Error(
          `\`${text}\` on Solana: its ${venue.refinement} must be known when the program compiles: a ` +
            "number written out.",
        );
      }
      const problem = svmPoolKeyProblem(namespace, key, refinement);
      if (problem !== undefined) throw new Error(`\`${text}\` on Solana: ${problem}`);
      const [protocol, program] = namespace.split(".") as [string, string];
      const tail = refinement === undefined ? "" : `,${refinement}`;

      return {
        name: `${namespace}(${a.name},${b.name},${key}${tail})`,
        stem:
          `${protocol.charAt(0).toLowerCase()}${protocol.slice(1)}` +
          `${capitalized(program.toLowerCase())}${key}${refinement === undefined ? "" : `x${refinement}`}`,
      };
    }
    if (node.type === "Identifier" && l.param(nameOf(node))?.kind === "address") {
      return { name: `@${nameOf(node)}`, stem: nameOf(node) };
    }
    const key = keyLiteral(node, l.source);
    if (key !== undefined) {
      literalPools++;
      return { name: base58(key), stem: `pool${literalPools}` };
    }
    const keyed =
      SVM_VENUE_NAMESPACES[namespace]!.key === undefined ? "" : `${namespace}.pool(…), `;
    throw new Error(
      `the pool \`${l.source.slice(node.start, node.end)}\` on Solana must be known when the ` +
        `transaction is built, to read its accounts from it: ${keyed}a parameter of main declared ` +
        "`Address`, or a 32-byte key.",
    );
  }
}
