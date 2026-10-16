# Run a program

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Programs and arguments](cli-programs.md)

> Running a program is like baking from a recipe. First you check the recipe makes sense
> (`sauce compile`). Then you try it in a play kitchen, where nothing real gets used up
> (`sauce simulate`). Then you bake for real (`sauce run`). Your **Pot** is your counter on the
> chain: it holds the ingredients, the tokens, that the program uses.

This page is the [quick start](quick-start.md) with everything explained: each step, how to read
what comes back, and how to get tokens into your Pot.

## The steps

```sh
# 1. The names a program on Base can use: tokens, protocol contracts, functions.
sauce globals --chain base

# 2. Check that the program compiles.
sauce compile pay.sauce.ts --chain base

# 3. Your Pot's address. It is known before the Pot exists, so you can send it tokens now.
sauce pot --chain base --wallet me

# 4. Try it: no password, no money, nothing sent.
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args <recipient> 1000000

# 5. Run it. The first time, it asks to create your Pot.
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

`pay.sauce.ts` is the quick start's program: it pays `<recipient>` 1 USDC from your Pot. `me` is a
wallet made with `sauce wallet new me` ([Wallets and signing](cli-wallets.md)). Every step works the
same with `--chain ethereum`, and on Solana with a few differences ([Solana](cli-solana.md)).

## Try it: `sauce simulate`

`sauce simulate` runs the program on a copy of the chain as it is right now. It signs nothing,
sends nothing and changes nothing. It needs no key, no Pot and no tokens:

- **Whose Pot.** `--wallet me` names the owner without a password, and so does `--owner <address>`.
  Any address works, even one you made up.
- **A Pot that does not exist yet** is created first, in the copy, as the real run will.
- **Tokens the Pot does not hold.** `--assume-balance USDC:5` gives the Pot 5 USDC, in the copy
  only. Repeat it for more tokens. `ETH:0.1` gives it ETH.
- **The fee.** An owner short of the Kitchen's fee is given it, in the copy, and told.

It prints what would happen:

```text
The cook succeeds from 0xYou: gas used 128999 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  1 USDC (it held 2 USDC before)
  Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
Simulated with eth_simulateV1 on the state of block 36120411; nothing was signed or sent:
  1. Kitchen.deployPot(0xYou, 0x00…00), gas used 160415: Pot 0x8a… is not deployed on base yet, so the simulation deploys it first, as sauce run does (asking, or with --yes) and sauce tx plans. Any account may send it; the Pot is the owner's either way.
  2. the cook, from the owner 0xYou, gas used 128999
Assumed for this simulation only, by state override:
  the Pot holds 2 USDC: --assume-balance (its balance word 0x1d39…: Solidity mapping at slot 9)
  the owner holds 0.00000374478538635 ETH: the cook's value; it holds 0, and a real cook needs the value and gas
What moved, in order:
  [1] wallet 0xYou -> Pot 0x8a…        0.00000374478538635 ETH  the cook's value
  [2] Pot          -> Kitchen 0x1984…  0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot          -> 0x66…            1 USDC
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
  0xYou (owner): -0.00000374478538635 ETH
  0x1984… (Kitchen): +0.00000374478538635 ETH
```

Read it top down:

1. **The headline**: the cook succeeds, with its gas, and what `main` returned. A program that
   declares a return type gets it decoded: `main returns Address: 0xd0b5…`.
2. **What stays in your Pot**, before and after. It is yours, but it is not in your wallet: only
   another program moves it out.
3. **What was simulated**: the Pot created first if it was missing, then the cook.
4. **What was assumed**: the balances you gave with `--assume-balance`.
5. **What moved**, in order, each party by its role: `wallet` (you), `Pot`, `Kitchen`, a registry
   name, a token's symbol.
6. **Net balance changes**: what each address ends up with, more or less.

When it fails, it says why and exits 1: `The cook reverts: the program threw "not enough USDC"`
for your own `require`, or a contract's error by name.

## Run it: `sauce run`

`sauce run` compiles the program, simulates it once more, signs it, sends it, and waits for it. Then
it prints the hash, the status and gas, the transaction's explorer page and its trace, what it cost,
and what moved:

```text
cook 0x5f…: success, gas used 184211, block 21004500
  explorer: https://basescan.org/tx/0x5f…
  trace (calls and balance changes, to open in a browser): https://app.blocksec.com/phalcon/explorer/tx/base/0x5f…
