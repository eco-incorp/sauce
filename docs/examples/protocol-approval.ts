// Compiles a program for Base that approves Aave V3's Pool, by name, for exactly what the supply
// after it spends, so no allowance is left standing. Then appends `main`'s arguments and builds the
// cook that runs it on the owner's Pot: what `sauce run` sends. The same source compiles for
// Ethereum, where the names are Ethereum's. Offline: the owner is a fixture, and nothing is read or
// sent.
import {
  Base,
  DEFAULT_POT_SALT,
  kitchenExecutionFee,
  routes,
  v12PredictPot,
} from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress } from "viem";

// `USDC` and `AaveV3.Pool` are the registry's names: each chain compiles them to its own addresses.
const source = `
function main(onBehalfOf: Address, amount: Uint256) {
  require(pot.USDC >= amount, "not enough USDC");
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
}
`;
export const program = routes.compileSauceProgram("base", source);

// The program calls Base's Aave V3 Pool: its address is in the bytecode.
const aavePool = Base.AaveV3.Pool.address;
if (
  aavePool === undefined ||
  !bytesToHex(program.bytecode).includes(aavePool.slice(2).toLowerCase())
) {
  throw new Error("Expected Base's Aave V3 Pool in the program");
}

// main(onBehalfOf, amount): 1 USDC (6 decimals) supplied for the owner, who receives the aTokens.
const owner = "0x4444444444444444444444444444444444444444"; // fixture: your wallet
const payload = concatHex([
  bytesToHex(program.bytecode),
  bytesToHex(routes.encodeEntryArguments(program, [owner, 1_000_000n])),
]);

// The cook, which the owner sends to their default Pot. Its value is the Kitchen's fee: read it with
// `kitchenExecutionFee()`, an eth_call to the Kitchen, shortly before sending.
const pot = v12PredictPot(owner, DEFAULT_POT_SALT);
export const cook = { to: pot, data: v12Pot.encodeCook(getAddress(v12EngineAddress()), payload) };
export const feeRead = kitchenExecutionFee();

console.log(`supply program: ${program.bytecode.length} bytes`);
console.log(`cook to ${cook.to}: ${(cook.data.length - 2) / 2} bytes; fee read from ${feeRead.to}`);
