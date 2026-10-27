# Sign with your wallet's MCP server

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Wallets and signing](cli-wallets.md)

> Sauce builds a transaction, and a wallet signs it. The safest wallet to sign with is one that
> keeps its key to itself, the way a bank keeps your card's PIN: your agent asks, the wallet checks,
> and the key never leaves it. Coinbase and Phantom each run an MCP server that lets a coding agent
> ask their wallet to sign. Add one next to Sauce's, and your agent hands each transaction Sauce
> builds straight to it, with nothing to convert.

This page is for you once your agent has Sauce's [MCP server](mcp.md) and can simulate a program
([Your first agent session](agent-quick-start.md)). A run on a real chain costs real funds: the
gas, the Kitchen's fee and whatever the program spends. Two words come up throughout. Your
**Pot** is the account that runs your programs, and its **owner** is the wallet that controls it:
here, the wallet that signs ([glossary](../concepts/glossary.md)).

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

VS Code takes the same address as `{ "type": "http", "url": … }` under `servers`, and Gemini CLI as
`{ "httpUrl": … }` under `mcpServers`.

**Phantom MCP**, a server on your computer:

```sh
claude mcp add phantom -- npx -y @phantom/mcp-server@latest   # Claude Code
```

```json
{ "mcpServers": { "phantom": { "command": "npx", "args": ["-y", "@phantom/mcp-server@latest"] } } }
```

