<!-- Generated from the SDK's registries. Do not edit. -->

# Arrakis Finance (`arrakis`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Arrakis Finance is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions with rebalancing.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Arrakis` on ethereum |
| Chains | ethereum |

## What it offers

- **addLiquidity**: Add liquidity to an Arrakis vault via router (tuple params)
- **removeLiquidity**: Remove liquidity from vault via router (tuple params)

## Notes

- TVL: $50M+. Manages UniV3 concentrated liquidity positions automatically
- Both addLiquidity and removeLiquidity take struct/tuple params via the router
- Approve both token0 and token1 to the router before adding liquidity
- Vault shares represent proportional ownership of the managed position
- gauge param can be zero address if not staking in a gauge
- The vault itself does not report its underlying amounts; ArrakisV2Helper's `totalUnderlying(vault)` does

## Its names in a program

On Ethereum, `Arrakis` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9`.
  require(Arrakis.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` | `Arrakis.Factory` |
| [Ethereum](../chains/ethereum.md) | router | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` | `Arrakis.Router` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
