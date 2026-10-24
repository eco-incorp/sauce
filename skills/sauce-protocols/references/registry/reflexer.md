<!-- Generated from the SDK's registries. Do not edit. -->

# Reflexer (`reflexer`)

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Reflexer` on ethereum |
| Chains | ethereum |
| Document | [reflexer.md](../reflexer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Reflexer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's coinJoin, `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45`.
  require(Reflexer.CoinJoin != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `Reflexer.CoinJoin` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3A` | `Reflexer.ETHJoin` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | `Reflexer.Rai` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `Reflexer.SAFEEngine` |

## ABI

### `CoinJoinABI`

`import CoinJoinABI from "./protocols/reflexer/CoinJoinABI.json";` Speaks for: coinJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `ETHJoinABI`

`import ETHJoinABI from "./protocols/reflexer/ETHJoinABI.json";` Speaks for: ethJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `SAFEEngineABI`

`import SAFEEngineABI from "./protocols/reflexer/SAFEEngineABI.json";` Speaks for: safeEngine.

- `modifySAFECollateralization(bytes32 collateralType, address safe, address collateralSource, address debtDestination, int256 deltaCollateral, int256 deltaDebt)`
- `safes(bytes32 collateralType, address safe) view returns (uint256 lockedCollateral, uint256 generatedDebt)`
