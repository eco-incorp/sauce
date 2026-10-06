// @sauce/names — SVM arm.
//
// The classes a Solana program's names are instances of; see the EVM arm. A Solana token is its
// mint's key, a plain value, so there is no token class here: an SPL write needs accounts a symbol
// does not carry, and takes the mint as an `Account` (`@sauce/token`'s SVM arm).

// A name some chain has and this one lacks. It compares as zero, so `if (UniswapV3 != 0) { … }` is
// decided while compiling; any other use is a compile error in `reason`'s words.
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

// A name that is refused wherever it is used, a comparison included.
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
