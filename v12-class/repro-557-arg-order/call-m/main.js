import C from "./c.json";
class T {
  constructor(a) { this.a = a; }
  get(who) { return C.at(this.a).get(who); }
}
const t = new T(0x1234);
function main(): Uint256 {
  return t.get(ctx.self());
}
