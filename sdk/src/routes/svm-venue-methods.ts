/**
 * Solana's price-limit venues as namespaces in a program compiled for Solana, written as a protocol's
 * contracts are on an EVM chain, the protocol then its program:
 *
 *   Orca.Whirlpool.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)
 *
 * and the same on `Raydium.CLMM`, `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`,
 * `Cropper.Whirlpool`, `Defituna.Fusion`, `Crema.CLMM` and `Phoenix.Market`. `swap` returns what
 * arrived; where the pool cannot trade — past `maxPrice`, empty, paused, a slot with no pool — it
 * returns 0 having moved nothing, and below `minOut` it reverts. Each lowers to that venue's own
 * `@sauce/router` function (`orcaWhirlpool`), never `swap`, which carries every venue's code: one
 * venue's function is about a third of its size. That function keeps its every check — its program
 * id, the pool's owner, the pair.
 *
 *   Solana.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)
 *
 * is the same at a pool of ANY of the nine, the venue read from the pool's owner as the program runs:
 * it lowers to `@sauce/router`'s own `swap`, which carries every venue's code, for a program that
 * takes its pools as arguments and so cannot know their venues — the distributed swap. A pool given
 * as the System Program (`11111111111111111111111111111111`, the zero key) is an empty slot: its
 * nine accounts are the System Program, and `swap` returns 0 for it.
 *
 * The function takes the pool's slot of nine accounts and the trader's seven as arrays; both are
 * ADDED to `main`, as the token methods' accounts are (`svm-lowering.ts`), each with how it is
 * derived:
 *
 *   slot:@pool:USDC.<part>   the pool's nine accounts paying USDC, read from the pool's own state as
 *                            the cook is built (`svm/pool-slot.ts`): its tick arrays depend on the
 *                            direction, so the slot is the token paid's
 *   self, self:USDC          the authority, and the account it pays from
 *   mint:USDC, mint:WSOL     the two mints
 *   the two token programs and the memo program, by their ids
 *
 * and what is bought lands in the authority's own account for the token bought (`self:WSOL`), which
 * Crema and Phoenix require and which a program then forwards with the token methods. The pool and
 * both tokens are derived as the transaction is built, so each is a parameter of `main` declared
 * `Address`, a 32-byte key, or (a token) a registered symbol; the amounts are any value.
 */
import { walk, type AstNode } from "./ast-walk.js";
import { methodCall, type MethodCall } from "./token-rewrite.js";
import { base58, capitalized, keyLiteral, nameOf, type SvmLowering } from "./svm-lowering.js";
import { SVM_PRICE_LIMIT_VENUES, SVM_SLOT_PARTS } from "../svm/pool-slot.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const ROUTER = "@sauce/router";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** A venue's namespace: its name for a person, its program, and its `@sauce/router` function. */
export interface SvmVenueNamespace {
  readonly name: string;
  readonly program: string;
  readonly swap: string;
}

const venue = (name: string, swap: string): SvmVenueNamespace => ({
  name,
  program: SVM_PRICE_LIMIT_VENUES.find((one) => one.name === name)!.program,
  swap,
});

/** Each venue's namespace, its protocol then its program, as a program writes it. */
export const SVM_VENUE_NAMESPACES: Readonly<Record<string, SvmVenueNamespace>> = {
  "Raydium.CLMM": venue("Raydium CLMM", "raydiumClmm"),
  "Pancakeswap.CLMM": venue("PancakeSwap CLMM", "pancakeswapClmm"),
  "Byreal.CLMM": venue("Byreal", "byreal"),
  "Stabble.CLMM": venue("Stabble CLMM", "stabbleClmm"),
  "Orca.Whirlpool": venue("Orca Whirlpools", "orcaWhirlpool"),
  "Cropper.Whirlpool": venue("Cropper", "cropper"),
  "Defituna.Fusion": venue("DefiTuna", "defituna"),
  "Crema.CLMM": venue("Crema", "crema"),
  "Phoenix.Market": venue("Phoenix", "phoenix"),
};

/** How a program calls a venue's swap: its one method's signature. */
export const SVM_VENUE_METHODS: readonly string[] = [
  "swap(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, maxPrice: Uint256, minOut: Uint256): Uint256",
];

/** The namespace whose swap takes a pool of any of the venues: the chain's own. */
export const SVM_ANY_VENUE = "Solana";
const PARAMS = ["pool", "tokenIn", "tokenOut", "amountIn", "maxPrice", "minOut"] as const;

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

