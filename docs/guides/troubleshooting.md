# Troubleshooting

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Run a program](cli-run.md)

> When a command stops, it says why in one line, and often how to fix it. This page collects the
> messages you are most likely to meet while you learn, each with what causes it and what to do.
> Find your message by its first words.

This page is for anyone using the `sauce` command who hit an error. It assumes you have done the
[quick start](quick-start.md), so you know what a program, a Pot and a cook are. Where a term is
new, the [glossary](../concepts/glossary.md) explains it.

Every failure exits with a status other than 0: 2 for a mistyped command, 1 for everything else.
A message names the flag to pass where one would fix it. With `--json`, a simulation that reverts
leads its JSON with `reverted: true` and `error`.

## The program does not compile

### `` `recipient` is not a declared variable ``

```text
sauce compile: pay.sauce.ts does not compile for base
…
    ╰╴error: `recipient` is not a declared variable
…
hint: if recipient is a value you supply, make it a parameter of main (`recipient: Uint256`, or `Address`) and pass it with --args
```

**Cause.** The program reads a name that nothing declares: not a token, not a protocol, not a
local, not a parameter.

**Fix.** If it is an input, add it to `main`'s parameters with its type, and pass it with `--args`
in the order `main` declares it. If it is a token or a protocol, check its spelling with
`sauce globals --chain <chain>`, which lists every name a program on that chain can use.

### `X is not a registered token on base`

```text
hint: FOO is not a registered token on base (it has …): take its address as a parameter of main (`token: Address`, passed with --args) and write Token(token).transfer(…)
```

**Cause.** `FOO.transfer(…)` uses the token syntax, which takes only a symbol the chain's registry
records. A token can be registered on one chain and not another.

**Fix.** Do what the hint says: take the token's address as a `main` parameter and write
`Token(token).transfer(…)`. A hint ending `a token's symbol is case-sensitive` means the symbol
exists in another case: tokenized stocks keep their issuer's ticker, such as `TSLAx`.

### An argument is refused

```text
argument 1 (token: Address): '0x12' is not an address: 20 bytes of 0x-prefixed hex
```

**Cause.** Each `--args` value is checked against `main`'s parameter type before anything is sent.

**Fix.** Give the value the type wants, in `main`'s order. An array or a tuple is JSON:
`--args '[1, 2]'`. Put `--` before a value that starts with `--`.
[Programs and arguments](cli-programs.md) covers each type.

## The command refuses the chain

### `… is refused: it involves …, a preview chain`

```text
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. The sauce command and its MCP server build and send transactions only on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia and Solana Devnet. …
```

**Cause.** The command builds and sends transactions only on Ethereum, Base, Arc and Solana, and
the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia and Solana Devnet. Every
other chain is a preview chain, where it builds and sends none.

