import C from "./c.json";
function main(): Uint256 {
  const b = C.at(0x1234).get(ctx.self());
  C.at(0x99).get(b);
  return b;
}
