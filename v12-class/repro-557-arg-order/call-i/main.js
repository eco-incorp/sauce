import C from "./c.json";
function main(): Uint256 {
  return C.at(0x1234).get(ctx.self());
}
