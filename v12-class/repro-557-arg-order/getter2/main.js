import C from "./c.json";
class Self {
  get USDC() { return C.at(0x1234).get(ctx.self()); }
}
const self = new Self();
function main(): Uint256 {
  const b = self.USDC;
  C.at(0x99).get(b);
  return b;
}
