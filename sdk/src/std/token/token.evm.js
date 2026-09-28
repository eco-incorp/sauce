// @sauce/token — EVM arm (ERC20).
// Selected by the compiler for `--target evm`. The reads are ordinary ABI-typed calls; the writes
// are OpenZeppelin `SafeERC20`, for the reasons below. `token`/`account` addresses ride calldata
// like any other value.
import ERC20 from "./erc20.abi.json";

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
