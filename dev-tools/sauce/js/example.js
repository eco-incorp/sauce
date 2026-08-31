// Basic example: arithmetic with sender check. `sauce example.js A=5 B=10`.
const A = 0n;
const B = 0n;

function main() {
  const sender = ctx.msgSender();
  if (!(A > 0)) throw "a must be positive";
  return A + B;
}
