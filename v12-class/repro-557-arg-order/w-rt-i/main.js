function f(a, b, c) {
  require(a != b);
  return a + b * c;
}
function main(r: { a: Uint256; n: Uint256 }, x: Uint256): Uint256 {
  return f(r.a, x, r.n) + f(x, x, 2);
}
