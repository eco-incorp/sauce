function f(a, b, c) {
  require(a != b);
  return a + b * c;
}
class T {
  constructor(a) { this.a = a; }
  send(to, n) { return f(this.a, to, n); }
}
const t = new T(0x1234);
function main(x: Uint256, y: Uint256): Uint256 {
  return t.send(x, y - 1) + f(y, x, 2);
}