cost 0.000187 ETH: gas 184211 at 1000000 wei = 0.000184 ETH, L1 data 0.0000018 ETH, value 0.000001 ETH (the Kitchen's fee and any native the program spends)
What moved, in order:
  [1] Pot 0x8a… -> 0x66…  1 USDC
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
```

The explorer link opens the transaction on the chain's explorer. The trace link opens it on
BlockSec's Phalcon explorer, with every call and balance change.

Before it sends anything, it checks:

- **The Pot exists.** If not, it asks first, with what creating it costs:

  ```text
  Your Pot 0x8a… on base isn't deployed yet. Deploy it now (one transaction, about 274,512 gas, ~0.000082 ETH), then run? [deploy/cancel]
  ```

  `deploy` (or `y`) creates it in a transaction of its own, then cooks. Anything else sends
  nothing.

- **The cook would succeed.** A cook that would fail is never sent: the run stops with the reason
  and exits 1.

Each question can be answered ahead with `-y` (`--yes`), which says what it approved:
`auto-approved: deploy Pot 0x…`. With no terminal to ask on (in CI, or in a pipe), or with
`--json`, the run sends nothing until it is given `--yes`. It names what it needs approved and
stops.

## Put tokens in your Pot

A program spends what your Pot holds. There are two ways to get tokens there.

**Send them to the Pot's address**, from any wallet or exchange, like any other address.
`sauce pot --chain base --wallet me` prints the address. The Pot does not need to exist yet.

**Or let the run pull them in.** `--fund` moves tokens from your wallet into the Pot in the same
transaction as the cook:

```sh
sauce run pay.sauce.ts --chain base --wallet me --fund USDC:1.5 --sweep --args <recipient> 1000000
```

- `--fund USDC:1.5` pulls 1.5 USDC. Amounts are whole tokens. `USDC:1500000n`, with an `n`, is in
  the token's smallest units. Repeat it for more tokens. `ETH:0.01` sends ETH with the cook.
- `--sweep` sends back to you, at the end, whatever is left of each funded token.

The pull, the program and the sweep are one transaction: they succeed or fail together. The first
time you fund a token, Permit2, the standard contract the pull goes through, needs your approval for
that token. The run asks:

```text
Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) may move 0 of your USDC (base units), and this run needs 1500000. Approve Permit2 for USDC now? [y/N]
```

After that, each run needs only your signature, which the run makes for you.

## Where the results end up

What a program produces lands where it sends it. A swap with no other recipient, a lending
deposit's receipt tokens, a vault's shares: all stay in the Pot. They are yours, but your wallet
app will not show them, and only another program moves them out. So decide, for each result,
whether it should end in your wallet or stay in the Pot. To deliver it, send it to your wallet, or
name your wallet as the recipient of the call that produces it.

The command tells you, before and after. Both the simulation and the run lead with
`Left in the Pot, not in your wallet:` when the cook leaves anything there.
[Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md#where-a-programs-results-end) says more.

## More than one Pot

An owner has one Pot per **salt**, a label. The first one's is zero. Name another with
`--salt <label>`, and use the same salt in every command for that Pot:

```sh
sauce pot --chain base --wallet me --salt savings
sauce run pay.sauce.ts --chain base --wallet me --salt savings --args <recipient> 1000000
```

`--salt-hex 0x…` gives the exact 32 bytes instead (`--salt <label>` is `keccak256` of the label).

## The Pots you made: `sauce pot list`

Every Pot a command creates is recorded in `~/.sauce/pots`:

```sh
sauce pot list
sauce pot list --chain base --owner 0xYou --json
```

`sauce pot import` records a Pot this machine did not create, read from the chain:

```sh
sauce pot import --chain base --pot 0x…
sauce pot import --chain base --owner 0xYou --salt savings
sauce pot import --chain solana --owner <pubkey>
```

## Details

### More on `sauce simulate`

The owner is `--owner`, `--wallet`, or the owner's key: `--keystore` (or `--private-key`; on
Solana, `--keypair`) names it, and signs nothing but the pulls `--fund` simulates. A Pot that is not
deployed is named by `--owner` (and `--salt`): `--pot <address>` alone does not say whose it is.
Anyone may send a Pot's `Kitchen.deployPot(owner, salt)`, and the Pot is the owner's whoever sends
it, so the simulation sends it ahead of the cook.

`--assume-balance <TOKEN|address>:<amount>` takes the amount as `--fund` does. A token keeps
balances in its own storage (a proxy's, behind one), and the command finds the word with `eth_call`
and state overrides alone: Solidity mappings at slots 0–255, Vyper's at 0–31, OpenZeppelin's
namespaced ERC-20 and Solady's. Then it confirms it with `balanceOf`. A token whose balance is
computed rather than stored (rebasing, shares) is refused.

With `--fund`, a simulation given the owner's key includes the signed pulls, and before the cook,
in the same block, each approval or transfer `run` would send first. With no key, the pulls cannot
be signed, so the Pot is credited what they would bring: its balance plus each amount, or the
amount on top of an `--assume-balance` of the same token. `--sweep` still runs, and a shortfall in
your wallet is reported rather than refused. Each approval and transfer is listed as a transaction
of its own, with its gas (`transactions` in `--json`, with its `to` and `data`), for `run` to send
first. An endpoint without `eth_simulateV1` cannot run them ahead of the cook, and says so.

It simulates through `eth_simulateV1` where the endpoint serves it: one simulated block holding the
deployment and the cook, state carried from one to the next, with the cook's logs. Everything it
reads first (the Pot, the Kitchen's fee, the balances it assumes) and the simulation itself run on
one block: the latest when the command starts, or the one `--block <number | latest | safe |
finalized>` names. So a limit computed from a quote can be simulated on the state the quote saw. The
`Simulated with …` line, and `block` in `--json`, say which.

What moved is read from the cook's logs. ERC-20 `Transfer` and `Approval` logs are decoded with the
registry's symbols and whole units (a token the registry does not record is named by its own
`symbol()` and `decimals()`). Native transfers come from the node's `traceTransfers`. Wrapping and
unwrapping the wrapped native token count as moves. Every other log is counted, and listed in full
under `--json`, which gives the moves as `moves`, each with `fromRole` and `toRole`. A party is
named by its role, `mint` and `burn` for the zero address, with its short address the first time
and alone when nothing names it.

A program that opens an intent shows it too. The reward it pays into the intent's vault is a move
to `vault of intent 0x1234…`, noted as the intent's reward, and the Portal's announcement becomes
an entry under `Intents published:`: the intent's hash and its destination, how many calls its
route makes and what the solver delivers, and its reward, with when it becomes refundable and the
vault that holds it. `--json` lists them as `intents`.

An endpoint without `eth_simulateV1` falls back to `eth_call` with state overrides. A Pot that is
not deployed is then put in place as its deployment would leave it: an `eth_call` creation runs the
real `Kitchen.deployPot` and returns the Pot's code, and the cook runs from the owner against that
code, set at the Pot's address by override with its Router's storage word and a new contract's
nonce. That route reports the result and an estimated gas but no logs, so not what moved. The
`Simulated with …` line names the route taken, and why it fell back.

A revert prints `The cook reverts: <reason>` (or `Deploying the Pot reverts: …`) and exits 1: a
Pot, Kitchen, Router, Permit2 or Portal error by name, ERC-20's standard errors, `Error(string)`,
or `the program threw "…"` for a SauceScript `throw` or `require` message. A pool's short revert
string says what the check is: `"SPL" (a V3-style pool's price-limit check: the limit is on the
wrong side of the pool's current price, or at or past a bound …)`, and likewise `AS`, `LOK`,
`IIA`, `TF`, the token helpers' `STF`, `ST`, `SA`, `STE`, and a V2-style pair's `UniswapV2: K` (or
any fork's). A `main` argument named like a price limit (`sqrtPriceLimitX96`) at or past
`MIN_SQRT_RATIO` or `MAX_SQRT_RATIO` is named on stderr before the simulation, by `compile` and
`publish` too. `--expect-revert <text>` turns it round: it exits 0 only if the cook reverts with a
reason containing the text.

`--json` carries the same as fields: `block`, `path`, `fallback`, `deployPot`, `assumed`, `gas` and
`gasKind` (`used` or `estimated`), `returns`, `returnType` and `returned`, `transfers`,
`approvals`, `nativeTransfers`, `balanceChanges`, `otherLogs` and `leftInPot` (first after `ok`),
amounts as decimal strings in base units with `formatted` whole units beside them; or `stage` and
`reason` for a revert.

### More on `sauce run`

The cost is the gas at the price the receipt records, an OP-stack chain's L1 data fee where the
receipt carries one, and the value the cook carried. What moved is read from the receipt's logs by
the decoder `simulate` uses. A cook that leaves anything in the Pot says so first, after the cost,
under `Left in the Pot, not in your wallet:`, its balances read at the cook's block. `--json`
carries the cost and what moved under `cook.cost` and `cook.effects` (`moves` first), what stays in
the Pot as `leftInPot`, and `explorer` and `trace` beside each hash.

The value defaults to the Kitchen's execution fee, read from the chain. Pass `--value <wei>` when
the program also spends native coin. A `--value` below the fee is refused, since the cook would
revert.

The Pot's deployment and the cook stay two transactions, and the deployment goes through the same
signer, wallet policy and checks as the cook. `sauce pot --deploy` still deploys a Pot by hand. Every
transaction a run sends before its cook is asked about the same way: deploying a missing Pot,
approving Permit2 for a token `--fund` pulls, and approving the Pot for an amount under
`--fund-mode allowance`. `--auto-approve` does the same as `--yes`. On Solana a missing Pot is
created in the cook's own transaction, ahead of the cook and with nothing asked, when the two fit
in one; where they do not (a large program), it is asked about like the rest.

### More on `--fund`

`--fund <TOKEN|address>:<amount>` names a token the chain registers (`sauce globals --tokens`) or
any ERC-20 by address. The amount is in whole tokens, by the registry's decimals or the token's
own. A bare integer is whole tokens too: `USDC:1500000` is 1.5 million USDC, which the command
points out on stderr. `ETH:<amount>` (or `native:`) rides as the cook's value, on top of the
Kitchen's fee. Your balance of each token is checked before anything is sent.

The command wraps the program: a new `main`, with the same parameters, first pulls each amount from
you into the Pot, then calls the program's own `main` with the arguments as given, then, with
`--sweep`, sends the Pot's whole balance of each funded token (and of the native coin, when `ETH`
is funded) back to you. A script gets the pulls after its imports and the sweep after its last
statement. The pulls are `@sauce/token`'s, the same functions a program can call itself
([Pulling tokens in](protocols-and-tokens.md#pulling-tokens-in)).

`--fund-mode` chooses how the Pot is allowed to pull:

| Mode                | You sign or send                                               | What stands afterwards                        |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `permit2` (default) | A Permit2 signature for exactly this amount, to this Pot, once | Nothing for the Pot; your approval of Permit2 |
| `permit`            | The token's own EIP-2612 `permit` signature, for the Pot       | Nothing: the pull spends it                   |
| `allowance`         | An `approve` of the Pot for the amount, in a transaction first | The Pot's allowance, until a cook spends it   |
| `transfer`          | A plain `transfer` to the Pot, in a transaction first          | Nothing                                       |

`permit2` is the default because it works for every ERC-20, USDT included, where `permit` needs a
token that implements EIP-2612. It gives the Pot no allowance at all: each signature is for one
amount, to one spender, with a fresh nonce Permit2 spends and a deadline ten minutes out, so it
cannot be replayed or used late. And it is one transaction per run, the cook itself. Permit2 is the
canonical deployment the registry records (`sauce globals --protocols` lists it as
`Permit2.Permit2`).

Permit2's approval for a token is a standing one, as Permit2 is meant to have; each spend still
needs your signature. `y` sends the approval (reset to zero first when a smaller one stands, as
USDT requires) and then the cook; anything else sends nothing. `--fund-mode allowance` asks the
same about approving the Pot, and warns when it leaves an allowance standing. `permit` refuses a
token whose `DOMAIN_SEPARATOR()` does not match its name, version and address, before sending
anything.

Every pull is a `safeTransferFrom`. In `permit` and `allowance` modes the program pulls with
`@sauce/token`'s `transferFrom`, which has OpenZeppelin `SafeERC20` semantics: a token that returns
nothing (USDT) is accepted, and one that returns `false` reverts the whole run. In `permit2` mode
Permit2's `permitTransferFrom` moves the tokens with Solmate's `SafeTransferLib.safeTransferFrom`,
with the same outcome for both kinds of token. The `permit` call itself is checked as
OpenZeppelin's `safePermit` checks it: the token's nonce for you must move by exactly one.

Security notes:

- Signatures are made locally, by the signer you gave, over EIP-712 data the command prints nothing
  of; no key is ever printed. A Permit2 signature names the Pot as its spender, and only the Pot's
  owner can cook on the Pot, so nobody else can use it.
- A revert inside Permit2 is reported by name: `SignatureExpired(…)` for a passed deadline,
  `InvalidNonce()` for a nonce already spent.
- `allowance` mode's approval is its own transaction: if the cook then fails, the allowance stands
  until a later cook spends it or you change it. `transfer` mode's transfer is likewise sent before
  the cook, and the tokens stay in the Pot if the cook fails.

### More on `sauce pot`

`sauce pot` prints the Pot's address (CREATE2 from the Kitchen over the owner and salt) and the
unsigned `Kitchen.deployPot(owner, salt)` transaction as JSON. With a signer and no `--owner`, it is
the signer's own Pot. A keystore that records its address (most wallets write one) is read with no
password; one that does not is unlocked to learn it.

Without `--deploy`, it also reads the chain and adds what it found under `deployment`, and in a line
on stderr: whether the released engine and Kitchen are there, the Kitchen's execution fee, and
whether the Pot is deployed and whose it is.

With `--deploy` and a signer it sends the deployment, unless the Pot is already there, and waits
until the endpoint shows the Pot's code: a load-balanced endpoint can answer from a node that has
not seen the block yet. It refuses a chain with no Kitchen rather than send a `deployPot` to an
address without code, which would succeed and deploy nothing. Any account may deploy a Pot, and it
is its owner's either way. So `pot --deploy` takes `--owner` for another owner's Pot, which the
signer sends and pays for. That is how the Pot every intent to a chain cooks on, owned by that
chain's Portal Executor, is deployed. On Solana the owner signs `create_pot`, so there the signer
creates its own.

`run` and `publish` act for the signer, so the owner is the signer: `--owner` may only restate it,
and one that names someone else is refused. `simulate`, `tx` and plain `pot` have no signer and
take `--owner` (or, for `simulate` and `tx`, `--pot <address>`, of a deployed Pot).

`--format cast` prints the deployment as a `cast send` line instead, for
[Foundry](https://getfoundry.sh/cast/overview) users. It leaves the endpoint and the signer as
`<RPC_URL>` and `<PRIVATE_KEY>` placeholders: the command never fills in either.

### More on the Pot store

A Pot is recorded once the chain shows it deployed: by `pot --deploy`, by a `run` that deploys its
Pot before its first cook (or, on Solana, creates it in the cook's own transaction), by a
deployment signed elsewhere and broadcast with `sauce send`, and by a fill that deploys the Pot an
intent cooks on. The record comes from the chain: the Kitchen's `PotDeployed` event in a receipt
that succeeded, or its `create_pot` in a Solana transaction that succeeded. So a run whose cook
fails after its Pot deployed still records the Pot. `sauce tx` sends nothing, and records nothing.
`--pots <dir>` keeps the store somewhere else.

A record holds:

- the chain, on Solana with its cluster (told by its genesis hash: `mainnet-beta`, `devnet`,
  `testnet`, or the hash of any other), so a devnet Pot is never recorded as mainnet's;
- the Pot's address, its owner and salt, and its kind: `private`, `private-fixed-router` (minted
  with its Router fixed) or `shared` (no owner; anyone may cook it);
- the Kitchen and the release the Pot was minted under: on an EVM chain the Pot init-code hash its
  address derives from, the engine whose gate accepts it, and the compiler, engine and Kitchen
  versions of that release; on Solana the engine program its creation named;
- the transaction that deployed it (hash, block or slot, the block's hash on an EVM chain,
  sender), the version of `sauce` that recorded it, and when.

The release is told from the Pot's address, under every Kitchen and init-code hash this `sauce`
knows. A Pot minted before a Kitchen upgrade keeps the release that minted it. One file per Pot,
`<chain id>/<pot>.json` (a Solana cluster other than mainnet's after the id: `1399811149-devnet`),
readable only by you, is written once and never changed. A second deployment of the same address is
kept beside the first, as `<pot>@<tx>.json`, with a warning: one of them landed on a fork or
another network with the same chain id, or the Pot was closed and created again on Solana.
`sauce pot list` shows both. No key or endpoint is written there.

`sauce pot list` reads no chain: `sauce pot --chain <chain> --owner <owner>` says whether a Pot is
still there. `sauce pot import` gives an EVM Pot by address, its owner, salt and Kitchen read off
it and its kind and release told from its address; an address no known release mints is refused.
Or it gives a Pot by owner and salt: every known release's Pot of that owner and salt that has code
is recorded. A Solana Pot holds nothing that names its owner, so there it is found by owner and
salt only, its engine the program that owns the account, and an address no released engine owns is
refused. A Pot already recorded keeps its record.

The MCP server, run over stdio, keeps the same store in the same directory
([What a local server keeps](mcp-local.md)). Over HTTP the server keeps nothing.