**Fix.** Compile, read and simulate there freely (simulate runs wherever the release is deployed), and send on a supported chain. To ask for the chain,
follow the two links the message prints: the first finds an existing request, the second opens a
new one. No flag lifts the refusal ([Supported and preview chains](cli.md#supported-and-preview-chains)).

### `the released engine … is not deployed on <chain>`

```text
sauce simulate: the released engine 0x0F50… is not deployed on gnosis: this SDK's cook cannot run there
```

**Cause.** The cook runs on the release's engine and Kitchen, and one of them is not deployed on
that chain, so there is nothing for the cook to run on. `the released Kitchen … is not deployed` is
the same for the Kitchen: `sign`, `send` and a Pot's deployment say it too. This is not the preview
label: a preview chain simulates wherever the release is deployed on it.

**Fix.** Simulate on a chain where the release is deployed. `compile`, `globals`, `price`, `pools`
and `pot` still work on this one.

### `nothing was sent — transaction … of … (…)`

```text
sauce send: nothing was sent — transaction 2 of 2 (cook on Pot 0x2eC7…): the cook goes to 0x2eC7…, which has no code on base: no Pot is there to run it, and the value it carries would stay at that address. Nothing was sent
```

**Cause.** Before it sends the first transaction of a batch, `sauce send` checks every cook and Pot
deployment in it against the chain, together, as a wallet's send and `sauce run` do for theirs. One
of them fails the check, so none of the batch is sent: the transaction named, and the reason after
it, are one of the refusals on this page.

**Fix.** Fix what the named transaction's reason says, then sign and send the batch again. A cook
on a Pot that an earlier transaction of the same batch deploys is fine: that deployment is checked
in its place, against where the Kitchen puts its Pot.

A transaction the chain already has is read back, not sent again. When it is a Pot deployment that
landed and left no Pot where the SDK expects one, the transaction after it is reported instead, and
nothing after it is sent:

```text
not sent — because transaction 1 of 2 (Kitchen.deployPot at 0x1984…) landed and left no Pot at 0x3c…, where this SDK expects one: the Kitchen 0x1984… on base puts the Pot of owner 0xYou and salt 0x00…00 at 0x8a…, but this SDK has it at 0x3c…: … Nothing after it was sent.
```

The reason after the colon is the Kitchen's, as in the next section. Fix that, and sign the
transactions after the deployment again.

### `Kitchen.deployPot reverts for the owner 0x0000000000000000000000000000000000000000`

```text
sauce pot: Kitchen.deployPot reverts for the owner 0x0000000000000000000000000000000000000000: a Pot with no owner is a Shared Pot, which Kitchen.deploySharedPot(salt) deploys. Nothing was simulated, built or sent.
```

**Cause.** The owner given (`--owner`, or a tool's `owner`) is the zero address. A private Pot needs
an owner: the Kitchen's `deployPot` reverts for that one, and no call puts a Pot where the SDK would
have it, so a transfer into that address would stay there. The command refuses it before it builds
anything, with or without an RPC endpoint.

**Fix.** Name the Pot's owner. A Pot with no owner is a Shared Pot, which anyone may cook on and
which `Kitchen.deploySharedPot(salt)` deploys: see
[Pots and cooks in code](../api/README.md#pots-and-cooks-in-code).

### `this SDK does not match the deployed Kitchen`

```text
sauce tx: the Kitchen 0x1984… on base puts the Pot of owner 0xYou and salt 0x00…00 at 0x8a…, but this SDK has it at 0x3c…: this SDK does not match the deployed Kitchen, and a cook it sends goes where the Kitchen puts no Pot. The Kitchen 0x1984… on base mints Pots under init-code hash 0x5d…, which no release this SDK knows records: the Kitchen is newer than this SDK. Upgrade @eco-incorp/sauce (sauce update). Under its release, compiler … (v12-evm …, kitchen-evm …), this SDK deploys the Pot of owner 0xYou and salt 0x00…00 at 0x3c…. Nothing was simulated, built or sent.
The Pot store /home/you/.sauce/pots holds 1 other Pot of 0xYou on base:
  0x7e…  private, salt 0x00…01: compiler … (v12-evm …, kitchen-evm …), @eco-incorp/sauce …
```

**Cause.** The Kitchen on the chain mints Pots of another release than your copy of the SDK pins,
and it derives Pot addresses differently. Before the command simulates, builds or sends a cook, a
Pot deployment or a signed cook on a Pot not deployed yet, it asks the Kitchen where it puts your
Pot (`predictPot`, or `predictSharedPot` for the deployment of a Shared Pot that `sauce send` is
given). A cook sent to the SDK's address would land on an address with no code: it
would succeed, run nothing, and leave its value at that address. The message says which release
the Kitchen mints, from its `potInitCodeHash()`. Where the command keeps the Pot store, it lists
your other Pots on the chain, each with its release.

**Fix.** When the Kitchen is newer than the SDK, upgrade the package (`sauce update`, or
`npm i @eco-incorp/sauce@latest` in a project), then run the command again. When the message names
an older release instead (`mints Pots of compiler …, which @eco-incorp/sauce … pair with`), the
chain's Kitchen has not been upgraded yet: use one of the SDK versions it names on that chain. A
listed Pot of your SDK's release still cooks: name it with `--pot <address>`.

### `… is a Pot of compiler …, which @eco-incorp/sauce … pair with`

**Cause.** The Pot you named was minted by another release. Its release is told from the chain:
its owner, salt and Kitchen are read off it, and its address is that Kitchen's under the release's
Pot init-code hash. Its engine runs only that release's compiler output, never this SDK's.

**Fix.** Cook on it with an SDK version the message names, or cook on a Pot of your SDK's release:
the message says where the SDK deploys the owner's Pot.

### `… has code, but no release this SDK knows minted a Pot there`

**Cause.** The contract at the Pot's address reports an owner, salt and Kitchen that no release the
SDK records derives this address from. It is a Pot of a release newer than the SDK, or not a Pot.
A contract that does not answer a Pot's `owner()`, `userSalt()` and `kitchen()` is refused as `…
has code, but is not a Pot`.

**Fix.** If the message says the Kitchen is newer than this SDK, upgrade the package. Otherwise
check the Pot you named with `--pot`, or the `--owner` and `--salt` that give it.

## The command cannot reach the chain

### `missing --rpc-url <url> (or --config <file>)`

```text
missing --rpc-url <url> (or --config <file>): the kava endpoint, which has no built-in public one
```

**Cause.** The command needs to read the chain, and has no endpoint for it. A few chains have no
built-in public endpoint.

**Fix.** Give your own: `--rpc-url <url>`, or a `--config <file>` that names the chain's id. Give
one of the two, not both.

### `--offline reads no chain, and this reads base`

**Cause.** `--offline` stops every network read, and this command needs one.

**Fix.** Drop `--offline`. A `sauce tx` built offline needs `--value <wei>`, the Kitchen's fee,
because it cannot read it: the message `missing --value <wei>` says so.

### `rpcUrls["8453"] is not a URL; replace the placeholder`

**Cause.** The config file still holds a `<…>` placeholder from `sauce.config.example.json`.

**Fix.** Put your endpoint's URL in place of the placeholder, or remove that chain's entry to use
the built-in endpoint.

### `the RPC endpoint serves chain 1, but base is 8453`

**Cause.** The endpoint is for another chain than `--chain` names.

**Fix.** Use the endpoint for the right chain, or put each chain's endpoint under its own id in a
`--config` file.

### `reading the chain id failed`, or a slow command

**Cause.** The endpoint did not answer. Built-in public endpoints can be slow or rate-limited; the
command moves to the next one, but all of a chain's may be busy.

**Fix.** Try again, or give your own endpoint ([Your own endpoints](cli.md#your-own-endpoints)).
A simulation through an endpoint without `eth_simulateV1` still works, but its report has no list
of what moved, and it says so.

## The wallet or password is refused

### `missing a signer`

```text
missing a signer: --wallet <name>, --keystore <path> (each with a password source, or a prompt) or --private-key <hex>
```

**Cause.** The command sends a transaction, and you named no key to sign it with.

**Fix.** Make a wallet with `sauce wallet new me`, and pass `--wallet me`
([Wallets and signing](cli-wallets.md)).

### `no wallet me in …`

```text
no wallet me in /Users/you/.sauce/wallets: `sauce wallet list` names them, and `sauce wallet new me` creates one
```

**Cause.** No wallet has that name in the wallet directory, or `--wallets` points elsewhere.

**Fix.** Run `sauce wallet list` to see the names, or `sauce wallet new <name>` to make it.

### `wallet me-solana is a Solana wallet`

**Cause.** A Solana wallet cannot sign on Ethereum or Base, and an Ethereum-style wallet cannot sign
on Solana.

**Fix.** Make or pick a wallet of the chain's kind: `sauce wallet new <name>` for Ethereum and Base,
with `--solana` for Solana.

### `the keystore password is wrong`

**Cause.** The password does not open the wallet or keystore.

**Fix.** Check the source you named. `--password-file` and `--password-command` drop one trailing
newline only, so a file with extra spaces or lines gives another password.

### Password source messages

| Message begins                                  | Cause                                              | Fix                                      |
| ----------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `give one password source, not …`               | Two of `--password-env`, `-file`, `-command` given | Keep one                                 |
| `--password-env NAME: the variable is not set`  | The variable is not in this process's environment  | Export it in the shell that runs `sauce` |
| `--password-env takes the NAME of …`            | The password itself was given instead of a name    | Pass the variable's name                 |
| `--password-file … can be read or written by …` | Others can read the file                           | `chmod 600` the file                     |
| `--password-command exited with status …`       | The command failed; its output is not shown        | Run the command yourself to see why      |
| `… gives a password of under 8 characters`      | A new wallet needs 8 characters at least           | Use a longer password                    |

### `nothing was sent: this run needs an approval`

```text
nothing was sent: this run needs an approval, and there is no terminal to ask on:
  deploy Pot 0x…
Pass --yes (-y) to approve them (and --password-file with a keystore).
```

**Cause.** The run must send something before its cook, such as your Pot's creation, and cannot
ask: there is no terminal (CI, a pipe), or `--json` was given.

**Fix.** Pass `--yes` to approve, with a password source that needs no prompt.

### `refused by the policy of wallet me`

**Cause.** The transaction would move more than the wallet's policy allows, or go somewhere it does
not name.

**Fix.** Send less, or change `<name>.policy.json` if the limit is wrong
([Put a spending limit on a wallet](cli-wallets.md#put-a-spending-limit-on-a-wallet)). A policy file
that others can write is refused too: `chmod 600` it.

## The cook reverts

### `The cook reverts: the program threw "not enough USDC"`

**Cause.** A `require` in your program failed: here, the Pot holds less USDC than the program
spends. In the quick start's program that is the check doing its job.

**Fix.** Put tokens in your Pot: once it is deployed, send them to its address (`sauce pot --chain
<chain> --wallet me` prints it; `--deploy` creates it first), or add `--fund USDC:<amount>` to pull
them from your wallet in the same cook, after the Pot's deployment
([Put tokens in your Pot](cli-run.md#put-tokens-in-your-pot)). To simulate before funding, pass
`--assume-balance USDC:<amount>`.

### `ERC20InsufficientBalance` or `STF`

**Cause.** A token transfer tried to move more than its sender holds, with no `require` of your own
ahead of it. `STF` is Uniswap's code for a token pull that failed.

**Fix.** The same as above: fund the Pot, or check the amount you pass. Amounts in `--args` are in
the token's smallest unit: 1000000 is 1 USDC.

### A pool's short code, such as `SPL`

**Cause.** A swap's price limit is on the wrong side of the pool's price, or past its bounds. The
message spells out the check.

**Fix.** Recompute the limit with `sauce price` or `sauce pools`, and simulate on the block they
read with `--block` ([Look things up](cli-lookup.md)).

### The wallet cannot pay the gas

**Cause.** A simulation gives the owner the cook's value and says so: `the owner holds … ETH: the
cook's value; it holds 0, and a real cook needs the value and gas`. A real run sends from your
wallet, which must hold the gas and the Kitchen's fee. The first run also pays for the Pot's
creation, a few hundred thousand gas, which its question estimates.

**Fix.** Send your wallet a little ETH on Base or Ethereum. [Costs](../concepts/costs.md) says what
each part costs.

## Solana

### The transaction is too large, or names too many accounts

```text
the cook names 300 accounts, more than one lookup table holds (256)
```

**Cause.** A Solana transaction holds at most 1,232 bytes. `sauce run` stages a large program
first and puts many accounts in a lookup table on its own, but a cook can still sign or call too
much: the message then says it is past Solana's 1232 even through a lookup table.

**Fix.** Make the cook smaller: fewer pools, fewer accounts, or two programs instead of one.
`sauce compile --json` reports the cook's size against the limit before you run it
([Solana](cli-solana.md)).

### The cook runs out of compute units

```text
The cook runs out of compute units with every pool's stop worked out three times, …: offer fewer pools, or a tighter priceLimit, and simulate again
```

**Cause.** A Solana transaction has a fixed compute budget, and the swaps in the cook need more.

**Fix.** Offer fewer pools, or a tighter price limit, and simulate again.

### `… below its rent-exempt minimum`, or the fee payer holds less than the fee

**Cause.** The owner pays rent for new accounts (the Pot, a token account, a code buffer) and the
Kitchen's fee, in SOL, and holds too little.

**Fix.** Send the owner's wallet more SOL. `sauce reclaim` returns the rent of buffers and lookup
tables an earlier run left open.

## Next

- Before you run with real funds, check each item on the [production checklist](production-checklist.md).
- Every flag of every command: [the command reference](../reference/cli.md).
- After an update, if something stopped working: [Upgrading](upgrading.md).
