<!-- Generated from the SDK's registries. Do not edit. -->

# Lido (`lido`)

The largest liquid staking protocol for Ethereum. Stake ETH and receive stETH, a rebasing liquid staking token. wstETH is the non-rebasing wrapped version for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Lido` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Key Operations

- **submit**: Stake ETH and receive stETH (rebasing)
- **wrap**: Wrap stETH into wstETH (non-rebasing, DeFi-compatible)
- **unwrap**: Unwrap wstETH back to stETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Stake ETH for stETH
import { LidoABI as ILido } from "./abis";
function main(lidoAddress: Address): Uint256 {
  const lido = ILido.at(lidoAddress);
  return lido.submit(0x0000000000000000000000000000000000000000);
}

// Wrap stETH to wstETH
import { WstETHABI as IWstETH } from "./abis";
function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.wrap(amount);
}

// Unwrap wstETH to stETH
import { WstETHABI as IWstETH } from "./abis";
function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.unwrap(amount);
}
```

## Notes

- TVL: $27.5B+. Largest DeFi protocol by TVL
- stETH rebases daily (balance increases). wstETH does not rebase (exchange rate increases instead)
- Always use wstETH for DeFi integrations (Aave, Uniswap, etc.) since rebasing tokens cause issues
- submit() requires ETH sent as msg.value. The referral parameter can be zero address
- Approve stETH to wstETH contract before calling wrap()

## Its names in a program

On Ethereum, `Lido` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's stETH, `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`.
  require(Lido.StETH != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Ethereum](../chains/ethereum.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [Arbitrum One](../chains/arbitrum.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `Lido.WstETH` |

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
