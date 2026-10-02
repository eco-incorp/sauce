// SauceScript's own names, declared for a TypeScript editor checking a program file (`*.sauce.ts`):
// the types a signature names, the builtins (`ctx`, `crypto`, `Math`, `abi`, `evm`, `svm`,
// `require`, `hex`, ...), value methods, contract bindings from a JSON ABI import, the
// `@sauce/token` functions a program calls with no import, and `Token(address)`.
//
// The Sauce compiler, not this file, decides what compiles: these declarations describe the language
// to an editor, which checks names, arity and argument shapes against them. A builtin of one target
// (`evm.*`, `svm.*`) is declared for both; compiling for the other is the error that says so.
//
// A SCRIPT (no import or export), so its declarations are global. Load it only into a TypeScript
// project of SauceScript files: it declares `require`, `crypto`, `log` and `eval` as SauceScript has
// them, which a Node or browser project declares otherwise. `sauce init` writes that project.

/** A number SauceScript takes: a 256-bit integer, written `1n` (a plain `1` is one too). */
type SauceInt = bigint | number;

/** The bytes a contract call returns, and what the generated namespace types take. */
type SauceBytesOf = import("../routes/source-globals.generated.js").SauceBytes;

/** A bytes value: `hex\`…\``, a call's result, `abi.encode(…)`. */
interface SauceBytes extends SauceBytesOf {
  slice(start: SauceInt, end: SauceInt): SauceBytes;
  concat(...parts: SauceData[]): SauceBytes;
}

/** Bytes SauceScript takes: a bytes value, or a `"text"` literal, which is its UTF-8 bytes. */
type SauceData = SauceBytesOf | string;

/** An array SauceScript returns, its length a Sauce number. */
type SauceArray<T> = import("../routes/source-globals.generated.js").SauceArray<T>;

/** An ERC-20 token, its writes SafeERC20 (`Token(addr).transfer(to, amount)`). */
type SauceTokenSource = import("../routes/source-globals.generated.js").SauceTokenSource;

/** One unsigned 256-bit integer. */
type Uint256 = bigint;
/** An address: a number, on the EVM 20 bytes, on Solana a 32-byte key. */
type Address = bigint;
/** A bool. */
type bool = boolean;
/** A bytes value. */
type bytes = SauceBytes;

/** A role an `Account` parameter requires of the account attached at its slot (Solana). */
interface Writable {
  readonly writable: true;
}
interface Signer {
  readonly signer: true;
}

/** What an account carries: its key, and on Solana its owner program and data length. */
interface SauceAccountFields {
  readonly address: bigint;
  readonly owner: bigint;
  readonly dataLen: bigint;
}

/**
 * An account `main` takes. On Solana the transaction attaches it at its slot, with the roles named
 * (`Account<Writable>`, `Account<Writable, Signer>`), and it compares equal to its address. On an
 * EVM chain only a bare `Account` compiles, and it is an address.
 */
type Account<R1 = unknown, R2 = unknown> = bigint &
  SauceAccountFields & { readonly roles?: [R1, R2] };

/** A contract a JSON ABI binds: `IERC20.at(token).balanceOf(holder)`. */
interface SauceContract {
  /** Calls it (state may change). */
  at(address: SauceInt): SauceBinding;
  /** Calls it statically: a view or pure method. */
  view(address: SauceInt): SauceBinding;
  /** Calls its code as the Pot: a delegate call. */
  lib(address: SauceInt): SauceBinding;
}

/** The methods of a bound contract, by name. */
interface SauceBinding {
  readonly [method: string]: (...args: any[]) => any;
}

/** A token amount an intent names: `{ token: USDC, amount }`. */
interface SauceTokenAmount {
  readonly token: SauceInt;
  readonly amount: SauceInt;
}

/** One item of an intent's reward, paid on the chain that opens it: a token amount, a list of
 *  them, or the native coin as `{ native: amount }`. */
type SauceRewardItem =
  SauceTokenAmount | ReadonlyArray<SauceTokenAmount> | { readonly native: SauceInt };

/** One item of what the solver delivers on the destination for the body to run on: a token
 *  amount, or a list of them. */
type SauceDeliveryItem = SauceTokenAmount | ReadonlyArray<SauceTokenAmount>;

/** `<Chain>.Portal`: an intent to that chain, opened from a program —
 *  `Base.Portal.send({ … }).receive({ … }).then(() => { … })`. */
interface SaucePortal {
  /** The reward, paid here: any number of items, each an argument. */
  send(...reward: SauceRewardItem[]): SauceSending;
}

