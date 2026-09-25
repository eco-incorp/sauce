// Basic example: arithmetic with sender check
function main(a: Uint256, b: Uint256): Uint256 {
  const sender = ctx.msgSender();
  if (!(a > 0)) throw "a must be positive";
  return a + b;
}
