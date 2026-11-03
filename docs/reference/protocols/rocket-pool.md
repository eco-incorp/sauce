<!-- Generated from the SDK's registries. Do not edit. -->

# Rocket Pool (`rocket-pool`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Rocket Pool is a liquid staking protocol: stake a chain's coin and get back a token you can still
> use. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a non-rebasing liquid staking token backed by a decentralized network of permissionless node operators.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `RocketPool` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Stake ETH and receive rETH
- **burn**: Burn rETH to redeem ETH (subject to pool liquidity)

## Notes

- TVL: $3B+. LST with permissionless node operators
- rETH is non-rebasing: value increases over time relative to ETH
- deposit() is payable - send ETH as msg.value, no parameters needed
- burn() may fail if insufficient liquidity in the deposit pool
- Exchange rate only goes up (barring slashing events)

## Its names in a program

On Ethereum, `RocketPool` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's rETH, `0xae78736Cd615f374D3085123A210448E74Fc6393`.
  require(RocketPool.RETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RocketPool.RETH` |
| [Ethereum](../chains/ethereum.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketPool.RocketDepositPool` |

## ABI

### `RETHABI`

`import RETHABI from "./protocols/rocket-pool/RETHABI.json";` Speaks for: rETH. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `RocketPool` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

`import RocketDepositPoolABI from "./protocols/rocket-pool/RocketDepositPoolABI.json";` Speaks for: rocketDepositPool. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `RocketPool` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