/** An intent with its reward, waiting for what the solver delivers. */
interface SauceSending {
  /** What the solver delivers on the destination, named there: any number of items, none with
   *  `.receive()`. */
  receive(...delivery: SauceDeliveryItem[]): SauceReceiving;
}

/** An intent with its reward and delivery: the body is what it needs. */
interface SauceReceiving {
  /** What runs on the destination: a program of its own, or token transfers the route makes. */
  then(body: () => void): SauceOpened;
}

/** An intent with its body. */
interface SauceOpened {
  /** What runs on the destination in the body's place when the body reverts: everything the body
   *  did is undone, and the fill still succeeds. EVM destinations only. */
  catch(handler: () => void): void;
}

/** Context reads: who called, where, when. */
declare const ctx: {
  /** The account that called: the Pot's owner, on a cook. */
  msgSender(): bigint;
  /** The program's own address: the Pot. */
  self(): bigint;
  chainId(): bigint;
  blockNumber(): bigint;
  timestamp(): bigint;
  /** The Pot's native balance. */
  selfBalance(): bigint;
  msgData(): SauceBytes;
  balance(address: SauceInt): bigint;
  /** EVM: the value the cook carried. */
  msgValue(): bigint;
  /** EVM. */
  gasLeft(): bigint;
  /** EVM. */
  codeSize(address: SauceInt): bigint;
  /** EVM. */
  codeHash(address: SauceInt): bigint;
  /** EVM. */
  isContract(address: SauceInt): boolean;
  /** EVM. */
  isEOA(address: SauceInt): boolean;
};

declare const crypto: {
  keccak256(data: SauceData): bigint;
  ecdsaVerify(hash: SauceInt, signature: SauceData, signer: SauceInt): boolean;
  /** `const [address, bump] = crypto.findPDA(programId, seeds)`. */
  findPDA(
    programId: SauceInt,
    seeds: ReadonlyArray<SauceData> | SauceArray<SauceBytesOf>,
  ): [bigint, bigint];
};

interface Math {
  /** The integer square root, rounded down. */
  sqrt(x: SauceInt): bigint;
  /** `x * y / d` with a 512-bit intermediate, rounded down. */
  mulDiv(x: SauceInt, y: SauceInt, d: SauceInt): bigint;
  addMod(a: SauceInt, b: SauceInt, n: SauceInt): bigint;
  mulMod(a: SauceInt, b: SauceInt, n: SauceInt): bigint;
  /** Signed (two's-complement) division. */
  sDiv(a: SauceInt, b: SauceInt): bigint;
  sMod(a: SauceInt, b: SauceInt): bigint;
  sShr(value: SauceInt, bits: SauceInt): bigint;
  signExtend(value: SauceInt, byte: SauceInt): bigint;
  sLt(a: SauceInt, b: SauceInt): bigint;
  sGt(a: SauceInt, b: SauceInt): bigint;
  sLte(a: SauceInt, b: SauceInt): bigint;
  sGte(a: SauceInt, b: SauceInt): bigint;
}

/** EVM: ABI encoding. */
declare const abi: {
  encode(...values: unknown[]): SauceBytes;
  /** The decoded values, by position: `const [a, b] = abi.decode(data, ["Uint256", "Address"])`. */
  decode(data: SauceData, shapes: readonly string[]): any;
};

/** EVM: calls and storage. */
declare const evm: {
  call(address: SauceInt, value: SauceInt, data: SauceData): SauceBytes;
  static(address: SauceInt, data: SauceData): SauceBytes;
  delegate(address: SauceInt, data: SauceData): SauceBytes;
  sload(slot: SauceInt): bigint;
  sstore(slot: SauceInt, value: SauceInt): void;
  tload(key: SauceInt): bigint;
  tstore(key: SauceInt, value: SauceInt): void;
};

/** Solana: account data and cross-program calls. */
declare const svm: {
  sload(account: Account, offset: SauceInt, length: SauceInt): SauceBytes;
  sstore(account: Account, offset: SauceInt, data: SauceData): void;
  call(program: Account, accounts: readonly Account[], data: SauceData): SauceBytes;
  remainingAccount(index: SauceInt): Account;
  remainingAccounts(): Account[];
};

/** Fails the whole program, and the transaction with it, unless `condition` holds. */
declare function require(condition: unknown, message?: SauceData): void;
/** Fails the program with `data` as its revert data. */
declare function revert(data?: SauceData): never;
/** Emits a log; topics are EVM only. */
declare function log(data: SauceData, ...topics: SauceInt[]): void;
/** Runs another program, with arguments. */
declare function eval(program: SauceData, ...args: SauceInt[]): SauceBytes;
/** Bytes from hex digits: hex`a9059cbb`. */
declare function hex(strings: TemplateStringsArray): SauceBytes;

