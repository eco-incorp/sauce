// Fixture: a build-parameterized program. `AMOUNT` is a module-scope const a caller overrides
// with a compile-time define, which is constant-folded into the bytecode.
const AMOUNT = 0n;

function main() {
  return AMOUNT + 1n;
}
