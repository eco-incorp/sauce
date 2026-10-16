# Sign with your wallet's MCP server

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Wallets and signing](cli-wallets.md)

> Sauce builds a transaction, and a wallet signs it. The safest wallet to sign with is one that
> keeps its key to itself, the way a bank keeps your card's PIN: your agent asks, the wallet checks,
> and the key never leaves it. Coinbase and Phantom each run an MCP server that lets a coding agent
> ask their wallet to sign. Add one next to Sauce's, and your agent hands each transaction Sauce
> builds straight to it, with nothing to convert.

## Which wallet

|                   | Coinbase Wallet MCP                                       | Phantom MCP                                                     |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Chains            | Base, Ethereum                                            | Solana, Base, Ethereum                                          |
| Whose wallet      | yours: the Coinbase Wallet you sign in with               | a new one Phantom makes for your agent, kept in Phantom's vault |
| Who says yes      | you, in your wallet, once for each request                | Phantom's own checks; your agent shows you a preview first      |
| What it does well | several transactions in one approval, all of them or none | Solana, and an agent that sends without asking you each time    |

Sauce's own wallets, made with `sauce wallet` or by the local MCP server, are good for trying things
out with small amounts. They keep the key on your computer, unlocked by a password your agent holds,
and nobody approves each send. For real money, sign with one of these instead.

## Add the servers

Add them beside Sauce's server ([The MCP server](mcp.md) shows that one). Each opens your browser to
sign in the first time your agent uses it.

**Coinbase Wallet MCP**, a server on the web:

```sh
claude mcp add --transport http wallet-mcp https://wallet-mcp.coinbase.com   # Claude Code
codex mcp add wallet-mcp --url https://wallet-mcp.coinbase.com/              # OpenAI Codex
```

In an agent configured with JSON, such as Cursor:

```json
{ "mcpServers": { "wallet-mcp": { "url": "https://wallet-mcp.coinbase.com" } } }
```

**Phantom MCP**, a server on your computer:

```sh
claude mcp add phantom -- npx -y @phantom/mcp-server@latest   # Claude Code
```

```json
{ "mcpServers": { "phantom": { "command": "npx", "args": ["-y", "@phantom/mcp-server@latest"] } } }
```

Phantom makes a new wallet for your agent when you sign in. Ask your agent for its addresses, and
send it what it will spend.

## What Sauce hands over

Every Sauce tool that builds a transaction (`sauce_tx`, `sauce_pot`, `sauce_actions`,
`sauce_intent_publish` and the intent steps), and `sauce tx` on the command line, returns its
transactions the way these wallets take them:

- Each transaction is exactly what Phantom's `evm_send` takes. Amounts are written in hex, as
  wallets read them, and the labels Sauce adds, such as `what`, are left out by the wallet.
- `sendCalls` is everything to send, in order, exactly as Coinbase's `send_calls` takes it.

```json
{
  "chainId": 8453,
  "pot": "0xDAbd…0417",
  "transactions": [
    {
      "what": "Kitchen.deployPot(…)",
      "chainId": 8453,
      "to": "0x1984…506b",
      "data": "0x…",
      "value": "0x0",
      "gas": "0x3d090"
    },
    {
      "what": "cook on Pot 0xDAbd…0417",
      "chainId": 8453,
      "to": "0xDAbd…0417",
      "data": "0x…",
      "value": "0x4d2",
      "gas": "0x16378"
    }
  ],
  "sendCalls": {
    "chain": "base",
    "calls": [
      { "to": "0x1984…506b", "value": "0x0", "data": "0x…" },
      { "to": "0xDAbd…0417", "value": "0x4d2", "data": "0x…" }
    ]
  }
}
```

On Solana each `transaction` is already what Phantom's `solana_send` takes.

## On Base or Ethereum, with Coinbase

1. Your agent asks the wallet for your address.
2. It builds for that address, with your wallet as the owner: `sauce_tx` with `owner` set to it.
3. It simulates the same program (`sauce_simulate`) and shows you what will happen.
4. It calls `send_calls` with `sendCalls`. You get a link: open it, check, and approve in your
   wallet.
5. It asks `get_request_status` until the wallet says it landed.

Your Pot does not need to exist first. When it doesn't, the plan creates it and then runs your
program, and one approval does both. If the program fails, nothing happens at all: no half-made Pot
is left behind.

The program usually spends tokens, which have to be in the Pot when it runs. Ask for them with
`fund` (`--fund` on the command line), such as `fund: ["USDC:100"]`. The plan then moves them from
your wallet into the Pot, right before the program runs. Creating the Pot, filling it and running
the program are then one approval, and either all three happen or none does.

## On Solana, with Phantom

1. Your agent asks the wallet for its Solana address, and you send it what it will spend.
2. It builds with that address as the owner: `sauce_tx` with `chain` `solana`.
3. It calls `solana_send` with the `transaction` it got. That first call only previews: your agent
   shows you what will move.
4. When you agree, it calls `solana_send` again with `confirmed` set to `true`. Phantom signs, sends
   and returns the signature.
5. If the result had a `cursor`, the program needs more than one transaction. Your agent gives the
   cursor and the signatures to `sauce_send`, which returns the next step to send, until it says
   `done`.

A Solana transaction has to land within about a minute of being built. If approving takes longer,
ask your agent to build it again: `sauce_send` with the cursor alone, or the same tool as before.

Some steps of a cross-chain intent, such as a proof, come already signed by a second key that
Sauce made for an account the transaction creates. The result lists those keys in `signedBy`. Your
wallet must sign such a transaction exactly as it is. If a wallet rebuilds the transaction before
signing it, for example to give it a newer blockhash, that second signature stops matching, and
Solana refuses the transaction. If that happens, sign that one step with a key that signs as given,
and send it with `sauce_send`.

## On Base or Ethereum, with Phantom

Your agent calls `evm_send` with each transaction as it is, in order, waiting for each to land
before the next. As on Solana, the first call previews, and `confirmed` set to `true` sends.

## From the command line

`sauce tx` prints the same, so a script, or an agent with a shell, passes it on the same way:

```sh
sauce tx pay.sauce.ts --chain base --owner <your wallet's address> --args <recipient> 1000000
```

Any other signer works too: a hardware wallet, or a key kept in a company vault. Have it sign the
transactions, then `sauce send` sends them and tells you what they did
([Wallets and signing](cli-wallets.md#sign-somewhere-else-sauce-tx-and-sauce-send)).