interface BigInt {
  /** The value as `width` big-endian bytes. */
  toBytesBe(width: SauceInt): SauceBytes;
  /** The value as `width` little-endian bytes. */
  toBytesLe(width: SauceInt): SauceBytes;
  /** An external call's result — or, when the call fails, what the handler returns. */
  catch(handler: () => unknown): bigint;
}

interface ArrayConstructor {
  /** `n` zeros, for a program to fill: `let xs = new Array(n)`. */
  new (length: SauceInt): any[];
}

/** The ERC-20 token at `address`: `Token(addr).transfer(to, amount)`, with SafeERC20 writes. */
declare function Token(address: SauceInt): SauceTokenSource;

// `@sauce/token`, whose functions every program on a chain calls with no import: an EVM token is
// an address; on Solana the mint is an address, its accounts `Account` slots, and a write names
// its token program and the authority (`transfer`/`approve` SPL Token only, the checked writes
// either SPL Token or Token-2022, with the mint's account and its decimals).
declare function balanceOf(token: SauceInt, account: SauceInt | Account): bigint;
declare function totalSupply(token: SauceInt | Account): bigint;
declare function decimals(token: SauceInt | Account): bigint;
declare function allowance(token: SauceInt, owner: SauceInt | Account, spender: SauceInt): bigint;
/** Solana only: whose token account `account` is, a wallet or a PDA such as a Pot. */
declare function ownerOf(token: SauceInt, account: Account): bigint;
declare function transfer(token: SauceInt, to: SauceInt, amount: SauceInt): void;
declare function transfer(
  token: SauceInt,
  tokenProgram: Account,
  source: Account,
  dest: Account,
  authority: Account,
  amount: SauceInt,
): void;
declare function transferFrom(
  token: SauceInt,
  from: SauceInt,
  to: SauceInt,
  amount: SauceInt,
): void;
declare function transferFrom(
  token: SauceInt,
  tokenProgram: Account,
  source: Account,
  dest: Account,
  authority: Account,
  amount: SauceInt,
): void;
declare function approve(token: SauceInt, spender: SauceInt, amount: SauceInt): void;
declare function approve(
  token: SauceInt,
  tokenProgram: Account,
  source: Account,
  delegate: Account,
  authority: Account,
  amount: SauceInt,
): void;
/** Solana only: a `TransferChecked` through the token program that owns the mint, either one. */
declare function transferChecked(
  token: SauceInt,
  tokenProgram: Account,
  source: Account,
  mint: Account,
  dest: Account,
  authority: Account,
  amount: SauceInt,
  decimals: SauceInt,
): void;
/** Solana only: an `ApproveChecked` through the token program that owns the mint, either one. */
declare function approveChecked(
  token: SauceInt,
  tokenProgram: Account,
  source: Account,
  mint: Account,
  delegate: Account,
  authority: Account,
  amount: SauceInt,
  decimals: SauceInt,
): void;
declare function permit(
  token: SauceInt,
  owner: SauceInt,
  spender: SauceInt,
  value: SauceInt,
  deadline: SauceInt,
  v: SauceInt,
  r: SauceInt,
  s: SauceInt,
): void;
declare function permitTransferFrom(
  token: SauceInt,
  owner: SauceInt,
  amount: SauceInt,
  nonce: SauceInt,
  deadline: SauceInt,
  signature: SauceData,
  permit2: SauceInt,
): void;

/** The same functions, imported by name. */
declare module "@sauce/token" {
  export const allowance: typeof globalThis.allowance;
  export const approve: typeof globalThis.approve;
  export const approveChecked: typeof globalThis.approveChecked;
  export const balanceOf: typeof globalThis.balanceOf;
  export const decimals: typeof globalThis.decimals;
  export const ownerOf: typeof globalThis.ownerOf;
  export const permit: typeof globalThis.permit;
  export const permitTransferFrom: typeof globalThis.permitTransferFrom;
  export const totalSupply: typeof globalThis.totalSupply;
  export const transfer: typeof globalThis.transfer;
  export const transferChecked: typeof globalThis.transferChecked;
  export const transferFrom: typeof globalThis.transferFrom;
}

// The catch-all modules — a JSON ABI beside the program, another `@sauce/` library — are declared
// last, in index.d.ts: of the patterns a specifier matches, TypeScript takes the first declared.
