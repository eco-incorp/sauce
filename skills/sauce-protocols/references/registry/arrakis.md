<!-- Generated from the SDK's registries. Do not edit. -->

# Arrakis Finance (`arrakis`)

Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [arrakis.md](../arrakis.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's router):

```sauce chain=ethereum
import ArrakisRouterABI from "./protocols/arrakis/ArrakisRouterABI.json";

const ROUTER = 0x6aC8Bab8B775a03b8B72B2940251432442f61B94n;

function main() {
  const bound = ArrakisRouterABI.at(ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` | `ArrakisRouterABI.at(0x6aC8Bab8B775a03b8B72B2940251432442f61B94n)` |

## ABI

### `ArrakisRouterABI`

`import ArrakisRouterABI from "./protocols/arrakis/ArrakisRouterABI.json";` Speaks for: router.

- `addLiquidity((uint256 amount0Max, uint256 amount1Max, uint256 amount0Min, uint256 amount1Min, uint256 amountSharesMin, address vault, address receiver, address gauge) params) payable returns (uint256 amount0, uint256 amount1, uint256 sharesReceived)`
- `removeLiquidity((uint256 burnAmount, uint256 amount0Min, uint256 amount1Min, address vault, address receiver, address gauge, bool receiveETH) params) returns (uint256 amount0, uint256 amount1)`

### `ArrakisVaultABI`

`import ArrakisVaultABI from "./protocols/arrakis/ArrakisVaultABI.json";`

- `totalSupply() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `token0() view returns (address)`
- `token1() view returns (address)`
