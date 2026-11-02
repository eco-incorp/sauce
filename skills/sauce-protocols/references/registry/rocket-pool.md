<!-- Generated from the SDK's registries. Do not edit. -->

# Rocket Pool (`rocket-pool`)

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a liquid staking token backed by node operators.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `RocketPool` on ethereum |
| Chains | ethereum |
| Document | [rocket-pool.md](../rocket-pool.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `RocketPool` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's rETH, `0xae78736Cd615f374D3085123A210448E74Fc6393`.
  require(RocketPool.RETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RocketPool.RETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketPool.RocketDepositPool` |

## ABI

### `RETHABI`

`import RETHABI from "./protocols/rocket-pool/RETHABI.json";` Speaks for: rETH.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 _rethAmount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `depositExcess() payable`
- `depositExcessCollateral()`
- `getCollateralRate() view returns (uint256)`
- `getEthValue(uint256 _rethAmount) view returns (uint256)`
- `getExchangeRate() view returns (uint256)`
- `getRethValue(uint256 _ethAmount) view returns (uint256)`
- `getTotalCollateral() view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `mint(uint256 _ethAmount, address _to)`
- `name() view returns (string)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address recipient, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `version() view returns (uint8)`

### `RocketDepositPoolABI`

`import RocketDepositPoolABI from "./protocols/rocket-pool/RocketDepositPoolABI.json";` Speaks for: rocketDepositPool.

- `assignDeposits()`
- `deposit() payable`
- `getBalance() view returns (uint256)`
- `getExcessBalance() view returns (uint256)`
- `getMaximumDepositAmount() view returns (uint256)`
- `getNodeBalance() view returns (uint256)`
- `getUserBalance() view returns (int256)`
- `maybeAssignDeposits() returns (bool)`
- `nodeCreditWithdrawal(uint256 _amount)`
- `nodeDeposit(uint256 _totalAmount) payable`
- `receiveVaultWithdrawalETH() payable`
- `recycleDissolvedDeposit() payable`
- `recycleExcessCollateral() payable`
- `recycleLiquidatedStake() payable`
- `version() view returns (uint8)`
- `withdrawExcessBalance(uint256 _amount)`
