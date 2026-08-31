// Fixture: both channels at once — `AMOUNT` is a build-time define (constant-folded into the
// bytecode) and `a` is a runtime arg (appended after it), so one program serves every `a`.
const AMOUNT = 0n;

function main(a) {
  return a + AMOUNT;
}
