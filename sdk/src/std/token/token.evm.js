// @sauce/token — EVM arm (ERC20).
// Selected by the compiler for `--target evm`. Every method is an ordinary ERC20 call over the
// `CALL`/`STATIC` path; `token`/`account` addresses ride calldata like any other value.
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

// The writes are `: void` and DISCARD the ERC20 `bool` return — they don't `require` it. Real
// SafeERC20 is "empty returndata OR the decoded word is true", but the compiler exposes no
// returndatasize primitive (the only raw-returndata access is `evm.call`, which would abandon the
// ABI-aware `ERC20.at().method()` path this arm is built on), so "empty OR true" isn't expressible
// here. A plain `require(...transfer(...))` reverts on a USDT-style no-returndata token — the decode
// clamps the missing word to 0/false and the `require` then reverts a transfer that actually
// succeeded — so the bool is dropped: USDT compatibility beats catching a rare non-reverting-false
// token. The CALL's side effect (and any genuine revert from the token) still happens; only the
// return word is ignored. TODO: revisit once the compiler gains a returndatasize op to express real
// SafeERC20 (tracked as the EVM SafeERC20 limitation in README's cross-target divergences).
export function transfer(token: Address, to: Address, amount: Uint256): void {
  ERC20.at(token).transfer(to, amount);
}

export function transferFrom(token: Address, from: Address, to: Address, amount: Uint256): void {
  ERC20.at(token).transferFrom(from, to, amount);
}

export function approve(token: Address, spender: Address, amount: Uint256): void {
  ERC20.at(token).approve(spender, amount);
}
