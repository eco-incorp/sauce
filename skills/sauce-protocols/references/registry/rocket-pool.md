<!-- Generated from the SDK's registries. Do not edit. -->

# Rocket Pool (`rocket-pool`)

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a liquid staking token backed by node operators.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [rocket-pool.md](../rocket-pool.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's rETH):

```sauce chain=ethereum
import RETHABI from "./protocols/rocket-pool/RETHABI.json";

const R_ETH = 0xae78736Cd615f374D3085123A210448E74Fc6393n;

function main() {
  const bound = RETHABI.at(R_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RETHABI.at(0xae78736Cd615f374D3085123A210448E74Fc6393n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketDepositPoolABI.at(0xDD3f50F8A6CafbE9b31a427582963f465E745AF8n)` |

## ABI

### `RETHABI`

`import RETHABI from "./protocols/rocket-pool/RETHABI.json";` Speaks for: rETH.

- `getExchangeRate() view returns (uint256)`
- `getRethValue(uint256 _ethAmount) view returns (uint256)`
- `getEthValue(uint256 _rethAmount) view returns (uint256)`
- `burn(uint256 _rethAmount)`
- `balanceOf(address account) view returns (uint256)`

### `RocketDepositPoolABI`

`import RocketDepositPoolABI from "./protocols/rocket-pool/RocketDepositPoolABI.json";` Speaks for: rocketDepositPool.

- `deposit() payable`
