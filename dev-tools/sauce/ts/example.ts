// Basic example: arithmetic with sender check. `sauce example.ts A=5 B=10`.
const A: Uint256 = 0;
const B: Uint256 = 0;

function main(): Uint256 {
  const sender = ctx.msgSender();
  if (!(A > 0)) throw "a must be positive";
  return A + B;
}
