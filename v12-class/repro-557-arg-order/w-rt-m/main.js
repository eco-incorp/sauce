function f(a, b, c) {
  require(a != b);
  return a + b * c;
}
class T {
  constructor(a) { this.a = a; }
  send(to, n) { return f(this.a, to, n); }
}
function main(r: { a: Uint256; n: Uint256 }, x: Uint256): Uint256 {
  return new T(r.a).send(x, r.n) + f(x, x, 2);
}
