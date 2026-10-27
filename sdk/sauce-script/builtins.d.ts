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
/** One signed 256-bit integer, from -2**255 through 2**255 - 1. */
type Int256 = bigint;

/** Checked numeric conversions; `fromBits` preserves all 256 bits instead. */
declare function Int256(value: SauceInt): Int256;
declare namespace Int256 {
  function fromBits(value: Uint256 | number): Int256;
}
declare function Uint256(value: SauceInt): Uint256;
declare namespace Uint256 {
  function fromBits(value: Int256 | number): Uint256;
}

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

/** Context reads: who called, where, when. */
declare const ctx: {
  /** The account that called: the Pot's owner, on a cook. */
  msgSender(): bigint;
  /** The program's own address: the Pot on an EVM chain, which a program writes `pot`. */
  self(): bigint;
  chainId(): bigint;
  blockNumber(): bigint;
  timestamp(): bigint;
  /** The program's own native balance: the Pot's on an EVM chain, which a program writes `pot.balance`. */
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
  /** EVM: the account that signed the transaction. Authorize on `msgSender()`, not on this. */
  txOrigin(): bigint;
  /** EVM: the block's fee recipient. */
  coinbase(): bigint;
  /** EVM: the block's randomness value, which its producer can bias. */
  prevrandao(): bigint;
  /** EVM: the block's gas limit. */
  blockGasLimit(): bigint;
  /** EVM: the block's base fee per gas. */
  baseFee(): bigint;
  /** EVM: the price per gas the transaction pays. */
  gasPrice(): bigint;
  /** EVM: the hash of block `n`; 0 outside the 256 blocks before this one. */
  blockHash(n: SauceInt): bigint;
  /** EVM: the versioned hash of the transaction's blob `i`; 0 past its last blob. */
  blobHash(i: SauceInt): bigint;
  /** EVM: the block's blob base fee. Halts the cook on a chain without one. */
  blobBaseFee(): bigint;
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
  /** Interprets the low `byte + 1` bytes as a signed integer (byte 0 is least significant). */
  signExtend(value: SauceInt, byte: SauceInt): Int256;
}

/** EVM: ABI encoding. */
declare const abi: {
  encode(...values: unknown[]): SauceBytes;
  /** The decoded values, by position: `const [a, b] = abi.decode(data, ["Uint256", "Address"])`. */
  decode(data: SauceData, shapes: readonly string[]): any;
};

/** EVM: calls, storage and contract creation. */
declare const evm: {
  call(address: SauceInt, value: SauceInt, data: SauceData, gas?: SauceInt): SauceCall<SauceBytes>;
  static(address: SauceInt, data: SauceData, gas?: SauceInt): SauceCall<SauceBytes>;
  delegate(address: SauceInt, data: SauceData, gas?: SauceInt): SauceCall<SauceBytes>;
  sload(slot: SauceInt): bigint;
  sstore(slot: SauceInt, value: SauceInt): void;
  tload(key: SauceInt): bigint;
  tstore(key: SauceInt, value: SauceInt): void;
  create(initcode: SauceData, value?: SauceInt): bigint;
  create2(initcode: SauceData, salt: SauceInt, value?: SauceInt): bigint;
  create3(initcode: SauceData, salt: SauceInt, value?: SauceInt): bigint;
  createAddress(deployer: SauceInt, nonce: SauceInt): bigint;
  create2Address(deployer: SauceInt, salt: SauceInt, initCodeHash: SauceInt): bigint;
  create3Address(salt: SauceInt): bigint;
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

/** A closure compiled as its own program, plus its captured run-time values. */
interface SauceClosureProgram {
  readonly code: SauceBytes;
  readonly args: SauceBytes;
}
interface SauceClosureProgramOptions {
  readonly chain?: string;
  readonly target?: "evm" | "svm";
}
type SauceClosureArguments<Args extends unknown[]> = {
  [K in keyof Args]: Args[K] extends bigint ? SauceInt : Args[K];
};
/** The inline arrow's arguments, then optional chain/target options. */
declare function program<Args extends unknown[]>(
  closure: (...args: Args) => unknown,
  ...args:
    SauceClosureArguments<Args> | [...SauceClosureArguments<Args>, SauceClosureProgramOptions]
): SauceClosureProgram;
/** Bytes from hex digits: hex`a9059cbb`. */
declare function hex(strings: TemplateStringsArray): SauceBytes;

interface BigInt {
  /** The value as `width` big-endian bytes. */
  toBytesBe(width: SauceInt): SauceBytes;
  /** The value as `width` little-endian bytes. */
  toBytesLe(width: SauceInt): SauceBytes;
  /**
   * A holder's native-coin balance: `pot.balance`, `recipient.balance` — wei on an EVM chain,
   * lamports on Solana. Only where the program's text shows an address: on a record, a list, a
   * contract call's result the registry does not record as an address, `abi.decode`'s result, a
   * name imported from a module, or a local bound to or destructured from one of those,
   * `balance` is its field. Write `ctx.balance(x)` for the coin there.
   */
  readonly balance: bigint;
}

interface ArrayConstructor {
  /** `n` zeros, for a program to fill: `let xs = new Array(n)`. */
  new (length: SauceInt): any[];
}

/**
 * The token at `address`: `Token(addr).transfer(to, amount)`. On an EVM chain an ERC-20, its writes
 * SafeERC20; on Solana a mint, the accounts each method moves through added to main.
 */
declare function Token(address: SauceInt): SauceTokenSource;

/**
 * The Pot: its address (`ctx.self()` on an EVM chain), and on Solana its account, which a call's
 * account list takes (`pot.writable()`, `pot.signer()`). Its balances: `pot.USDC` of a token the
 * chain registers, `pot.balance` of the native coin. Its owner, `pot.owner`: on Solana the owner's
 * account, which signs the cook (`pot.owner.address`, its key; `pot.owner.signer()`), on an EVM
 * chain the Pot's `owner()`, the zero address on a Shared Pot, which has no owner. A program that
 * declares its own `pot` owns the name, `pot.owner` with it.
 */
declare const pot: import("../routes/source-globals.generated.js").SauceSolanaAccount & {
  readonly owner: import("../routes/source-globals.generated.js").SauceSolanaAccount;
};

/**
 * Solana: an account a program writes where it uses it, added to main and derived as the cook is
 * built: `Account(key)`, the account at a key; `Account.pda(program, [seeds])`, the address a program
 * derives for the seeds; `Account.systemProgram`, `Account.tokenProgram`, `Account.token2022Program`,
 * `Account.associatedTokenProgram` and `Account.memoProgram`. As a type, `Account` is an account
 * `main` takes (`Account<Writable, Signer>`). A program that declares its own `Account` owns the name.
 */
declare const Account: import("../routes/source-globals.generated.js").SauceAccountFactory;

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
