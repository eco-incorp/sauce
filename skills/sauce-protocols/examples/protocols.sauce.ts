// The two ways a program reaches a protocol.
// 1. A registry namespace (AaveV3.Pool): address and ABI come from the registry for the chain.
// 2. Any other catalogued protocol: import its ABI from ./protocols/<slug>/<Export>.json and bind
//    it to the address the protocol's registry `deployments` record for the chain, passed as a
//    define. The default 0 leaves it out where the protocol is not deployed.
//
//   sauce run protocols.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --define PANCAKE_V3_FACTORY=<pancakeswap-v3 factory> --args <beneficiary> <amount>
import IPancakeV3Factory from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";

const PANCAKE_V3_FACTORY = 0n; // pancakeswap-v3 `deployments`, role `factory`

function main(beneficiary: Address, amount: Uint256) {
  // 1. Supply `amount` of the Pot's USDC to Aave V3 for `beneficiary`, approving exactly that.
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0n);

  // 2. Look a pool up through a factory the namespaces do not cover.
  if (PANCAKE_V3_FACTORY != 0n) {
    const pool = IPancakeV3Factory.at(PANCAKE_V3_FACTORY).getPool(WETH, USDC, 500n);
    require(pool != 0n, "no PancakeSwap V3 WETH/USDC 0.05% pool");
  }
}
