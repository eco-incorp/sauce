<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> ParaSwap is an exchange aggregator: it routes a swap across many exchanges. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Multi-chain DEX aggregator routing swaps across decentralized exchanges. Supports limit orders and the Delta algorithm.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Paraswap` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## What it offers

- **simpleSwap**: Execute a simple single-path swap via Augustus router

## Notes

- Augustus V6 is deployed on every chain the registry lists; Augustus V5's address holds the router everywhere but Base
- On Base, Augustus V5's address is not the router: it is a small fee-splitting contract that dispatches none of the router's functions. A call carrying no value reverts; a call carrying value, `simpleSwap` included, succeeds without swapping, and the value goes to two accounts the contract fixed when it was deployed (98.5% and 1.5%). Do not send it anything; on Base the router is Augustus V6
- Route computation happens off-chain via ParaSwap API - callees/exchangeData come from API
- Approve srcToken to Augustus contract before swapping

## Its names in a program

On Ethereum, `Paraswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's augustusV5, `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`.
  require(Paraswap.AugustusV5 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Ethereum](../chains/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Optimism](../chains/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Optimism](../chains/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [BNB Chain](../chains/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [BNB Chain](../chains/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Polygon](../chains/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Polygon](../chains/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Base](../chains/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `DEFAULT_ADMIN_ROLE`, `getAdapterData`, `getFeeWallet`, `getImplementation`, `getPartnerFeeStructure`, `getRoleAdmin`, `getRoleMember`, `getRoleMemberCount`, `getRouterData`, `getTokenTransferProxy`, `getVersion`, `grantRole`, `hasRole`, `initialize`, `initializeAdapter`, `initializeRouter`, `isAdapterInitialized`, `isRouterInitialized`, `registerPartner`, `renounceRole`, `revokeRole`, `ROUTER_ROLE`, `setFeeWallet`, `setImplementation`, `simpleBuy`, `simpleSwap`, `transferTokens`, `WHITELISTED_ROLE` |
| [Base](../chains/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Arbitrum One](../chains/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Arbitrum One](../chains/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Avalanche C-Chain](../chains/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Avalanche C-Chain](../chains/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |

## ABI

### `AugustusV5ABI`

`import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";` Speaks for: augustusV5. The import is the contract's full ABI across every deployment; call it through the `Paraswap` namespace to have a function a chain's deployment does not run refused.

- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `getAdapterData(bytes32 key) view returns (bytes)`
- `getFeeWallet() view returns (address)`
- `getImplementation(bytes4 selector) view returns (address)`
- `getPartnerFeeStructure(address partner) view returns ((uint256 partnerShare, bool noPositiveSlippage, bool positiveSlippageToUser, uint16 feePercent, string partnerId, bytes data))`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `getRouterData(bytes32 key) view returns (bytes)`
- `getTokenTransferProxy() view returns (address)`
- `getVersion() pure returns (string)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize(bytes)`
- `initializeAdapter(address adapter, bytes data)`
- `initializeRouter(address router, bytes data)`
- `isAdapterInitialized(bytes32 key) view returns (bool)`
- `isRouterInitialized(bytes32 key) view returns (bool)`
- `registerPartner(address partner, uint256 _partnerShare, bool _noPositiveSlippage, bool _positiveSlippageToUser, uint16 _feePercent, string partnerId, bytes _data)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `ROUTER_ROLE() view returns (bytes32)`
- `setFeeWallet(address _feeWallet)`
- `setImplementation(bytes4 selector, address implementation)`
- `simpleBuy((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable`
- `simpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`
- `transferTokens(address token, address destination, uint256 amount)`
- `WHITELISTED_ROLE() view returns (bytes32)`

Not on Base's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `DEFAULT_ADMIN_ROLE`, `getAdapterData`, `getFeeWallet`, `getImplementation`, `getPartnerFeeStructure`, `getRoleAdmin`, `getRoleMember`, `getRoleMemberCount`, `getRouterData`, `getTokenTransferProxy`, `getVersion`, `grantRole`, `hasRole`, `initialize`, `initializeAdapter`, `initializeRouter`, `isAdapterInitialized`, `isRouterInitialized`, `registerPartner`, `renounceRole`, `revokeRole`, `ROUTER_ROLE`, `setFeeWallet`, `setImplementation`, `simpleBuy`, `simpleSwap`, `transferTokens`, `WHITELISTED_ROLE`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `augustusRFQ` taking `()`: no captured deployment dispatches it.
- `feeClaimer` taking `()`: no captured deployment dispatches it.
- `getKey` taking `()`: no captured deployment dispatches it.
- `maxFeePercent` taking `()`: no captured deployment dispatches it.
- `paraswapReferralShare` taking `()`: no captured deployment dispatches it.
- `paraswapSlippageShare` taking `()`: no captured deployment dispatches it.
- `partnerSharePercent` taking `()`: no captured deployment dispatches it.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
