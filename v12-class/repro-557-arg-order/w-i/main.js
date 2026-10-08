function f(a, b, c) {
  require(a != b);
  return a + b * c;
}
function main(x: Uint256, y: Uint256): Uint256 {
  return f(0x1234, x, y - 1) + f(y, x, 2);
}
