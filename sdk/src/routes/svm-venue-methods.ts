/**
 * Solana's price-limit venues as namespaces in a program compiled for Solana, the way a program
 * calls a protocol by its namespace on an EVM chain:
 *
 *   OrcaWhirlpool.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)      what arrived
 *   OrcaWhirlpool.trySwap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)   0 when skipped
 *
 * and the same on `RaydiumClmm`, `PancakeswapClmm`, `Byreal`, `StabbleClmm`, `Cropper`, `Defituna`,
 * `Crema` and `Phoenix`. Each lowers to that venue's own `@sauce/router` function (`orcaWhirlpool`,
 * `tryOrcaWhirlpool`), never `trySwap`, which carries every venue's code: one venue's function is
 * about a third of its size. That function keeps its every check — its program id, the pool's owner,
 * the pair — and its contract: the try form returns 0 having moved nothing, the plain one reverts
 * there, and a swap that ran is held to `minOut` and returns at least 1.
 *
 *   Solana.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)
 *   Solana.trySwap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)
 *
 * are the same at a pool of ANY of the nine, the venue read from the pool's owner as the program
 * runs: they lower to `@sauce/router`'s own `swap` and `trySwap`, which carry every venue's code, for
 * a program that takes its pools as arguments and so cannot know their venues — the distributed
 * swap. A pool given as the System Program (`11111111111111111111111111111111`, the zero key) is an
 * empty slot: its nine accounts are the System Program, and `trySwap` returns 0 for it.
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

/** A venue's namespace: its name for a person, its program, and its `@sauce/router` functions. */
export interface SvmVenueNamespace {
  readonly name: string;
  readonly program: string;
  readonly swap: string;
  readonly trySwap: string;
}

const venue = (name: string, swap: string, trySwap: string): SvmVenueNamespace => ({
  name,
  program: SVM_PRICE_LIMIT_VENUES.find((one) => one.name === name)!.program,
  swap,
  trySwap,
});

/** Each venue's namespace, as a program writes it. */
export const SVM_VENUE_NAMESPACES: Readonly<Record<string, SvmVenueNamespace>> = {
  RaydiumClmm: venue("Raydium CLMM", "raydiumClmm", "tryRaydiumClmm"),
  PancakeswapClmm: venue("PancakeSwap CLMM", "pancakeswapClmm", "tryPancakeswapClmm"),
  Byreal: venue("Byreal", "byreal", "tryByreal"),
  StabbleClmm: venue("Stabble CLMM", "stabbleClmm", "tryStabbleClmm"),
  OrcaWhirlpool: venue("Orca Whirlpools", "orcaWhirlpool", "tryOrcaWhirlpool"),
  Cropper: venue("Cropper", "cropper", "tryCropper"),
  Defituna: venue("DefiTuna", "defituna", "tryDefituna"),
  Crema: venue("Crema", "crema", "tryCrema"),
  Phoenix: venue("Phoenix", "phoenix", "tryPhoenix"),
};

/** How a program calls a venue's swap, each method's signature. */
export const SVM_VENUE_METHODS: readonly string[] = [
  "swap(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, maxPrice: Uint256, minOut: Uint256): Uint256",
  "trySwap(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, maxPrice: Uint256, minOut: Uint256): Uint256",
];

/** The methods each namespace offers, and the arguments they take. */
const METHODS = ["swap", "trySwap"] as const;

/** The namespace whose swap takes a pool of any of the venues: the chain's own. */
export const SVM_ANY_VENUE = "Solana";
const PARAMS = ["pool", "tokenIn", "tokenOut", "amountIn", "maxPrice", "minOut"] as const;

export const isVenueNamespace = (name: string): boolean =>
  Object.hasOwn(SVM_VENUE_NAMESPACES, name);

/** The venue namespaces' sites: `<Venue>.swap(…)` and `<Venue>.trySwap(…)`. */
export function collectVenueMethods(l: SvmLowering): void {
  let literalPools = 0;
  walk(l.program, (n) => {
    const site = methodCall(n);
    if (site === undefined || site.object.type !== "Identifier") return;
    const namespace = nameOf(site.object);
    if (l.declared.has(namespace)) return;
    // `Solana.pda(…)` and the chain's other members are not swaps: only its two are taken here.
    const any = namespace === SVM_ANY_VENUE && (METHODS as readonly string[]).includes(site.method);
    if (!any && !isVenueNamespace(namespace)) return;
    const spelled = `\`${namespace}.${site.method}(…)\``;
    if (!(METHODS as readonly string[]).includes(site.method)) {
      throw new Error(
        `${spelled} on Solana: ${namespace} offers swap and trySwap, each taking ` +
          `(${PARAMS.join(", ")})`,
      );
    }
    l.site(n, () => lowerSwap(site, namespace, spelled));
  });

  function lowerSwap(site: MethodCall, namespace: string, spelled: string): void {
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
    const venue = SVM_VENUE_NAMESPACES[namespace];
    // At any venue, the router's own: it reads the venue from the pool's owner as it runs.
    const fn =
      venue === undefined ? site.method : site.method === "swap" ? venue.swap : venue.trySwap;
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