Any other agent takes that same command, the way [The MCP server](mcp.md#add-the-server-to-your-agent)
adds Sauce's. Phantom makes a new wallet for your agent when you sign in. Ask your agent for its
addresses, and send it what it will spend.

## What Sauce hands over

Every Sauce tool that builds a transaction (`sauce_tx`, `sauce_pot`, `sauce_actions`), and
`sauce tx` on the command line, returns its transactions the way these wallets take them:

- Each transaction is exactly what Phantom's `evm_send` takes. Amounts are written in hex, as
  wallets read them, and the labels Sauce adds, such as `what`, are left out by the wallet.
- `sendCalls` is everything to send, in order, exactly as Coinbase's `send_calls` takes it: a
  batch a smart wallet approves once and runs all together, or not at all.

```json
{
  "chainId": 8453,
  "pot": "0xDAbd…0417",
  "transactions": [
    {
      "what": "Kitchen.deployPot(…)",
      "chainId": 8453,
      "to": "0x…",
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
      { "to": "0x…", "value": "0x0", "data": "0x…" },
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

Check it worked: the request's status gives the transaction hash. Ask your agent for the explorer
link, or have it read the Pot back with `sauce_pot`, which shows what the Pot now holds.

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
   `done` ([A Solana cook of several transactions](#a-solana-cook-of-several-transactions)).

Check it worked: the signature opens in a Solana explorer, and `sauce_pot` with `chain` `solana`
shows what the Pot holds now.

A Solana transaction has to land within about a minute of being built. If approving takes longer,
ask your agent to build it again: `sauce_send` with the cursor alone, or the same tool as before.

## On Base or Ethereum, with Phantom

Your agent calls `evm_send` with each transaction as it is, in order, waiting for each to land
before the next. As on Solana, the first call previews, and `confirmed` set to `true` sends.

## With any other signer

A hardware wallet, or a key kept in a company vault (a KMS), signs too, with the key never near the
agent. The signer hands back signed bytes, and `sauce_send` sends them:

```text
sauce_tx   { source, chain: "base", owner: "0xYou", args: [...] }
  → { pot, transactions: [ { what: "Kitchen.deployPot(…)", to, data, value },
                           { what: "cook on Pot 0x8a…", to, data, value } ] }
           the signer signs both, nonces n and n + 1
sauce_send { transactions: ["0x02f8…", "0x02f8…"] }
  → { ok: true, sent: [ { what: "Kitchen.deployPot at 0x…", hash, status: "success", … },
                        { what: "cook on Pot 0x8a…", hash, status: "success", moves, leftInPot } ] }
```

[mcp-external-signer.ts](../examples/mcp-external-signer.ts) is that flow as code, for any MCP
client and any signer. `sauce_send` simulates each transaction as it was signed and refuses one
that would fail, sends them in order, and stops at the first that does not succeed
([`sauce_send`](mcp-tools.md#sauce_send) has the rest).

### Send them in the right order

- **A new Pot, then its cook.** While the Pot has no code, `sauce_tx` returns its deployment as the
  first entry of `transactions` (marked `deploysPot`), then the cook. Any account may send the
  first, only the owner the second. Each comes with `gas`, the limit to sign it with: the cook's is
  estimated as if the deployment had landed, with 30% room, because a signer's own estimate, taken
  while the Pot has no code, is far too low. Where the endpoint does not report the deployment's
  gas apart, the deployment carries none, and the signer estimates it right.
- **A cook that would revert** after the deployment (a Pot not funded yet) comes with no `gas`, and
  a note saying why: deploy the Pot first (`sauce_pot`'s deployment), fund it, and call `sauce_tx`
  again, or pass `fund` so the plan moves the tokens in after the deployment. Do not send tokens to
  the address before the Pot is deployed.
- `sauce_pot`'s deployment, by hand, can be sent from any account.
- On Solana, each transaction is signed by its `feePayer`, the owner the call named, and
  `sauce_tx`'s `transaction` goes to `sauce_send` with its `cursor`, which also reads back what
  `main` returned. Its blockhash expires in about a minute: one signed later is refused, to build
  and sign again.

## A cook someone else sends

A [signed cook](signed-cooks.md) splits the cook in two: the Pot's owner signs it as typed data,
and another account sends it and pays the gas. On Base or Ethereum:

```text
sauce_signed_cook { source, chain: "base", owner: "0xYou", args: [...] }
  → { pot, typedData, digest, nonce, deadline, maxExecutionFee, … }
           the owner's wallet signs typedData (eth_signTypedData_v4)
sauce_signed_cook { …the same inputs, nonce, deadline, maxExecutionFee, signature }
  → { …, signature, cook: { chainId, to, data, value } }
           any account sends cook, with exactly its value
```

Give the second call the `nonce`, `deadline` and `maxExecutionFee` the first returned, so it
checks the signature over the same cook. `cook` is an ordinary transaction for whichever wallet
sends it, `evm_send` included, and a signer's signed bytes go to `sauce_send`. While the Pot has no
code, `deployPot` comes first, for any account to send. On a local server with wallets,
`sauce_sign` signs with one of them, and `sauce_wallet_send` sends `cook` from any wallet
([What a local server keeps](mcp-local.md#signed-cooks)).

## A Solana cook of several transactions

Some Solana cooks need more than one transaction: a program too large for one, staged in a Kitchen
code buffer; accounts past one transaction's list, through a lookup table; a Pot or a token account
to create first. `sauce_tx` then returns a plan: the setup, the cook, then the code buffer's close.

1. `sauce_tx` returns the first step and a `cursor`.
2. The owner's signer signs each transaction of the step.
3. `sauce_send` with the signed transactions and the `cursor` sends them, and returns the next step
   as `next`, built fresh from what the cluster shows.
4. Repeat with `next.cursor` until `next` says `done`.

```text
sauce_tx   { source, chain: "solana", owner: "<pubkey>", accounts: {...}, args: [...] }
  → { step: "setup", plan: [setup next, cook later, close later],
      transactions: [ { what: "creating the code buffer", transaction: "AQAB…", feePayer },
                      { what: "writing bytes 0… of the program", … }, …,
                      { what: "creating the lookup table", … } ],
      cursor: "sauce-plan-1.…" }
             the owner's signer signs each, as it comes
sauce_send { transactions: [signed…], cursor }
  → { ok: true, sent: [ … ], next: { step: "cook", transactions: [ { what: "cook on Pot …", … } ], cursor } }
sauce_send { transactions: [signed cook], cursor: next.cursor }
  → { sent: [ { what: "cook on Pot …", status: "success", returned, tokenChanges, leftInPot } ],
      next: { step: "close", transactions: [ { what: "closing the code buffer", … } ], cursor } }
sauce_send { transactions: [signed close], cursor: next.cursor }
  → { sent: [ … ], next: { step: "done" } }
```

The owner signs and pays every transaction; none needs a fresh keypair, and the cursor carries no
key and no endpoint. On a server with wallets, `sauce_wallet_send` takes the `sauce_tx` result whole
and sends every step itself ([What a local server keeps](mcp-local.md)).

### When a step does not go through

- **The signer took too long.** Every transaction of a step is built on one blockhash, so a signer
  that takes longer than about a minute lets the rest expire. `sauce_send` refuses those, and its
  `next` is the same step built again with only what did not land. `sauce_send` with the cursor
  alone builds it too.
- **A long setup.** A setup of more than 32 transactions comes in several steps.
- **Nothing to sign yet.** A step says why in `wait`: a cook handed out that can still land, or a
  cook through a lookup table extended a moment ago, which is in use from the next slot, about half
  a second on. Nothing waits on the server: call `sauce_send` with the cursor alone again.
- **The cook would fail.** A cook its simulation says would fail is not built, so none is handed
  out to land and fail. `sauce_tx` returns an error result, and `sauce_send` a `next`, saying why in
  `fails` with the simulation's `logs`. Once what it needs is there (a funded Pot, an account it
  names), the cursor alone simulates it again and builds it.
- **Sent another way.** A cook handed out is never built again while it can still land, nor once
  the owner's transactions show it landed. Confirm one broadcast another way with `signatures`, so
  the plan knows how it went.
- **Giving up.** `close: true` gives up on the cook and closes the code buffer, once a cook handed
  out can no longer land.

### Close what a plan left open

A plan given up on can leave a code buffer open, and cooks keep lookup tables for the next one that
names the same accounts. Both hold rent. `sauce_reclaim` lists them, with the rent each holds, and
returns the transactions that close them, unsigned, for `sauce_send`:

- A buffer closes at once.
- A table is deactivated, then closed about 512 slots later: call again then (`closableFromSlot`
  says when). It serves cooks until then.
- Nothing in use is closed. A buffer or an active table a transaction named in the last 300 slots
  is listed with `inUse` and `freeFromSlot`, and left open, as a cook built for it may still land.
- `keep` takes the cursors of plans still under way, whose buffers and tables stay open (`kept`)
  however long their cooks wait.

## From the command line

`sauce tx` prints the same, so a script, or an agent with a shell, passes it on the same way. With
the [quick start's `pay.sauce.ts`](../examples/pay.sauce.ts):

```sh
sauce tx pay.sauce.ts --chain base --owner <your wallet's address> --args <recipient> 1000000
```

Have any signer sign the transactions, then `sauce send` sends them and tells you what they did
([Wallets and signing](cli-wallets.md#sign-somewhere-else-sauce-tx-and-sauce-send)).

## Next

- Wallets your agent keeps for experiments, under a policy: [What a local server keeps](mcp-local.md).
- Every tool and what it returns: [The MCP server's tools](mcp-tools.md).
- Why a cook runs on your Pot, and where its results end: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
