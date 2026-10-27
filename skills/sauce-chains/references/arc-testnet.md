<!-- Generated from the SDK's registries. Do not edit. -->

# Arc Testnet

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Arc Testnet a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Arc Testnet is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `arc-testnet` |
| Chain id | 5042002 |
| Kind | EVM |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `ArcTestnet` |
| Native coin | USDC (USDC), 18 decimals; also the ERC-20 `USDC` (6 decimals), one balance |
| Minimum base fee | 20 gwei: a transaction with a lower `maxFeePerGas` is never included |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## Notes

Arc Testnet is Arc's model exactly: USDC is the native coin at 18 decimals and the ERC-20
`0x3600000000000000000000000000000000000000` at 6, one balance, with the same minimum base fee.
Every note on the [Arc](arc.md) page holds here too. Its USDC and EURC come from Circle's
faucet.

## In a program

Compiled with `--chain arc-testnet`, a program names Arc Testnet's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=arc-testnet
function main() {
  // `EURC` is Arc Testnet's EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
  const held = EURC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(EURC).balanceOf(pot) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `EURC` | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 |
| `USDC` | `0x3600000000000000000000000000000000000000` | 6 |

## Protocols

The registry records no protocol deployment on this chain.
