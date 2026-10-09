// @sauce/token — EVM arm (ERC20).
// Selected by the compiler for `--target evm`. The reads are ordinary ABI-typed calls; the writes
// are OpenZeppelin `SafeERC20`, for the reasons below. `token`/`account` addresses ride calldata
// like any other value.
import ERC20 from "./erc20.abi.json";
// The registry's Permit2 ABI (`protocols/permit2`), whole: `test/std/token/compile.test.ts` holds
// this file equal to it, so what `permitTransferFrom` below binds is what the registry evidence pins
// against every deployed Permit2. A copy beside this module rather than an import of the registry's
// file, because a package resolved off disk cannot reach outside its own directory.
import PERMIT2 from "./permit2.abi.json";

export function balanceOf(token: Address, account: Account): Uint256 {
  return ERC20.at(token).balanceOf(account);
}

export function totalSupply(token: Address): Uint256 {
  return ERC20.at(token).totalSupply();
}

export function decimals(token: Address): Uint256 {
  return ERC20.at(token).decimals();
}

export function allowance(token: Address, owner: Address, spender: Address): Uint256 {
  return ERC20.at(token).allowance(owner, spender);
}

// `SafeERC20`'s check on what a write returned: empty returndata is success only from an address
// that HAS code, and anything else must be an ABI word equal to 1. Both halves matter. A token that
// returns `false` instead of reverting is the case `SafeERC20` exists for, and dropping the check
// loses value silently; a call to an address with no code always "succeeds", so an unchecked write
// to a mistyped address is a no-op the program never hears about.
//
// `abi.decode` as a `Uint256`, then an explicit `== 1`, because each rejects what the other lets
// through. The decode refuses fewer than 32 bytes, which a comparison on the raw bytes would
// zero-pad into a value, and reads only the first word of a longer return, as OpenZeppelin does. The
// comparison refuses any word other than 1; decoding as `["bool"]` instead would not, since this
// engine does not reject a `bool` word that is neither 0 nor 1.
function checked(token: Address, result: bytes): void {
  if (result.length == 0) {
    require(ctx.codeSize(token) > 0);
  } else {
    let [ok] = abi.decode(result, ["Uint256"]);
    require(ok == 1n);
  }
}

// WHY THE WRITES DO NOT GO THROUGH `ERC20.at(token).transfer(...)` like the reads do. The ABI
// declares a `bool` return, and the compiler lowers a declared output to call-THEN-DECODE even when
// the caller discards it. Decoding from empty returndata reverts, so the typed spelling reverts on
// every token that returns nothing — USDT among them — for a transfer that actually succeeded.
// `evm.call` hands back the raw returndata instead, which is what makes "empty OR true" expressible.
//
// The selectors are written out because the call is raw. They are the ERC20 standard's own, and
// `test/std/token/compile.test.ts` pins each one against `keccak256` of its canonical signature.
export function transfer(token: Address, to: Address, amount: Uint256): void {
  const selector = hex`a9059cbb`;
  const data = selector.concat(to.toBytesBe(32)).concat(amount.toBytesBe(32));
  checked(token, evm.call(token, 0n, data));
}

export function transferFrom(token: Address, from: Address, to: Address, amount: Uint256): void {
  const selector = hex`23b872dd`;
  const data = selector
    .concat(from.toBytesBe(32))
    .concat(to.toBytesBe(32))
    .concat(amount.toBytesBe(32));
  checked(token, evm.call(token, 0n, data));
}

// `approve` is `SafeERC20.forceApprove`, not `safeApprove`. USDT reverts when a NON-ZERO allowance
// is changed to another non-zero value, so an approve is only safe from a zero base. OZ tries the
// approve and falls back on catching the revert; a reverting `evm.call` cannot be caught in a Sauce
// program, so this READS the allowance first — a `uint256`, always safe to decode — and resets only
// when there is something to reset. Same end state, decided before the call instead of after, at
// the cost of one STATICCALL.
//
// The owner is `ctx.self()` because that is the address whose allowance this call will set: the
// executing contract is the `msg.sender` of the CALL below.
export function approve(token: Address, spender: Address, amount: Uint256): void {
  const selector = hex`095ea7b3`;
  const spenderWord = spender.toBytesBe(32);
  const zero = 0n;
  if (ERC20.at(token).allowance(ctx.self(), spender) > 0n) {
    checked(token, evm.call(token, 0n, selector.concat(spenderWord).concat(zero.toBytesBe(32))));
  }
  checked(token, evm.call(token, 0n, selector.concat(spenderWord).concat(amount.toBytesBe(32))));
}

