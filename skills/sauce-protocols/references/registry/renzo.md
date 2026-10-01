<!-- Generated from the SDK's registries. Do not edit. -->

# Renzo (`renzo`)

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Renzo` on ethereum |
| Chains | ethereum |
| Document | [renzo.md](../renzo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Renzo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ezETH, `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`.
  require(Renzo.EzETH != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |

## ABI

### `EzETHABI`

`import EzETHABI from "./protocols/renzo/EzETHABI.json";` Speaks for: ezETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `RestakeManagerABI`

`import RestakeManagerABI from "./protocols/renzo/RestakeManagerABI.json";` Speaks for: restakeManager.

- `deposit(address _collateralToken, uint256 _amount)`
- `depositETH() payable`
