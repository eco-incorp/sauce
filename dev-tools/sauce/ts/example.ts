// Basic example: arithmetic with sender check
function main(a: any, b: any) {
  const sender = ctx.msgSender();
  if (!(a > 0)) throw "a must be positive";
  return a + b;
}