// THE PULLS: moving tokens INTO the program from the account that holds them. Each is a SafeERC20
// `safeTransferFrom`, however it is authorised:
//
//   - a standing allowance: `transferFrom(token, owner, ctx.self(), amount)`, above;
//   - an EIP-2612 signature: `permit(...)` sets that allowance, then the same `transferFrom`;
//   - a Permit2 signature: `permitTransferFrom(...)`, where Permit2 itself does the transfer, with
//     Solmate's `SafeTransferLib.safeTransferFrom` (empty or `true` returndata, else revert).

// `owner`'s nonce on an EIP-2612 token: `nonces(address)`, read raw (the ERC-20 ABI above has no
// `nonces`), and decoded as the `uint256` the standard declares.
function permitNonce(token: Address, owner: Address): Uint256 {
  const selector = hex`7ecebe00`;
  let [nonce] = abi.decode(evm.static(token, selector.concat(owner.toBytesBe(32))), ["Uint256"]);
  return nonce;
}

// EIP-2612 `permit`: `owner`'s signature, `(v, r, s)` over `Permit(owner, spender, value, nonce,
// deadline)`, setting `spender`'s allowance to `value`. `permit` returns nothing, so its returndata
// says nothing either way; what proves it ran is OpenZeppelin `safePermit`'s check, that the token's
// nonce for `owner` moved by exactly one. Without it a token with no `permit` but a permissive
// fallback (WETH9's accepts any call) would pass for one that granted the allowance.
export function permit(
  token: Address,
  owner: Address,
  spender: Address,
  value: Uint256,
  deadline: Uint256,
  v: Uint256,
  r: Uint256,
  s: Uint256,
): void {
  const before = permitNonce(token, owner);
  const selector = hex`d505accf`;
  const data = selector
    .concat(owner.toBytesBe(32))
    .concat(spender.toBytesBe(32))
    .concat(value.toBytesBe(32))
    .concat(deadline.toBytesBe(32))
    .concat(v.toBytesBe(32))
    .concat(r.toBytesBe(32))
    .concat(s.toBytesBe(32));
  evm.call(token, 0n, data);
  require(permitNonce(token, owner) == before + 1n);
}

// Permit2 SignatureTransfer: `amount` of `token` from `owner` to this program (`ctx.self()`) on
// `owner`'s one-time EIP-712 signature over `PermitTransferFrom(TokenPermissions(token, amount),
// spender, nonce, deadline)`, the spender being this program — the caller Permit2 checks it
// against. `permit2` is the Permit2 deployment (`Permit2.Permit2` in a route body). Permit2 spends
// `nonce` and refuses a passed `deadline`, and moves the tokens with `SafeTransferLib`, so a
// token that returns nothing (USDT) works and one that returns `false` reverts the program.
export function permitTransferFrom(
  token: Address,
  owner: Address,
  amount: Uint256,
  nonce: Uint256,
  deadline: Uint256,
  signature: bytes,
  permit2: Address,
): void {
  PERMIT2.at(permit2).permitTransferFrom(
    { permitted: { token: token, amount: amount }, nonce: nonce, deadline: deadline },
    { to: ctx.self(), requestedAmount: amount },
    owner,
    signature,
  );
}

// An ERC-20 token as a chain's names hold one: each registry symbol (`USDC`) and `Token(address)`
// are instances, which the SDK's module for the chain makes. The compiler runs this class while it
// compiles, so `USDC.transfer(to, amount)` is the same program as `transfer(<USDC's address>, to,
// amount)`. `symbol` is the registry's, or undefined for a token named by its address; an intent's
// delivery names the destination's token of the same symbol. The writes are this module's, with
// SafeERC20 semantics, and return nothing. A read is the typed call where it is used, the program a
// hand-written `ERC20.at(token).balanceOf(holder)` is, rather than a call into `balanceOf` above,
// which adds a frame. It is `TokenOf`, not `Token`: this module is ambient, and the chain's module
// exports `Token(address)`, which makes one.
export class TokenOf {
  constructor(symbol, address, decimals) {
    this.symbol = symbol;
    this.address = address;
    this.decimals = decimals;
  }
  valueOf() {
    return this.address;
  }
  // A missing argument is the compiler's own error ("`amount` is `undefined`, so it has no run-time
  // value here"): no guard here, so each method is the function above, byte for byte.
  transfer(to, amount) {
    transfer(this.address, to, amount);
  }
  approve(spender, amount) {
    approve(this.address, spender, amount);
  }
  transferFrom(from, to, amount) {
    transferFrom(this.address, from, to, amount);
  }
  balanceOf(holder) {
    return ERC20.at(this.address).balanceOf(holder);
  }
}
