<!-- Generated from the SDK's registries. Do not edit. -->

# Renzo (`renzo`)

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [renzo.md](../renzo.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's ezETH):

```sauce chain=ethereum
import EzETHABI from "./protocols/renzo/EzETHABI.json";

const EZ_ETH = 0xbf5495Efe5DB9ce00f80364C8B423567e58d2110n;

function main() {
  const bound = EzETHABI.at(EZ_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `EzETHABI.at(0xbf5495Efe5DB9ce00f80364C8B423567e58d2110n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `RestakeManagerABI.at(0x74a09653A083691711cF8215a6ab074BB4e99ef5n)` |

## ABI

### `EzETHABI`

`import EzETHABI from "./protocols/renzo/EzETHABI.json";` Speaks for: ezETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `RestakeManagerABI`

`import RestakeManagerABI from "./protocols/renzo/RestakeManagerABI.json";` Speaks for: restakeManager.

- `deposit(address _collateralToken, uint256 _amount)`
- `depositETH() payable`
