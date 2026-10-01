<!-- Generated from the SDK's registries. Do not edit. -->

# Gamma Strategies (`gamma`)

Active concentrated liquidity management protocol. Manages Uniswap V3 and other DEX positions with automated rebalancing.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, polygon |
| Document | [gamma.md](../gamma.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's uniProxy):

```sauce chain=ethereum
import UniProxyLegacyABI from "./protocols/gamma/UniProxyLegacyABI.json";

const UNI_PROXY = 0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599n;

function main() {
  const bound = UniProxyLegacyABI.at(UNI_PROXY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` | `UniProxyLegacyABI.at(0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6` | `UniProxyABI.at(0xA42d55074869491D60Ac05490376B74cF19B00e6n)` |

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
