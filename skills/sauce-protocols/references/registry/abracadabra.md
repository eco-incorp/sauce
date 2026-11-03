<!-- Generated from the SDK's registries. Do not edit. -->

# Abracadabra (`abracadabra`)

Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Abracadabra` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [abracadabra.md](../abracadabra.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Abracadabra` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's degenBox, `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce`.
  require(Abracadabra.DegenBox != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` | `Abracadabra.DegenBox` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mim | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | `Abracadabra.Mim` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` | `Abracadabra.DegenBox` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | mim | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` | `Abracadabra.Mim` |

## ABI

### `CauldronABI`

`import CauldronABI from "./protocols/abracadabra/CauldronABI.json";`

- `accrue()`
- `accrueInfo() view returns (uint64 lastAccrued, uint128 feesEarned, uint64 INTEREST_PER_SECOND)`
- `addCollateral(address to, bool skim, uint256 share)`
- `bentoBox() view returns (address)`
- `blacklistedCallees(address) view returns (bool)`
- `borrow(address to, uint256 amount) returns (uint256 part, uint256 share)`
- `BORROW_OPENING_FEE() view returns (uint256)`
- `borrowLimit() view returns (uint128 total, uint128 borrowPartPerAddress)`
- `changeBorrowLimit(uint128 newBorrowLimit, uint128 perAddressPart)`
- `changeInterestRate(uint64 newInterestRate)`
- `collateral() view returns (address)`
- `COLLATERIZATION_RATE() view returns (uint256)`
- `cook(uint8[] actions, uint256[] values, bytes[] datas) payable returns (uint256 value1, uint256 value2)`
- `exchangeRate() view returns (uint256)`
- `feeTo() view returns (address)`
- `init(bytes data) payable`
- `isSolvent(address user) view returns (bool)`
- `liquidate(address[] users, uint256[] maxBorrowParts, address to, address swapper, bytes swapperData)`
- `LIQUIDATION_MULTIPLIER() view returns (uint256)`
- `magicInternetMoney() view returns (address)`
- `masterContract() view returns (address)`
- `oracle() view returns (address)`
- `oracleData() view returns (bytes)`
- `owner() view returns (address)`
- `reduceSupply(uint256 amount)`
- `removeCollateral(address to, uint256 share)`
- `repay(address to, bool skim, uint256 part) returns (uint256 amount)`
- `setBlacklistedCallee(address callee, bool blacklisted)`
- `setBorrowOpeningFee(uint256 _borrowOpeningFee)`
- `setCollateralizationRate(uint256 _collateralizationRate)`
- `setFeeTo(address newFeeTo)`
- `setLiquidationMultiplier(uint256 _liquidationMultiplier)`
- `totalBorrow() view returns (uint128 elastic, uint128 base)`
- `totalCollateralShare() view returns (uint256)`
- `transferOwnership(address newOwner)`
- `updateExchangeRate() returns (bool updated, uint256 rate)`
- `userBorrowPart(address user) view returns (uint256)`
- `userCollateralShare(address user) view returns (uint256)`
- `withdrawFees()`

Left out of this ABI, though its deployments declare them:

- `error ErrNotClone` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ErrOverflow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `DegenBoxABI`

`import DegenBoxABI from "./protocols/abracadabra/DegenBoxABI.json";` Speaks for: degenBox. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Abracadabra` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `balanceOf(address token, address user) view returns (uint256)`
- `batch(bytes[] calls, bool revertOnFail) payable returns (bool[] successes, bytes[] results)`
- `batchFlashLoan(address borrower, address[] receivers, address[] tokens, uint256[] amounts, bytes data)`
- `claimOwnership()`
- `deploy(address masterContract, bytes data, bool useCreate2) payable returns (address cloneAddress)`
- `deposit(address token, address from, address to, uint256 amount, uint256 share) payable returns (uint256 amountOut, uint256 shareOut)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `flashLoan(address borrower, address receiver, address token, uint256 amount, bytes data)`
- `harvest(address token, bool balance, uint256 maxChangeAmount)`
- `masterContractApproved(address, address) view returns (bool)`
- `masterContractOf(address) view returns (address)`
- `nonces(address) view returns (uint256)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `pendingStrategy(address) view returns (address)`
- `permitToken(address token, address from, address to, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `registerProtocol()`
- `setMasterContractApproval(address user, address masterContract, bool approved, uint8 v, bytes32 r, bytes32 s)`
- `setStrategy(address token, address newStrategy)`
- `setStrategyTargetPercentage(address token, uint64 targetPercentage_)`
- `strategy(address) view returns (address)`
- `strategyData(address) view returns (uint64 strategyStartDate, uint64 targetPercentage, uint128 balance)`
- `toAmount(address token, uint256 share, bool roundUp) view returns (uint256 amount)`
- `toShare(address token, uint256 amount, bool roundUp) view returns (uint256 share)`
- `totals(address) view returns (uint128 elastic, uint128 base)`
- `transfer(address token, address from, address to, uint256 share)`
- `transferMultiple(address token, address from, address[] tos, uint256[] shares)`
- `transferOwnership(address newOwner, bool direct, bool renounce)`
- `whitelistedMasterContracts(address) view returns (bool)`
- `whitelistMasterContract(address masterContract, bool approved)`
- `withdraw(address token, address from, address to, uint256 amount, uint256 share) returns (uint256 amountOut, uint256 shareOut)`
