<!-- Generated from the SDK's registries. Do not edit. -->

# ether.fi (`etherfi`)

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH, or wrap it as weETH for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Etherfi` on ethereum |
| Chains | ethereum |
| Document | [etherfi.md](../etherfi.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Etherfi` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's eETH, `0x35fA164735182de50811E8e2E824cFb9B6118ac2`.
  require(Etherfi.EETH != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `Etherfi.EETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `Etherfi.LiquidityPool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `Etherfi.WeETH` |

## ABI

### `EETHABI`

`import EETHABI from "./protocols/etherfi/EETHABI.json";` Speaks for: eETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/etherfi/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `deposit() payable returns (uint256)`

### `WeETHABI`

`import WeETHABI from "./protocols/etherfi/WeETHABI.json";` Speaks for: weETH.

- `wrap(uint256 _eETHAmount) returns (uint256)`
- `unwrap(uint256 _weETHAmount) returns (uint256)`
- `getEETHByWeETH(uint256 _weETHAmount) view returns (uint256)`
- `getWeETHByeETH(uint256 _eETHAmount) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
