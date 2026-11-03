<!-- Generated from the SDK's registries. Do not edit. -->

# Instadapp (`instadapp`)

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources for a flash loan.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Instadapp` on ethereum |
| Chains | ethereum |
| Document | [instadapp.md](../instadapp.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Instadapp` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's flashloanAggregator, `0xE6054aE0Dba269560061D736e7510Ce64fCD517d`.
  require(Instadapp.FlashloanAggregator != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `Instadapp.FlashloanAggregator` |

## ABI

### `FlashAggregatorABI`

`import FlashAggregatorABI from "./protocols/instadapp/FlashAggregatorABI.json";` Speaks for: flashloanAggregator. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Instadapp` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `aaveLending() view returns (address)`
- `aaveLendingAddr() view returns (address)`
- `addTokenToCToken(address[] _cTokens)`
- `balancerLending() view returns (address)`
- `balancerLendingAddr() view returns (address)`
- `calculateFeeBPS(uint256 _route) view returns (uint256 BPS_)`
- `cDaiToken() view returns (address)`
- `cEthToken() view returns (address)`
- `comptrollerAddr() view returns (address)`
- `daiBorrowAmount() view returns (uint256)`
- `daiToken() view returns (address)`
- `executeOperation(address[] _assets, uint256[] _amounts, uint256[] _premiums, address _initiator, bytes _data) returns (bool)`
- `flashLoan(address[] tokens, uint256[] amounts, uint256 route, bytes data, bytes extraData)`
- `getRoutes() pure returns (uint16[] routes)`
- `initialize(address[] _ctokens)`
- `InstaFeeBPS() view returns (uint256)`
- `instaList() view returns (address)`
- `makerLending() view returns (address)`
- `makerLendingAddr() view returns (address)`
- `onFlashLoan(address _initiator, address, uint256 _amount, uint256 _fee, bytes _data) returns (bytes32)`
- `receiveFlashLoan(address[], uint256[] _amounts, uint256[] _fees, bytes _data)`
- `tokenToCToken(address) view returns (address)`
- `transferFeeToTreasury(address[] _tokens)`
- `treasuryAddr() view returns (address)`
- `troller() view returns (address)`
- `wEth() view returns (address)`
- `wethBorrowAmountPercentage() view returns (uint256)`
- `wEthToken() view returns (address)`
