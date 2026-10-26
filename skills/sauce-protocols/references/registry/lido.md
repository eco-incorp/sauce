<!-- Generated from the SDK's registries. Do not edit. -->

# Lido (`lido`)

Liquid staking protocol for Ethereum. Stake ETH and receive stETH, a liquid staking token that accrues staking rewards.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Lido` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [lido.md](../lido.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Lido` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's stETH, `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`.
  require(Lido.StETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `Lido.WstETH`; not on this deployment: `wrap`, `unwrap`, `getStETHByWstETH`, `getWstETHByStETH` |

## ABI

### `LidoABI`

`import LidoABI from "./protocols/lido/LidoABI.json";` Speaks for: stETH.

- `submit(address _referral) payable returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `WstETHABI`

`import WstETHABI from "./protocols/lido/WstETHABI.json";` Speaks for: wstETH.

- `wrap(uint256 _stETHAmount) returns (uint256)`
- `unwrap(uint256 _wstETHAmount) returns (uint256)`
- `getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)`
- `getWstETHByStETH(uint256 _stETHAmount) view returns (uint256)`

Not on Arbitrum One's wstETH (`0x5979D7b546E38E414F7E9822514be443A4800529`), whose code does not dispatch them: `wrap`, `unwrap`, `getStETHByWstETH`, `getWstETHByStETH`. A call to one reverts there.
