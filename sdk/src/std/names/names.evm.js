// @sauce/names — EVM arm.
//
// The class a chain's tokens are instances of. The SDK writes one module per chain from its
// registry — every token symbol, every protocol contract, `self`, `Token(address)` — and hands it to
// each program compiled for that chain as an ambient module, so a program uses them with no
// `import`. The compiler runs these classes while it compiles: a name costs a program nothing beyond
// what it does with it, and `USDC.transfer(to, amount)` is the same program as
// `transfer(<USDC's address>, to, amount)`.
import { approve, transfer, transferFrom } from "@sauce/token";
// `@sauce/token`'s ERC-20 ABI, copied (held equal by `routes-token-names.test.ts`).
import ERC20 from "./erc20.abi.json";

// An ERC-20 token. `symbol` is the registry's, or undefined for a token named by its address
// (`Token(address)`); an intent's delivery names the destination's token of the same symbol. The
// writes are `@sauce/token`'s, with SafeERC20 semantics, and return nothing. A read is the typed
// call where it is used, the program a hand-written `ERC20.at(token).balanceOf(holder)` is, rather
// than a call into the library's `balanceOf`, which adds a frame.
export class Token {
  constructor(symbol, address, decimals) {
    this.symbol = symbol;
    this.address = address;
    this.decimals = decimals;
  }
  valueOf() {
    return this.address;
  }
  // A missing argument is the compiler's own error ("`amount` is `undefined`, so it has no run-time
  // value here"): no guard here, so each method is the library call, byte for byte.
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
