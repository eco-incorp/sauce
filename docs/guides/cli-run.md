# Run a program

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Programs and arguments](cli-programs.md)

> Running a program is like baking from a recipe. First you check the recipe makes sense
> (`sauce compile`). Then you try it in a play kitchen, where nothing real gets used up
> (`sauce simulate`). Then you bake for real (`sauce run`). Your **Pot** is your counter on the
> chain: it holds the ingredients, the tokens, that the program uses.

This page is the [quick start](quick-start.md) with everything explained: each step, how to read
what comes back, how to get tokens into your Pot, and how to manage more than one Pot. It is for
someone who has the command installed and wants to run programs with confidence.

You will need:

- the `sauce` command, installed ([Install](cli.md#install));
- a wallet named `me`, made with `sauce wallet new me`. It asks for a password twice and prints
  the wallet's address ([Wallets and signing](cli-wallets.md) says more);
- `pay.sauce.ts`, the quick start's program, which pays a recipient USDC from your Pot.

Simulating needs no money. A real run needs a little ETH in your wallet for gas and the Kitchen's
fee, and the USDC the program pays, in your Pot. [Costs](../concepts/costs.md) explains each.

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

`--args` gives `main` its inputs in order: the recipient, then the amount in USDC's smallest unit
(1000000 is 1 USDC). Every step works the same with `--chain ethereum`, and on Solana with a few
differences ([Solana](cli-solana.md)).

## Try it: `sauce simulate`

`sauce simulate` runs the program on a copy of the chain as it is right now. It signs nothing,
sends nothing and changes nothing. It needs no key, no Pot and no tokens:

- **Whose Pot.** `--wallet me` names the owner without a password, and so does `--owner <address>`.
  Any address works, even one you made up.
- **A Pot that does not exist yet** is created first, in the copy, as the real run will.
- **Tokens the Pot does not hold.** `--assume-balance USDC:5` gives the Pot 5 USDC, in the copy
  only. Repeat it for more tokens. `ETH:0.1` gives it ETH.
- **The fee.** Every cook pays the **Kitchen**, the contract that makes Pots, a small flat fee in
  the chain's coin. An owner short of it is given it, in the copy, and told.

It prints what would happen:

```text
The cook succeeds from 0xYou: gas used 128999 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  4 USDC (it held 5 USDC before)
  Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
Simulated with eth_simulateV1 on the state of block 36120411; nothing was signed or sent:
  1. Kitchen.deployPot(0xYou, 0x00…00), gas used 160415: Pot 0x8a… is not deployed on base yet, so the simulation deploys it first, as sauce run does (asking, or with --yes) and sauce tx plans. Any account may send it; the Pot is the owner's either way.
  2. the cook, from the owner 0xYou, gas used 128999
Assumed for this simulation only, by state override:
  the Pot holds 5 USDC: --assume-balance (its balance word 0x1d39…: Solidity mapping at slot 9)
  the owner holds 0.00000374478538635 ETH: the cook's value; it holds 0, and a real cook needs the value and gas
What moved, in order:
  [1] wallet 0xYou -> Pot 0x8a…     0.00000374478538635 ETH  the cook's value
  [2] Pot          -> Kitchen 0x…   0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot          -> 0x66…         1 USDC
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
  0xYou (owner): -0.00000374478538635 ETH
  0x… (Kitchen): +0.00000374478538635 ETH
```

### Read what it prints

Read it top down:

1. **The headline**: the cook succeeds, with its gas, and what `main` returned. A program that
   declares a return type gets it decoded: `main returns Address: 0xd0b5…`.
2. **What stays in your Pot**, before and after. It is yours, but it is not in your wallet: only
   another program moves it out.
3. **What was simulated**: the Pot created first if it was missing, then the cook.
   `eth_simulateV1` is the node method that runs several transactions in one simulated block and
   returns their logs.
4. **What was assumed**: the balances you gave with `--assume-balance`.
5. **What moved**, in order, each party by its role: `wallet` (you), `Pot`, `Kitchen`, a registry
   name, a token's symbol, and `mint` or `burn` for the zero address.
6. **Net balance changes**: what each address ends up with, more or less.

What moved is read from the cook's logs: ERC-20 transfers and approvals, in whole units, and native
transfers the node traces. It counts tokens only: a position a protocol keeps in its own books, with
no token for it, shows in no balance.

### Simulate on the block a quote saw

Everything the simulation reads (the Pot, the Kitchen's fee, the balances it assumes) and the
simulation itself run on one block: the latest when the command starts, or the one `--block`
names (a number, `latest`, `safe` or `finalized`). So a price limit computed from
`sauce pools` at one block can be simulated on that same state. The `Simulated with …` line says
which block.

### Give the Pot tokens it does not hold

`--assume-balance <TOKEN|address>:<amount>` takes the amount in whole tokens, as `--fund` does. The
command finds where the token keeps balances by asking it, then confirms the result with
`balanceOf`. A token whose balance is computed rather than stored (rebasing tokens, shares) is
refused.

### Check that a guard fires

`--expect-revert <text>` turns the result round: the command exits 0 only if the cook reverts with
a reason containing the text. Use it to show that a `require` stops a run it should stop:

```sh
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:0.5 \
  --args <recipient> 1000000 --expect-revert "not enough USDC"
```

### When the simulation fails

A revert prints `The cook reverts: <reason>` (or `Deploying the Pot reverts: …`) and exits 1. The
reason is decoded where it can be:

- `the program threw "…"` for your own `require` or `throw` message;
- a Pot, Kitchen, Router or Permit2 error by name, and ERC-20's standard errors, such as
  `ERC20InsufficientBalance`;
- a pool's short revert string with what it checks, such as
  `"SPL" (a V3-style pool's price-limit check …)`, `STF` from a token transfer, or a V2-style
  pair's `UniswapV2: K`.

A `main` argument named like a price limit (`sqrtPriceLimitX96`) at or past the pool's bounds is
named on stderr before the simulation. [Troubleshooting](troubleshooting.md) lists the common
failures with their fixes.

### When the endpoint has no `eth_simulateV1`

Some endpoints do not offer `eth_simulateV1`. The command then falls back to `eth_call` with state
overrides: a Pot that is not deployed is put in place as its deployment would leave it, and the
cook runs against it. That route reports the result and an estimated gas, but no logs, so not what
moved. The `Simulated with …` line names the route taken and why it fell back. Give an endpoint of
your own ([Your own endpoints](cli.md#your-own-endpoints)) to get the full report.

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

### Read what it cost

The cost line adds up three things: the gas at the price the receipt records, an OP-stack chain's
L1 data fee where the receipt carries one (Base has one), and the value the cook carried. The value
is the Kitchen's fee plus any native coin the program spends.

### Let it create your Pot

Before it sends anything, the run checks that your Pot exists. If not, it asks first, with what
creating it costs:

```text
Your Pot 0x8a… on base isn't deployed yet. Deploy it now (one transaction, about 274,512 gas, ~0.000082 ETH), then run? [deploy/cancel]
```

The Pot's deployment is a transaction of its own, paid by your wallet. So the first run needs your
wallet to hold the deployment's gas, shown in the question, as well as the cook's gas and the
Kitchen's fee. The figures above are an estimate at the gas price of that moment.

`deploy` (or `y`) creates the Pot, then cooks. Anything else sends nothing. The deployment goes
through the same signer, wallet policy and checks as the cook. On Solana a missing Pot is created
in the cook's own transaction, with nothing asked, when the two fit in one.

### Know what it refuses

A cook that would fail is never sent: the run simulates it first, stops with the reason and exits
with code 1. On a preview chain the run is refused before it reads anything
([Supported and preview chains](cli.md#supported-and-preview-chains)).

### Approve ahead with `--yes`

Each question can be answered ahead with `-y` (`--yes`), which says what it approved:
`auto-approved: deploy Pot 0x…`. `--auto-approve` is its older name. With no terminal to ask on (in
CI, or in a pipe), or with `--json`, the run sends nothing until it is given `--yes`. It names what
it needs approved and stops.

The run asks the same way about everything it sends before its cook: deploying a missing Pot,
approving Permit2 for a token `--fund` pulls, and approving the Pot under `--fund-mode allowance`.

### Pay native coin the program spends

The cook's value defaults to the Kitchen's fee, read from the chain. When the program also spends
native coin, pass `--value <wei>` with the fee plus what it spends. A `--value` below the fee is
refused, since the cook would revert.

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
- `--sweep` sends back to you, at the end, the Pot's whole balance of each funded token, not only
  what this run brought.

The pull, the program and the sweep are one transaction: they succeed or fail together. Your
balance of each token is checked before anything is sent. A bare integer is whole tokens too:
`USDC:1500000` is 1.5 million USDC, which the command points out on stderr.

The first time you fund a token, Permit2, the standard contract the pull goes through, needs your
approval for that token. The run asks:

```text
Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) may move 0 of your USDC (base units), and this run needs 1500000. Approve Permit2 for USDC now? [y/N]
```

`y` sends the approval, then the cook. After that, each run needs only your signature, which the
run makes for you.

### Choose how the run pulls tokens

`--fund-mode` chooses how the Pot is allowed to pull:

| Mode                | You sign or send                                               | What stands afterwards                        |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `permit2` (default) | A Permit2 signature for exactly this amount, to this Pot, once | Nothing for the Pot; your approval of Permit2 |
| `permit`            | The token's own EIP-2612 `permit` signature, for the Pot       | Nothing: the pull spends it                   |
| `allowance`         | An `approve` of the Pot for the amount, in a transaction first | The Pot's allowance, until a cook spends it   |
| `transfer`          | A plain `transfer` to the Pot, in a transaction first          | Nothing                                       |

`permit2` is the default because it works for every ERC-20, USDT included, where `permit` needs a
token that implements EIP-2612. It gives the Pot no allowance: each signature is for one amount, to
one spender, with a fresh nonce and a deadline ten minutes out, so it cannot be replayed or used
late. And the run stays one transaction, the cook itself.

`allowance` and `transfer` send a transaction before the cook. If the cook then fails, the
allowance stands until a later cook spends it, and transferred tokens stay in the Pot.

### Know what `--fund` does to your program

The command wraps the program: a new `main`, with the same parameters, first pulls each amount from
you into the Pot, then calls the program's own `main` with the arguments as given, then, with
`--sweep`, sends what is left back to you. A script gets the pulls after its imports and the sweep
after its last statement. The pulls are the same token functions a program can call itself
([Pulling tokens in](protocols-and-tokens.md#pulling-tokens-in)), with the checks
[Safety](../concepts/safety.md) describes.

Signatures are made locally, by the signer you gave, and no key is printed. A Permit2 signature
names the Pot as its spender, and only the Pot's owner can cook on the Pot, so nobody else can use
it. A revert inside Permit2 is reported by name: `SignatureExpired(…)` for a passed deadline,
`InvalidNonce()` for a nonce already spent.

### Simulate a funded run

`sauce simulate` takes `--fund` and `--sweep` too. Given the owner's wallet, it asks for the
password and signs the pulls the run would make, sending nothing. With `--owner` and no key, the
pulls cannot be signed, so the Pot is credited what they would bring, and a shortfall in your
wallet is reported rather than refused. Each approval the run would send first is listed with its
gas.

## Where the results end up

What a program produces lands where it sends it. A swap with no other recipient, a lending
deposit's receipt tokens, a vault's shares: all stay in the Pot. They are yours, but your wallet
app will not show them, and only another program moves them out. So decide, for each result,
whether it should end in your wallet or stay in the Pot. To deliver it, send it to your wallet, or
name your wallet as the recipient of the call that produces it.

The command tells you, before and after. A simulation leads with
`Left in the Pot, not in the owner's wallet:`, and a run with `Left in the Pot, not in your wallet:`,
when the cook leaves anything there.
[Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md#where-a-programs-results-end) says more.

## More than one Pot

An owner has one Pot per **salt** ([glossary](../concepts/glossary.md)). Name another with
`--salt <label>`, and use the same salt in every command for that Pot:

```sh
sauce pot --chain base --wallet me --salt savings
sauce run pay.sauce.ts --chain base --wallet me --salt savings --args <recipient> 1000000
```

`--salt-hex 0x…` gives the exact 32 bytes instead (`--salt <label>` is `keccak256` of the label).

## Create a Pot by hand

You never need to: `sauce run` creates your Pot when it first needs it, and `sauce tx` plans its
creation. To create one ahead of time:

```sh
sauce pot --chain base --wallet me --deploy
```

Without `--deploy`, `sauce pot` prints the Pot's address and the unsigned deployment, and reads the
chain: whether the released engine and Kitchen are there, the Kitchen's fee, and whether the Pot is
deployed and whose it is. With `--deploy` it sends the deployment, unless the Pot is already there,
and waits until the endpoint shows the Pot's code.

Anyone may deploy a Pot, and it is its owner's either way. So `--deploy` with `--owner <address>`
deploys another owner's Pot, which your signer sends and pays for. On Solana the owner signs the
creation, so there the signer creates its own. `--format cast` prints the deployment as a
`cast send` line for [Foundry](https://getfoundry.sh/cast/overview) users, with `<RPC_URL>` and
`<PRIVATE_KEY>` left as placeholders.

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

`sauce pot list` reads no chain: `sauce pot --chain <chain> --owner <owner>` says whether a Pot is
still there. `--pots <dir>` keeps the store somewhere else.

### What a record holds

A Pot is recorded once the chain shows it deployed: by `pot --deploy`, by a run that deploys its
Pot, and by a deployment broadcast with `sauce send`. `sauce tx` sends nothing, and records nothing.
A record holds:

- the chain, on Solana with its cluster, so a devnet Pot is never recorded as mainnet's;
- the Pot's address, its owner and salt, and its kind: `private`, `private-fixed-router` or
  `shared`;
- the Kitchen and the release the Pot was created under, with the compiler whose programs it runs;
- the transaction that deployed it, the version of `sauce` that recorded it, and when.

Each record is one file, readable only by you, written once and never changed. No key or endpoint
is written there. The MCP server, run over stdio, keeps the same store in the same directory
([What a local server keeps](mcp-local.md)).

## Read the output as JSON

Every command here takes `--json` and prints one JSON object. `simulate` gives `ok` and
`leftInPot` first, then `block`, `gas`, `returns`, the moves (`moves`, each with `fromRole` and
`toRole`) and `balanceChanges`, with amounts as base-unit strings and whole units beside them. A
revert gives `reverted: true` and `error` first. `run` gives the cost and moves under `cook.cost`
and `cook.effects`, and `explorer` and `trace` beside each hash. Every flag is in
[the command reference](../reference/cli.md).

## Next

- Sign with a wallet policy, or with a key that never touches this machine:
  [Wallets and signing](cli-wallets.md).
- Write programs of your own: [Programs and arguments](cli-programs.md).
- What a cook is and where its results go: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
- Before you run with real funds: the [production checklist](production-checklist.md).
