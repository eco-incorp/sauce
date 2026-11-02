<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Paraswap` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [paraswap.md](../paraswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Paraswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's augustusV5, `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`.
  require(Paraswap.AugustusV5 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Base](../../../sauce-chains/references/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `DEFAULT_ADMIN_ROLE`, `getAdapterData`, `getFeeWallet`, `getImplementation`, `getPartnerFeeStructure`, `getRoleAdmin`, `getRoleMember`, `getRoleMemberCount`, `getRouterData`, `getTokenTransferProxy`, `getVersion`, `grantRole`, `hasRole`, `initialize`, `initializeAdapter`, `initializeRouter`, `isAdapterInitialized`, `isRouterInitialized`, `registerPartner`, `renounceRole`, `revokeRole`, `ROUTER_ROLE`, `setFeeWallet`, `setImplementation`, `simpleBuy`, `simpleSwap`, `transferTokens`, `WHITELISTED_ROLE` |
| [Base](../../../sauce-chains/references/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |

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
