// Uniswap V3 Pool Lookup
// Imports the factory ABI from @uniswap/v3-core and looks up a pool address
import { IUniswapV3Factory } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";

function main(factoryAddress, token0, token1) {
  const factory = IUniswapV3Factory.at(factoryAddress);
  return factory.getPool(token0, token1, 3000);
}
