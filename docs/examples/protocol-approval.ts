// Compile an Aave supply program offline; build a cook only from a verified persisted Base binding.
// Importing this example sends nothing and performs no RPC.
import { Base, kitchenExecutionFee, routes } from "@eco-incorp/sauce";
import { v12ReleaseSet } from "@eco-incorp/sauce/deployments";
import { verifyPotBinding, v12Pot, type EvmPotBindingInput } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, type PublicClient } from "viem";

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

export async function buildSupplyCook(client: PublicClient, input: EvmPotBindingInput) {
  const binding = await verifyPotBinding(client, input);
  if (binding.chainId !== 8453 || binding.compiler !== v12ReleaseSet().compiler) {
    throw new Error("Use this example's exact Base compiler/engine pair");
  }
  const payload = concatHex([
    bytesToHex(program.bytecode),
    bytesToHex(routes.encodeEntryArguments(program, [binding.owner, 1_000_000n])),
  ]);
  const cook = {
    to: binding.pot,
    data: v12Pot.encodeCook(binding.engine, payload, binding.compiler),
  };

  return { binding, cook, feeRead: kitchenExecutionFee(binding.kitchen) };
}
