<!-- Generated from the SDK's registries. Do not edit. -->

# Lido (`lido`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Lido is a liquid staking protocol: stake a chain's coin and get back a token you can still use.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Liquid staking protocol for Ethereum. Stake ETH and receive stETH, a rebasing liquid staking token. wstETH is the non-rebasing wrapped version for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Lido` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## What it offers

- **submit**: Stake ETH and receive stETH (rebasing)
- **wrap**: Wrap stETH into wstETH (non-rebasing, DeFi-compatible)
- **unwrap**: Unwrap wstETH back to stETH

## Notes

- TVL: $27.5B+
- stETH rebases daily (balance increases). wstETH does not rebase (exchange rate increases instead)
- Always use wstETH for DeFi integrations (Aave, Uniswap, etc.) since rebasing tokens cause issues
- submit() requires ETH sent as msg.value. The referral parameter can be zero address
- Approve stETH to wstETH contract before calling wrap()
- On Arbitrum, wstETH is the bridged token, `Lido.WstETHBridged` (`WstETHBridgedABI`): an ERC-20 (`balanceOf`, `transfer`, `approve`) with no `wrap`, `unwrap`, `getStETHByWstETH` or `getWstETHByStETH`, each of which reverts there. Wrap, unwrap and read the stETH rate on Ethereum, through `Lido.WstETH`

## Its names in a program

On Ethereum, `Lido` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's stETH, `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`.
  require(Lido.StETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Ethereum](../chains/ethereum.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [Arbitrum One](../chains/arbitrum.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `Lido.WstETHBridged` |

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

### `WstETHBridgedABI`

`import WstETHBridgedABI from "./protocols/lido/WstETHBridgedABI.json";` Speaks for: wstETH.

- `name() view returns (string)`
- `symbol() view returns (string)`
- `decimals() view returns (uint8)`
- `totalSupply() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `bridge() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
