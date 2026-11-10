// Uniswap V3 Pool Lookup
// Imports the factory ABI from @uniswap/v3-core and looks up a pool address
// Entry arguments are raw words; both JS and TS check the address range before calling.
import { IUniswapV3Factory } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";

function main(factoryAddress, token0, token1) {
  if (factoryAddress > 0xffffffffffffffffffffffffffffffffffffffffn) revert();
  if (token0 > 0xffffffffffffffffffffffffffffffffffffffffn) revert();
  if (token1 > 0xffffffffffffffffffffffffffffffffffffffffn) revert();
  const factory = IUniswapV3Factory.at(factoryAddress);
  return factory.getPool(token0, token1, 3000);
}
