// @sauce/names — EVM arm.
//
// The classes a chain's names are instances of. The SDK writes one module per chain from its
// registry whose exports are instances of these — every token symbol, every protocol contract,
// `self`, `Token(address)` — and hands it to each program compiled for that chain as an ambient
// module, so a program uses them with no `import`. The compiler runs these classes while it
// compiles: a name costs a program nothing beyond what it does with it, and `USDC.transfer(to,
// amount)` is the same program as `transfer(<USDC's address>, to, amount)`.
import { approve, balanceOf, transfer, transferFrom } from "@sauce/token";

// An ERC-20 token. `symbol` is the registry's, or undefined for a token named by its address
// (`Token(address)`); an intent's delivery names the destination's token of the same symbol. The
// writes are `@sauce/token`'s, with SafeERC20 semantics, and return nothing.
export class Token {
  constructor(symbol, address, decimals) {
    this.symbol = symbol;
    this.address = address;
    this.decimals = decimals;
  }
  valueOf() {
    return this.address;
  }
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
    return balanceOf(this.address, holder);
  }
}

// A name some chain has and this one lacks. It compares as zero, so `if (USDC != 0) { … }` is
// decided while compiling and its arm is not compiled where the name is absent; any other use is a
// compile error in `reason`'s words. `symbol` is a token's, for an intent's delivery, which names
// the destination's token of that symbol.
export class Absent {
  constructor(reason, symbol) {
    this.reason = reason;
    this.symbol = symbol;
  }
  [Symbol.toPrimitive](hint) {
    if (hint === "default") return 0;
    throw new Error(this.reason);
  }
  toString() {
    return this.reason;
  }
}

// A name that is refused wherever it is used, a comparison included: one that names nothing a
// program can mean, such as a contract name two members of a protocol family share.
export class Refused {
  constructor(reason) {
    this.reason = reason;
  }
  [Symbol.toPrimitive](hint) {
    throw new Error(this.reason);
  }
  toString() {
    return this.reason;
  }
}

// A token's balance of the contract running the program, as `self.USDC` reads it.
export class Holding {
  constructor(token) {
    this.token = token;
  }
  valueOf() {
    return balanceOf(this.token.address, ctx.self());
  }
}
