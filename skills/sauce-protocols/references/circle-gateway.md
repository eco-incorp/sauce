# Circle Gateway

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another chain through the GatewayMinter with a Circle-signed attestation.

## In a Sauce program

Deposit the Pot's USDC into Gateway for `depositor`, the user's own address:

```sauce chain=arc,arc-testnet,base,base-sepolia,ethereum,sepolia
function main(amount: Uint256, depositor: Address): Uint256 {
  // USDC in its 6-decimal base units, on Arc too: 5000000 is 5 USDC.
  require(pot.USDC >= amount, "amount is not in the Pot");
  const before = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  USDC.approve(CircleGateway.GatewayWallet, amount);
  CircleGateway.GatewayWallet.depositFor(USDC, depositor, amount);
  const total = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  require(total - before == amount, "the Gateway balance did not rise by the deposit");
  return total;
}
```

- **Whose balance it credits.** `depositFor(token, depositor, value)` credits `depositor`.
  `deposit(token, value)` credits the caller, which in a Sauce program is the Pot: the Gateway
  balance is then the Pot's, not the user's. A balance credited to the Pot can be spent only by a
  burn intent signed by a delegate the Pot adds for itself with the GatewayWallet's `addDelegate`,
  which the registry's ABI does not declare. To let the user spend it through Gateway from their
  wallet, deposit for their address.
- **Approve exactly the amount** for `CircleGateway.GatewayWallet` first, and deposit exactly what
  the Pot means to: a given `amount`, or the USDC a swap just delivered measured as a delta. On Arc
  never deposit `pot.USDC` whole, because the same balance is the Pot's native coin, from which
  any native fee the program pays comes.
- **Read it back.** `totalBalance(USDC, depositor)` and `availableBalance(USDC, depositor)` both
  rise by the deposit in the same transaction.
- **Where the program ends.** The deposit is the on-chain step. Spending the balance on another
  chain is off-chain first: a burn intent signed for the depositor goes to Circle's Gateway API,
  which returns an attestation, and `CircleGateway.GatewayMinter.gatewayMint(attestationPayload,
signature)` on the destination is a transaction of its own.
- `isTokenSupported(USDC)` says whether the chain's Gateway takes USDC.

## Category

cross-chain | Chains and addresses: [registry/circle-gateway.md](registry/circle-gateway.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### deposit

Deposit a supported token (USDC) into the caller's Gateway balance: from a Pot, the Pot's. For the
user's own balance, a program for `sauce compile` calls `depositFor` (In a Sauce program, above).

```typescript
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, amount: Uint256): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  wallet.deposit(token, amount);
  return 1;
}
```

- `token`: must satisfy `isTokenSupported(token)`: the chain's native (Circle-issued) USDC, which on Arc is USDC's ERC-20 interface `0x3600000000000000000000000000000000000000`
- `amount`: token units (6 decimals for USDC), never Arc's 18-decimal native units
- The depositor must first `approve` the GatewayWallet for `amount`

### availableBalance

Read the balance a depositor can spend through Gateway.

```typescript
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, depositor: Address): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  return wallet.availableBalance(token, depositor);
}
```

### gatewayMint

Mint on the destination chain from an attestation Circle's Gateway API returned.

```typescript
import { GatewayMinterABI as IGatewayMinter } from "./abis";

function main(minterAddress: Address, attestationPayload: bytes, signature: bytes): Uint256 {
  const minter = IGatewayMinter.at(minterAddress);
  minter.gatewayMint(attestationPayload, signature);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/circle-gateway.md](registry/circle-gateway.md).

## Notes

- Gateway uses Circle domain ids, the same ids as CCTP (Arc is 26), not EVM chain ids
- Spending a Gateway balance on another chain is off-chain first: sign a burn intent, submit it to Circle's Gateway API, then call `gatewayMint` with the returned attestation
- Both contracts are upgradeable (EIP-1967) proxies. Arc's Minter runs a different, smaller implementation from the other chains' that dispatches the same functions
- Circle also runs Gateway on HyperEVM (domain 19) and World Chain (14), which are not SDK chains. It has no Solana mainnet deployment
- On a testnet (Arc Testnet, Base Sepolia, Ethereum Sepolia) the Wallet and Minter are Circle's
  testnet pair, not the mainnet addresses; `CircleGateway.GatewayWallet` and
  `CircleGateway.GatewayMinter` resolve to the chain's own. Their burn intents go to Circle's
  testnet Gateway API, `https://gateway-api-testnet.circle.com`
