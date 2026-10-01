<!-- Generated from the SDK's registries. Do not edit. -->

# Gamma Strategies (`gamma`)

Active concentrated liquidity management protocol. Manages Uniswap V3 and other DEX positions with automated rebalancing.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Gamma` on ethereum, polygon |
| Chains | ethereum, polygon |
| Document | [gamma.md](../gamma.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Gamma` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's uniProxy, `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599`.
  require(Gamma.UniProxyLegacy != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` | `Gamma.UniProxyLegacy` |
| [Polygon](../../../sauce-chains/references/polygon.md) | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6` | `Gamma.UniProxy` |

## ABI

### `HypervisorABI`

`import HypervisorABI from "./protocols/gamma/HypervisorABI.json";`

- `withdraw(uint256 shares, address to, address from, uint256[4] minAmounts) returns (uint256 amount0, uint256 amount1)`
- `balanceOf(address account) view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `getTotalAmounts() view returns (uint256 total0, uint256 total1)`

### `UniProxyABI`

`import UniProxyABI from "./protocols/gamma/UniProxyABI.json";` Speaks for: uniProxy.

- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos, uint256[4] minIn) returns (uint256 shares)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`

### `UniProxyLegacyABI`

`import UniProxyLegacyABI from "./protocols/gamma/UniProxyLegacyABI.json";` Speaks for: uniProxy.

- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos) returns (uint256 shares)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`
