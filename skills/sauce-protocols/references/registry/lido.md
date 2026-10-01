<!-- Generated from the SDK's registries. Do not edit. -->

# Lido (`lido`)

The largest liquid staking protocol for Ethereum. Stake ETH and receive stETH, a liquid staking token that accrues staking rewards.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arbitrum |
| Document | [lido.md](../lido.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's stETH):

```sauce chain=ethereum
import LidoABI from "./protocols/lido/LidoABI.json";

const ST_ETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84n;

function main() {
  const bound = LidoABI.at(ST_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `LidoABI.at(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `WstETHABI.at(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `WstETHABI.at(0x5979D7b546E38E414F7E9822514be443A4800529n)` |

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
