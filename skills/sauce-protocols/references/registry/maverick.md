<!-- Generated from the SDK's registries. Do not edit. -->

# Maverick (`maverick`)

Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, base, arbitrum |
| Document | [maverick.md](../maverick.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's v2Factory):

```sauce chain=ethereum
import MaverickV2FactoryABI from "./protocols/maverick/MaverickV2FactoryABI.json";

const V2_FACTORY = 0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1en;

function main() {
  const bound = MaverickV2FactoryABI.at(V2_FACTORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `MaverickV2FactoryABI.at(0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1en)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | v2Router | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` | `MaverickV2RouterABI.at(0x62e31802c6145A2D5E842EeD8efe01fC224422fAn)` |
| [Base](../../../sauce-chains/references/base.md) | v2Router | `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527` | `MaverickV2RouterABI.at(0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Router | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` | `MaverickV2RouterABI.at(0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76n)` |

## ABI

### `MaverickV2FactoryABI`

`import MaverickV2FactoryABI from "./protocols/maverick/MaverickV2FactoryABI.json";` Speaks for: v2Factory.

- `lookup(address tokenA, address tokenB, uint256 startIndex, uint256 endIndex) view returns (address[] pools)`

### `MaverickV2RouterABI`

`import MaverickV2RouterABI from "./protocols/maverick/MaverickV2RouterABI.json";` Speaks for: v2Router.

- `exactInputSingle(address recipient, address pool, bool tokenAIn, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)`
- `exactOutputSingle(address recipient, address pool, bool tokenAIn, uint256 amountOut, uint256 amountInMaximum) payable returns (uint256 amountIn, uint256 amountOut)`
