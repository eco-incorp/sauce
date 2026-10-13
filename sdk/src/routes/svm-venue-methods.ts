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
import { SVM_SLOT_PARTS } from "../svm/pool-slot.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const ROUTER = "@sauce/router";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Each venue's namespace: its `@sauce/router` functions and its name for a person. */
export const SVM_VENUE_NAMESPACES: Readonly<
  Record<string, { readonly name: string; readonly swap: string; readonly trySwap: string }>
> = {
  RaydiumClmm: { name: "Raydium CLMM", swap: "raydiumClmm", trySwap: "tryRaydiumClmm" },
  PancakeswapClmm: {
    name: "PancakeSwap CLMM",
    swap: "pancakeswapClmm",
    trySwap: "tryPancakeswapClmm",
  },
  Byreal: { name: "Byreal", swap: "byreal", trySwap: "tryByreal" },
  StabbleClmm: { name: "Stabble CLMM", swap: "stabbleClmm", trySwap: "tryStabbleClmm" },
  OrcaWhirlpool: { name: "Orca Whirlpools", swap: "orcaWhirlpool", trySwap: "tryOrcaWhirlpool" },
  Cropper: { name: "Cropper", swap: "cropper", trySwap: "tryCropper" },
  Defituna: { name: "DefiTuna", swap: "defituna", trySwap: "tryDefituna" },
  Crema: { name: "Crema", swap: "crema", trySwap: "tryCrema" },
  Phoenix: { name: "Phoenix", swap: "phoenix", trySwap: "tryPhoenix" },
};

/** The methods each namespace offers, and the arguments they take. */
const METHODS = ["swap", "trySwap"] as const;
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
    if (!isVenueNamespace(namespace) || l.declared.has(namespace)) return;
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
    const venue = SVM_VENUE_NAMESPACES[namespace]!;
    const fn = site.method === "swap" ? venue.swap : venue.trySwap;
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