/** The venue namespaces' sites, `<Protocol>.<Program>.swap(…)`, and `Solana.swap(…)`. */
export function collectVenueMethods(l: SvmLowering): void {
  let literalPools = 0;
  walk(l.program, (n) => {
    const site = methodCall(n);
    if (site === undefined) return;
    // `Solana.pda(…)` and the chain's other members are not swaps: only its swap is taken here.
    if (site.object.type === "Identifier") {
      const name = nameOf(site.object);
      if (name !== SVM_ANY_VENUE || l.declared.has(name)) return;
      if (site.method === "trySwap") {
        throw new Error(
          "`Solana.trySwap(…)` on Solana: Solana.swap is the one swap, returning 0 having moved " +
            "nothing where the pool cannot trade, and reverting below minOut",
        );
      }
      if (site.method === "swap") l.site(n, () => lowerSwap(site, undefined, "`Solana.swap(…)`"));
      return;
    }
    const object = site.object as { type: string; object?: AstNode; property?: AstNode };
    if (
      object.type !== "MemberExpression" ||
      (object as { computed?: boolean }).computed ||
      object.object?.type !== "Identifier" ||
      object.property?.type !== "Identifier"
    ) {
      return;
    }
    const protocol = nameOf(object.object);
    const programs = PROTOCOLS.get(protocol);
    if (programs === undefined || l.declared.has(protocol)) return;
    const namespace = `${protocol}.${nameOf(object.property)}`;
    const spelled = `\`${namespace}.${site.method}(…)\``;
    if (!programs.includes(nameOf(object.property))) {
      throw new Error(
        `${spelled} on Solana: ${protocol}'s swap is ${programs.map((one) => `${protocol}.${one}`).join(", ")}`,
      );
    }
    if (site.method !== "swap") {
      throw new Error(
        `${spelled} on Solana: ${namespace} offers swap, taking (${PARAMS.join(", ")}): it returns ` +
          "0 having moved nothing where the pool cannot trade, and reverts below minOut",
      );
    }
    l.site(n, () => lowerSwap(site, namespace, spelled));
  });

  function lowerSwap(site: MethodCall, namespace: string | undefined, spelled: string): void {
    l.requireInMain(site.call, spelled, "a venue's swap");
    const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
    if (args.length !== PARAMS.length || args.some((arg) => arg.type === "SpreadElement")) {
      throw new Error(
        `${spelled} takes ${PARAMS.length} arguments (${PARAMS.join(", ")}), got ${args.length}.`,
      );
    }
    const [poolArg, inArg, outArg, amountIn, , minOut] = args as [
      AstNode,
      AstNode,
      AstNode,
      AstNode,
      AstNode,
      AstNode,
    ];
    const text = (node: AstNode): string => l.source.slice(node.start, node.end);
    const pool = poolOf(poolArg);
    const tokenIn = l.tokenOf(inArg, text(inArg), spelled);
    const tokenOut = l.tokenOf(outArg, text(outArg), spelled);
    if (tokenIn.name === tokenOut.name) {
      throw new Error(`${spelled} on Solana pays and buys the same token, ${text(inArg)}`);
    }

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
    // At any venue, the router's own `swap`: it reads the venue from the pool's owner as it runs.
    const fn = namespace === undefined ? "swap" : SVM_VENUE_NAMESPACES[namespace]!.swap;
    l.spliceCall(
      site,
      amountIn,
      minOut,
      `${l.use(ROUTER, fn, `__sauce_${fn}`)}([${slot.join(", ")}], [${trader.join(", ")}], `,
      `, ${recipient})`,
    );
  }

  /** The pool: a parameter of `main` declared `Address`, or a 32-byte key. */
  function poolOf(node: AstNode): { readonly name: string; readonly stem: string } {
    if (node.type === "Identifier" && l.param(nameOf(node))?.kind === "address") {
      return { name: `@${nameOf(node)}`, stem: nameOf(node) };
    }
    const key = keyLiteral(node, l.source);
    if (key !== undefined) {
      literalPools++;
      return { name: base58(key), stem: `pool${literalPools}` };
    }
    throw new Error(
      `the pool \`${l.source.slice(node.start, node.end)}\` on Solana must be known when the ` +
        "transaction is built, to read its accounts from it: a parameter of main declared " +
        "`Address`, or a 32-byte key.",
    );
  }
}
