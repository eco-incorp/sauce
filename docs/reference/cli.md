<!-- Generated from the sauce command's --help. Do not edit. -->

# Command reference

**Reference** · [Documentation](../README.md)

> This is the `sauce` command's manual page: every command and every flag, word for word as `--help`
> prints it. The list below links each command; the guides explain what each one is for, and this
> page is where you look up an exact flag.

Every command of `sauce`, and every flag it takes, as `sauce <command> --help` prints it, in
the order `sauce --help` lists them. The first block is `sauce --help` itself: what every
command shares, from endpoints and signing to the chains it sends on. A command with verbs is
followed by each verb's help.

## Commands

Most work goes through four of them: `sauce compile` checks a program, `sauce simulate` tries
it with no key, `sauce run` signs and sends it, and `sauce tx` prints the unsigned
transaction for another wallet to sign.

- [`sauce compile`](#sauce-compile): Compile a SauceScript program; print its bytecode
- [`sauce actions`](#sauce-actions): Lower an actions document to SauceScript for a chain; print the source and bytecode
- [`sauce simulate`](#sauce-simulate): Simulate the cook from the Pot's owner, with no key: what it did, or why it reverts
- [`sauce run`](#sauce-run): Compile, sign, send and wait for the cook on your Pot
- [`sauce wallet`](#sauce-wallet): Create, list and import the wallets --wallet signs with
  - `sauce wallet new`: Create a wallet with a fresh key, encrypted under its password
  - `sauce wallet list`: Every wallet: its name, kind and address
  - `sauce wallet address`: A wallet's address, with no password
  - `sauce wallet import`: Keep a key you have as a wallet: a private key, keystore or Solana keypair
  - `sauce wallet export`: Show a wallet's key at your terminal, once you confirm
- [`sauce tx`](#sauce-tx): Print the unsigned cook transaction, for a wallet to sign
- [`sauce send`](#sauce-send): Broadcast transactions signed elsewhere, wait for them, and report what they did
- [`sauce reclaim`](#sauce-reclaim): List the code buffers and lookup tables a Solana owner left open, and close them
- [`sauce pot`](#sauce-pot): Predict a Pot's address, deploy it, and list the Pots you deployed
  - `sauce pot list`: List the Pots you deployed or imported, each with the release it was minted under
  - `sauce pot import`: Record a Pot deployed elsewhere, read from the chain with the release that minted it
- [`sauce globals`](#sauce-globals): List the tokens, protocols and other names a program on a chain can use
- [`sauce price`](#sauce-price): Turn a price into a pool's sqrtPriceX96 and a swap's limits, priceLimit included
- [`sauce pools`](#sauce-pools): List a pair's price-limit pools on a chain, deepest first, with their prices
- [`sauce inspect`](#sauce-inspect): Take a cook, a Kitchen call, a program or a file apart
- [`sauce verify`](#sauce-verify): Check that a payload or cook runs the audited settle program
- [`sauce skills`](#sauce-skills): Install, update or check this package's agent skills in a project
- [`sauce update`](#sauce-update): Update this sauce command, the way it was installed
- [`sauce runtime`](#sauce-runtime): Install or check the packages sauce mcp and Solana simulations load
- [`sauce init`](#sauce-init): Scaffold a project that uses this package
- [`sauce mcp`](#sauce-mcp): Serve the commands and the agent skills to coding agents over MCP

## `sauce`

```text
sauce: compile SauceScript, and run it on a chain.

Usage: sauce <command> [options]
       sauce --version (-v)

Commands:
  compile   Compile a SauceScript program; print its bytecode
  actions   Lower an actions document to SauceScript for a chain; print the source and bytecode
  simulate  Simulate the cook from the Pot's owner, with no key: what it did, or why it reverts
  run       Compile, sign, send and wait for the cook on your Pot
  wallet    Create, list and import the wallets --wallet signs with
  tx        Print the unsigned cook transaction, for a wallet to sign
  send      Broadcast transactions signed elsewhere, wait for them, and report what they did
  reclaim   List the code buffers and lookup tables a Solana owner left open, and close them
  pot       Predict a Pot's address, deploy it, and list the Pots you deployed
  globals   List the tokens, protocols and other names a program on a chain can use
  price     Turn a price into a pool's sqrtPriceX96 and a swap's limits, priceLimit included
  pools     List a pair's price-limit pools on a chain, deepest first, with their prices
  inspect   Take a cook, a Kitchen call, a program or a file apart
  verify    Check that a payload or cook runs the audited settle program
  skills    Install, update or check this package's agent skills in a project
  update    Update this sauce command, the way it was installed
  runtime   Install or check the packages sauce mcp and Solana simulations load
  init      Scaffold a project that uses this package
  mcp       Serve the commands and the agent skills to coding agents over MCP

Run `sauce <command> --help` for its options. A command reads a chain through a built-in
public endpoint, which can be slow or rate-limited, unless --rpc-url or --config gives your
own (--offline reads none). Nothing is signed without --wallet, --keystore or --private-key
(on Solana, --wallet or --keypair). A password is read only from the source named:
--password-env NAME (that variable, the one read of the environment), --password-file or
--password-command; else it is asked for.

After a command, one line on stderr says when a newer sauce is published, suggesting `sauce
update`. It comes from a cache (~/.sauce/update-check.json) that is refreshed from the npm
registry once a day, in the background, never delaying a command. It is off with --offline,
with --no-update-check (any command takes it, before the command too), and for a command
whose --config file says "updateCheck": false.

Transactions are built and sent only on Ethereum, Base, Arc and Solana. Every other chain is a
preview chain: programs compile there, and simulate, dry runs and reads work, but no transaction
is built or sent. Ask for a chain:
https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml

A program file may be `-`, read from stdin (`cat pay.sauce.ts | sauce compile - --chain
base`); it is never read without one. Its relative imports then resolve against the
current directory, or --source-dir. Questions go to the terminal (/dev/tty) instead of
stdin; with no terminal, or with --json, a run names what it needs approved (deploying your
Pot first, say) and sends nothing until -y (--yes) and a password source for a wallet or
keystore are given.
```

## `sauce compile`

```text
Compile a SauceScript program; print its bytecode.

Usage: sauce compile <file | -> --chain <slug|id> [options]

Options:
      --chain <slug|id>         Chain the program runs on (base, 8453, solana)
      --target <evm|svm>        Checked against the chain; svm alone means solana
      --compact-args            Take main's arguments as compact-v1, not ABI-v1
      --source-dir <dir>        Resolve the program's relative imports here (default: beside it; from stdin, .)
      --args-json <json|file>   main's arguments as a JSON array, inline or in a file
      --account NAME=<address>  Solana: an account main takes (an address, pot, owner, self, pot:USDC, @to:USDC, mint:USDC, program:USDC), to size the cook
      --via <kitchen|engine>    Solana: size the Kitchen's cook (default) or the engine's direct one
      --rpc-url <url>           Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>           Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                 Read no chain: no endpoint, not even a built-in one
      --out <path>              Write the output to a file, not stdout
      --json                    Print JSON: sizes, defines and contracts applied, main's parameters, engine
  -h, --help                    Show this help
      --no-update-check         No notice of a newer sauce, and no registry read for one
      --args <value>…           main's arguments in order (JSON for an array or tuple); -- before one like a flag

Low-level (a program's inputs are main's parameters, given with --args):
      --define NAME=VALUE    A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana
      --defines <file.json>  Compile-time values from a JSON object of NAME to value; --define wins

Compiles the file as a standalone program for the chain (routes.compileSauceProgram):
its token symbols (USDC), protocol namespaces (Uniswap.UniversalRouter), chainId, the
zero-import @sauce/token functions and SafeERC20 token writes (USDC.transfer,
Token(addr).approve) all resolve against it, so one file compiles for any chain whose
names it uses. Relative imports are read from beside
the file. A file may name its chain in a leading `// @chain base` line. An actions
document compiles too (`sauce actions`).

--json also says what the compile applied and how large the result is:
  defines    each name the chain gave the file (a token symbol, a protocol contract, the
             chain id) and each low-level --define it read, with its value and source
  contracts  each protocol contract it calls or reads (UniswapV3.Factory), resolved on its
             chain
  size       the program's bytes; payload: the program with main's arguments (--args)
  cook       on Solana, the cook's transaction against the 1232-byte limit, measured
             with --account where given and a distinct account for each other slot, as
             the Kitchen's cook or, --via engine, the engine's direct one
A --define the file never reads is named on stderr: it changes nothing.

Examples:
  sauce compile pay.sauce.ts --chain base
  sauce compile split.sauce.ts --chain base --json --args 0x… 1000000
```

## `sauce actions`

```text
Lower an actions document to SauceScript for a chain; print the source and bytecode.

Usage: sauce actions <file | -> [--chain <slug|id>] [--compact-args] [--json]

Options:
      --chain <slug|id>  The chain to compile for (default: the document's chainId)
      --compact-args     Take main's arguments as compact-v1, not ABI-v1
      --json             Print JSON: the document, source, bytecode and main's parameters
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

An actions document is JSON: { "version": 1, "actions": [ … ] }, each action one
protocol operation (actions/action-program.schema.json lists them). Tokens are registry
symbols (USDC) and contracts namespace references (UniswapV3.Factory), or addresses; a pool
may be given by its factory's key (factory and fee). Lowered for the chain, every name is
the program's global of that name, so a document with no chainId compiles for any chain
where its names exist, and a name the chain lacks is refused with its path.

Prints the SauceScript the document lowers to, then main's parameters and the bytecode.
compile, tx, simulate and run take an actions document wherever they take a .sauce.ts
file, with the same flags: its argument actions are main's parameters (--args), and its
cook runs on the Pot --owner or --pot names.

Examples:
  sauce actions swap.json --chain base
  sauce simulate swap.json --chain base --owner 0x… --args 1000000
```

## `sauce simulate`

```text
Simulate the cook from the Pot's owner, with no key: what it did, or why it reverts.

Usage: sauce simulate <file | -> --chain <slug|id> (--owner <address> | --pot <address>) [options]
       sauce simulate <file | -> --chain solana --owner <pubkey> [--account NAME=<value>]… [options]

Options:
      --chain <slug|id>                Chain the program runs on (base, 8453, solana)
      --target <evm|svm>               Checked against the chain; svm alone means solana
      --compact-args                   Take main's arguments as compact-v1, not ABI-v1
      --source-dir <dir>               Resolve the program's relative imports here (default: beside it; from stdin, .)
      --owner <address>                The Pot's owner, which derives the Pot with the salt (default 0)
      --salt <label>                   Name one of the owner's Pots: salt = keccak256(label)
      --salt-hex <bytes32>             …or give its salt exactly
      --args-json <json|file>          main's arguments as a JSON array, inline or in a file
      --rpc-url <url>                  Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>                  Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                        Read no chain: no endpoint, not even a built-in one
      --assume-balance <TOKEN:amount>  Give the Pot this balance, in whole tokens, for the simulation only: USDC:2, ETH:0.1
      --expect-revert <text>           Expect the cook to revert with a reason containing this text: exit 0 only if it does
      --wallet <name>                  The owner's wallet: names the owner (and on EVM signs --fund's pulls)
      --wallets [<dir>]                The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>            The password is the environment variable NAME (only that one is read)
      --password-file <path>           …or a file only you can read (else it is asked for)
      --password-command <command>     …or what this command prints (a secret manager's CLI)
      --json                           Print one JSON object instead
  -h, --help                           Show this help
      --no-update-check                No notice of a newer sauce, and no registry read for one
      --args <value>…                  main's arguments in order (JSON for an array or tuple); -- before one like a flag

EVM chains only:
      --pot <address>        Or the Pot itself, by address
      --value <wei>          Kitchen fee plus native spent (default: read the fee)
      --block <number|tag>   Simulate on this block: a number, or latest, safe, finalized (default: latest)
      --fund <TOKEN:amount>  Pull tokens into the Pot in the cook: USDC:1.5 (whole tokens), ETH:0.01
      --fund-mode <mode>     permit2 (default), permit, allowance or transfer
      --sweep                Return what is left of each funded token afterwards
      --keystore <path>      The owner's keystore: names the owner (and signs --fund's pulls)
      --private-key <hex>    Or sign with a raw key (lands in shell history)

Solana only:
      --account NAME=<address>        An account main takes, by name: an address, pot, owner, self, system (the System Program), pot:USDC (the Pot's USDC account), @to:USDC (main's argument to's), mint:USDC, program:USDC (its token program), slot:@pool:USDC.vaultA (a pool's account) or pda:<program>:<seeds>. The accounts the token methods and venue namespaces add, and those a program writes where it uses them (Solana.pda(…)), are derived without it
      --accounts <json|file>          The accounts main takes as one JSON object of NAME to value, as --account takes them, inline or in a file
      --via <kitchen|engine>          The Kitchen's cook on the Pot (default), or the engine's own, with no Pot
      --max-execution-fee <lamports>  Refuse a cook whose execution fee is above this
      --lookup-table <address>        An address lookup table holding the cook's accounts (sauce run creates one when they do not fit)
      --keypair <path>                The owner's keypair, naming the owner; nothing is signed

Low-level (a program's inputs are main's parameters, given with --args):
      --define NAME=VALUE    A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana
      --defines <file.json>  Compile-time values from a JSON object of NAME to value; --define wins

Compiles the file, builds the cook and simulates it from the Pot's owner: no key, no
transaction, no local node. Prints the gas, what the program returns and what the cook
did, or the decoded reason it reverts (exit 1).

It simulates through eth_simulateV1, which returns the cook's logs: the output lists the
ERC-20 transfers and approvals (registry symbols, whole units), the native transfers the
node traces, and each address's net change. An endpoint without eth_simulateV1 falls back
to eth_call with state overrides, which gives the result and the gas but no logs. The
output names the route it took.

A Pot that is not deployed yet is deployed in the simulation first, from --owner (and
--salt): any account may send Kitchen.deployPot, and the Pot is the owner's either way.
An owner holding less than the cook's value is given it for the simulation.

--assume-balance TOKEN:amount gives the Pot that balance for this simulation only, by state
override: repeatable, the amount as --fund takes it, ETH:<amount> for the native currency.
Where a token keeps the balance is found by asking it, with eth_call; a token that stores
no balance it reports (rebasing, shares) is refused.

With --fund and the owner's key (--keystore or --private-key), the simulation includes the
pulls `sauce run --fund` would make, signed and not sent; an approval the run would ask for
is reported, not made. With no key the pulls cannot be signed, so the Pot is credited what
they would bring, by state override, and --sweep still runs.

On Solana: the Kitchen cook, simulated from --owner with signatures unchecked, with each
account main takes given as --account NAME=<address | pot | owner> and an Address
argument as a base58 public key. `pot:USDC` (or pot:<mint>) is the Pot's own token account
for that mint, its associated token account under the mint's token program; owner:USDC the
owner's; mint:USDC the mint and program:USDC its token program (SPL Token or Token-2022),
the accounts a checked write takes. An account the cluster does not have is named in a
note. Where main declares a return type, what it
returned is read as that type. A Pot the Kitchen has not created is created first, in the
same transaction. --via engine simulates the engine's own paid cook instead: no Kitchen and
no Pot (so no pot or pot:<token> account), --owner signing as the program's authority and
paying the fee. Either way the cook pays the Kitchen's execution fee, read from the cluster
and printed; --max-execution-fee refuses one above it. Prints the compute units and what the
cook moved — each token account's balance change and each account's lamports, read from the
accounts the transaction writes before it and as the simulation leaves them — or the reason
(a program's revert message decoded) and the program logs. Solana's simulateTransaction
takes no account overrides, so the owner must hold the Pot's rent and the fees there.
A cook too large for one transaction, or one given --assume-balance, is simulated in a
local copy instead, with LiteSVM, which the package does not bundle: your own copy at the
version it pins, else the runtime folder its first use installs (sauce runtime). Every
account the cook names is read from the cluster with its rent, the released engine and
Kitchen loaded, the owner given the lamports the staging and the fees take (any address
can simulate), the Pot created if missing, the program staged into a code buffer as
`sauce run` stages it, then the cook, its accounts through a lookup table. There
--assume-balance TOKEN:amount gives the account the cook spends that token from (the
Pot's, or the owner's with --via engine) that balance, and a pot:<token> or owner:<token>
account the cluster does not have yet is made empty, which `sauce run` creates before the
cook. An --owner that is not a wallet is refused.

A cook that reverts exits 1, and the first line says so: The cook reverts: <reason>. In
--json, reverted: true and error lead the JSON, and the same line leads stderr.
--expect-revert <text> holds a simulation of a guard to its revert: it exits 0 only when the
cook reverts with a reason containing the text, and 1 when it succeeds or reverts otherwise.

Examples:
  sauce simulate pay.sauce.ts --chain base --owner 0x… \
    --assume-balance USDC:2 --args 0x… 1000000
  sauce simulate pay.sauce.ts --chain base --owner 0x… \
    --args 0x… 1000000 --expect-revert "too much"
  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> \
    --account source=<token account> --account authority=pot
  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> \
    --via engine --account source=<token account> --account authority=owner
```

## `sauce run`

```text
Compile, sign, send and wait for the cook on your Pot.

Usage: sauce run <file | -> --chain <slug|id> (--keystore <path> | --private-key <hex>) [options]
       sauce run <file | -> --chain solana --keypair <path> [--account NAME=<value>]… [options]

Options:
      --chain <slug|id>             Chain the program runs on (base, 8453, solana)
      --target <evm|svm>            Checked against the chain; svm alone means solana
      --compact-args                Take main's arguments as compact-v1, not ABI-v1
      --source-dir <dir>            Resolve the program's relative imports here (default: beside it; from stdin, .)
      --owner <address>             The Pot's owner, which derives the Pot with the salt (default 0)
      --salt <label>                Name one of the owner's Pots: salt = keccak256(label)
      --salt-hex <bytes32>          …or give its salt exactly
      --args-json <json|file>       main's arguments as a JSON array, inline or in a file
      --rpc-url <url>               Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>               Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                     Read no chain: no endpoint, not even a built-in one
      --wallet <name>               Sign with a wallet of the wallet directory (sauce wallet), EVM or Solana
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
  -y, --yes                         Approve, without asking, what it sends first (deploying your Pot, an approval)
      --auto-approve                The same as --yes, its older name
      --pots <dir>                  The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)
      --json                        Print one JSON object instead
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one
      --args <value>…               main's arguments in order (JSON for an array or tuple); -- before one like a flag

EVM chains only:
      --pot <address>        Or the Pot itself, by address
      --value <wei>          Kitchen fee plus native spent (default: read the fee)
      --keystore <path>      Sign with a JSON keystore (v3), with a password source
      --private-key <hex>    Or sign with a raw key (lands in shell history)
      --fund <TOKEN:amount>  Pull tokens into the Pot in the cook: USDC:1.5 (whole tokens), ETH:0.01
      --fund-mode <mode>     permit2 (default), permit, allowance or transfer
      --sweep                Return what is left of each funded token afterwards

Solana only:
      --account NAME=<address>        An account main takes, by name: an address, pot, owner, self, system (the System Program), pot:USDC (the Pot's USDC account), @to:USDC (main's argument to's), mint:USDC, program:USDC (its token program), slot:@pool:USDC.vaultA (a pool's account) or pda:<program>:<seeds>. The accounts the token methods and venue namespaces add, and those a program writes where it uses them (Solana.pda(…)), are derived without it
      --accounts <json|file>          The accounts main takes as one JSON object of NAME to value, as --account takes them, inline or in a file
      --via <kitchen|engine>          The Kitchen's cook on the Pot (default), or the engine's own, with no Pot
      --max-execution-fee <lamports>  Refuse a cook whose execution fee is above this
      --lookup-table <address>        An address lookup table holding the cook's accounts (sauce run creates one when they do not fit)
      --keypair <path>                Sign with a keypair file (a JSON array of 64 bytes)

Low-level (a program's inputs are main's parameters, given with --args):
      --define NAME=VALUE    A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana
      --defines <file.json>  Compile-time values from a JSON object of NAME to value; --define wins

Compiles the file, builds the cook on the signer's Pot (or --pot), simulates it, signs it,
sends it and waits for the receipt: prints the hash, status and gas used, and the decoded
reason when it reverts (exit 1). The signer is the owner. The value defaults to the
Kitchen's execution fee, read from the chain.

You never deploy the Pot as a step of your own: a run deploys it when it first needs it.
What the run sends before its cook, each in a transaction of its own, it asks you to
approve at the terminal first; -y (--yes, or --auto-approve) approves every one without
asking, and says `auto-approved: <action>` for each. They are:
  deploying your Pot, when it has no code yet (asked as `[deploy/cancel]`, with its gas)
  approving Permit2 for a token --fund pulls, the first time (--fund-mode permit2)
  approving the Pot for the amount --fund pulls (--fund-mode allowance)
On Solana a missing Pot is created in the cook's own transaction, with nothing asked, when
the two fit in one; else it is asked for like the rest. With no terminal to ask on (CI, a
pipe, a program read from stdin with no terminal), or with --json, nothing is sent until
they are approved: the run names every one it needs, and --yes, and stops.

--fund TOKEN:amount gets tokens into the Pot in the same cook: the program is wrapped so
it first pulls each amount from you, then runs, then (--sweep) returns what is left. The
amount is in whole tokens: USDC:1.5 is 1.5 USDC, and USDC:1500000 is 1.5 million (said
on stderr); base units end in n, as a bigint is written (USDC:1500000n is 1.5 USDC).
ETH:<amount> rides as the cook's value. Every pull is a safeTransferFrom: @sauce/token's
SafeERC20 one, or Permit2's own (Solmate's SafeTransferLib). --fund-mode:
  permit2    (default) you sign a Permit2 transfer of exactly this amount to this Pot, once;
             works for every ERC-20, USDT included, and leaves the Pot no allowance. The
             first time, Permit2 needs your approval for the token: asked for, like the Pot.
  permit     the token's own EIP-2612 permit, signed for the Pot (tokens that have one)
  allowance  an approval of the Pot for the amount (asked for), sent first: it stands
             until a cook spends it
  transfer   a plain transfer to the Pot first, in a transaction of its own
--sweep sends the Pot's whole balance of each funded token back to you (and of the
native currency, when ETH is funded), not only what this run brought.

On Solana: sign with --keypair; the Kitchen's fee is read from the cluster, a missing Pot
is created the same way, and so is a pot:<token> or owner:<token> account the cook names that
the cluster does not have yet (the owner paying its rent); a program too large for one
transaction is staged in a code buffer first (closed again after the cook). A failure prints
the program logs.

--via kitchen|engine (Solana) is how the cook reaches the engine:
  kitchen  (default) the Kitchen's cook, which signs the owner's Pot: the program can hold
           and spend what the Pot owns, and write its storage
  engine   the engine's own paid cook (cookAndPay), with no Kitchen and no Pot: the program
           acts with the signer's authority (--account NAME=owner), and its own calls get
           one more level of CPI depth. A staged program is pinned to the staged bytes
Both pay the same execution fee into the Kitchen's treasury. The cook signs the fee it read
as its max_execution_fee, so it pays that or fails; --max-execution-fee <lamports> refuses
a fee above it before anything is sent.

Runs only on a supported chain: Ethereum, Base, Arc and Solana. On any other (a preview chain)
it is refused before anything is read or signed, with the supported chains and the GitHub issue
to ask for that chain with; compile and simulate work there.

Examples:
  sauce run pay.sauce.ts --chain base --keystore ~/.keys/me.json
  sauce run sweep.sauce.ts --chain solana --keypair ~/.config/solana/id.json \
    --account source=<token account> --account authority=pot
  sauce run sweep.sauce.ts --chain solana --keypair ~/.config/solana/id.json \
    --via engine --max-execution-fee 10000 --account authority=owner …
```

## `sauce wallet`

```text
Create, list and import the wallets --wallet signs with.

Usage: sauce wallet <verb> [options]

Options:
      --wallets [<dir>]  The wallet directory (default: ~/.sauce/wallets)
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Verbs (`sauce wallet <verb> --help` for each):
  new       Create a wallet with a fresh key, encrypted under its password
  list      Every wallet: its name, kind and address
  address   A wallet's address, with no password
  import    Keep a key you have as a wallet: a private key, keystore or Solana keypair
  export    Show a wallet's key at your terminal, once you confirm

A wallet is a key the sauce command keeps in the wallet directory (--wallets, default
~/.sauce/wallets), encrypted under a password from the source you name: --password-env
NAME, --password-file <path>, --password-command <command>, or a prompt. Every command
that signs takes --wallet <name> with that source, on EVM chains and Solana; so does the
local MCP server (sauce mcp) over stdio. It is a hot wallet: keep small balances in it.

A policy limits what a wallet sends: <name>.policy.json beside it, every field optional and
every amount a string in whole tokens ("100" is 100 USDC), or base units ending in n:
  { "chains": ["base"], "to": ["0x…"],
    "native": { "perTransaction": "0.01", "perDay": "0.05" },
    "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } } }
What a transaction moves out of the wallet (and the Pot it cooks on) is measured by
simulating it, and a send that breaks a limit is refused, naming it; the last 24 hours are
counted from <name>.ledger.jsonl. With no policy, sends work, and say no limits are set.

Examples:
  sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
  sauce run pay.sauce.ts --chain base --wallet agent \
    --password-env SAUCE_WALLET_PASSWORD --args 0x… 1000000
```

### `sauce wallet new`

```text
Create a wallet with a fresh key, encrypted under its password.

Usage: sauce wallet new <name> [--solana] [--password-env <NAME> | --password-file <path> | --password-command <command>]

Options:
      --solana                      A Solana keypair (default: an EVM key)
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
      --json                        Print one JSON object instead
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

Generates a key and keeps it in the wallet directory (--wallets, default ~/.sauce/wallets,
created 0700) as <name>.json, written once, 0600, never overwritten. An EVM wallet is a
Web3 Secret Storage keystore (scrypt, AES-128-CTR) that --keystore, cast wallet and geth
read; a Solana one is the same envelope around its keypair, marked "kind": "solana". Its
address is in the clear, so list and address need no password. Prints the name, kind,
address and file.

The password comes from one source: --password-env NAME (that variable, the one the
command reads from the environment), --password-file (a file only you can read: one
others can read is refused), --password-command (what the command prints, its output
never shown), or else a prompt, asked twice. At least 8 characters. An agent keeps it in
its .env or its secret store and names the source; the password itself is never an
argument.

Sign with it anywhere a key signs: --wallet <name> with the same password source. Beside
it, <name>.policy.json limits what it sends (sauce wallet --help). It is a hot wallet:
keep small balances in it.

Examples:
  sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
  sauce wallet new agent-sol --solana --password-file ~/.config/sauce/password
```

### `sauce wallet list`

```text
Every wallet: its name, kind and address.

Usage: sauce wallet list [--wallets <dir>] [--json]

Options:
      --wallets [<dir>]  The wallet directory (default: ~/.sauce/wallets)
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Lists the wallet directory (--wallets, default ~/.sauce/wallets): each wallet's name, kind
(evm or solana), address, and whether a policy limits it. No password is needed: each
file names its address in the clear.
```

### `sauce wallet address`

```text
A wallet's address, with no password.

Usage: sauce wallet address <name> [--wallets <dir>] [--json]

Options:
      --wallets [<dir>]  The wallet directory (default: ~/.sauce/wallets)
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Prints the wallet's address: a 0x address, or for a Solana wallet a base58 key.
```

### `sauce wallet import`

```text
Keep a key you have as a wallet: a private key, keystore or Solana keypair.

Usage: sauce wallet import <name> <file | -> [--solana] [password source]

Options:
      --solana                      Refuse anything but a Solana keypair
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
      --json                        Print one JSON object instead
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

Reads the key from <file>, or from stdin with -, never from the command line: an EVM
private key (32 bytes of hex), a Web3 Secret Storage keystore (opened with the password,
which the wallet keeps), or a Solana keypair (a JSON array of 64 bytes, as solana-keygen
writes, or its base58). It is stored as `sauce wallet new` stores a fresh one, encrypted
under the password the source gives.

Example:
  sauce wallet import treasury key.txt --password-env SAUCE_WALLET_PASSWORD
```

### `sauce wallet export`

```text
Show a wallet's key at your terminal, once you confirm.

Usage: sauce wallet export <name> [password source]

Options:
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

Shows the wallet's private key (a Solana wallet's keypair, as the JSON array a keypair
file holds) on the terminal itself, never on stdout, after you type the wallet's name to
confirm. With no terminal it refuses. It is for moving a key to another wallet: anyone
who sees it controls the wallet. The MCP server has no tool for it.
```

## `sauce tx`

```text
Print the unsigned cook transaction, for a wallet to sign.

Usage: sauce tx <file | -> --chain <slug|id> (--owner <address> | --pot <address>) [options]
       sauce tx <file | -> --chain solana --owner <pubkey> [--account NAME=<value>]… [options]

Options:
      --chain <slug|id>        Chain the program runs on (base, 8453, solana)
      --target <evm|svm>       Checked against the chain; svm alone means solana
      --compact-args           Take main's arguments as compact-v1, not ABI-v1
      --source-dir <dir>       Resolve the program's relative imports here (default: beside it; from stdin, .)
      --owner <address>        The Pot's owner, which derives the Pot with the salt (default 0)
      --salt <label>           Name one of the owner's Pots: salt = keccak256(label)
      --salt-hex <bytes32>     …or give its salt exactly
      --args-json <json|file>  main's arguments as a JSON array, inline or in a file
      --rpc-url <url>          Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>          Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                Read no chain: no endpoint, not even a built-in one
      --format <json|cast>     json (default), or a `cast send` line with placeholders
  -h, --help                   Show this help
      --no-update-check        No notice of a newer sauce, and no registry read for one
      --args <value>…          main's arguments in order (JSON for an array or tuple); -- before one like a flag

EVM chains only:
      --pot <address>        Or the Pot itself, by address
      --value <wei>          Kitchen fee plus native spent (default: read the fee)
      --fund <TOKEN:amount>  Transfer tokens from the owner into the Pot before the cook: USDC:1.5 (whole tokens); ETH:0.01 rides as its value

Solana only:
      --account NAME=<address>        An account main takes, by name: an address, pot, owner, self, system (the System Program), pot:USDC (the Pot's USDC account), @to:USDC (main's argument to's), mint:USDC, program:USDC (its token program), slot:@pool:USDC.vaultA (a pool's account) or pda:<program>:<seeds>. The accounts the token methods and venue namespaces add, and those a program writes where it uses them (Solana.pda(…)), are derived without it
      --accounts <json|file>          The accounts main takes as one JSON object of NAME to value, as --account takes them, inline or in a file
      --via <kitchen|engine>          The Kitchen's cook on the Pot (default), or the engine's own, with no Pot
      --max-execution-fee <lamports>  Refuse a cook whose execution fee is above this
      --lookup-table <address>        An address lookup table holding the cook's accounts (sauce run creates one when they do not fit)

Low-level (a program's inputs are main's parameters, given with --args):
      --define NAME=VALUE    A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana
      --defines <file.json>  Compile-time values from a JSON object of NAME to value; --define wins

Compiles the file and prints the transaction that runs it, unsigned, as JSON:
{ chainId, to: the Pot, data: Pot.cook(engine, program ++ arguments), value }. The value
is --value, or else the Kitchen's fee, read from the chain, which also checks the Pot.
When the chain shows the Pot has no code yet, it prints the plan instead: { chainId, pot,
transactions }, Kitchen.deployPot first (marked deploysPot; any account may send it), then
the cook, to send in that order. `--format cast` prints each as a `cast send` line. What
must be true for it to land goes to stderr: the Pot funded, and sent from its owner.
Each transaction is what a wallet's send tool takes (value and gas hex), and sendCalls
is all of them as one batch, for a wallet that sends a batch.

--fund TOKEN:amount (whole tokens, or base units ending in n) plans the owner's transfer
of each token into the Pot after its deployment and before the cook; ETH:<amount> rides
as the cook's value. Sent as one batch, a smart wallet deploys, funds and cooks with one
approval, or nothing happens.

On Solana: { chain, via, feePayer, pot, fee, maxExecutionFee, createsPot, transaction },
the Kitchen cook as a base64 transaction signed by no one, for --owner to sign — or, --via
engine, the engine's own paid cook, with no Pot. A Pot not created yet is created by the
same transaction, ahead of the cook (createsPot). It reads the cluster (for the blockhash
and the fee), and the --account flags simulate takes; --max-execution-fee refuses a fee
above it.

Prints the transaction only on a supported chain: Ethereum, Base, Arc and Solana. On any other
(a preview chain) it is refused before anything is read or signed, with the supported chains and
the GitHub issue to ask for that chain with; compile and simulate work there.

Example:
  sauce tx pay.sauce.ts --chain base --owner 0x…
  sauce tx pay.sauce.ts --chain base --owner 0x… --value 0 --offline
  sauce tx pay.sauce.ts --chain base --owner 0x… --fund USDC:100
```

## `sauce send`

```text
Broadcast transactions signed elsewhere, wait for them, and report what they did.

Usage: sauce send <signed transaction>… [--chain <slug|id>] [options]
       sauce send [<signed transaction>…] --cursor <cursor | @file> [--signature <signature>]… [--close]

Options:
      --chain <slug|id>          The chain they are for (default: the transactions say)
      --cursor <cursor | @file>  Solana: the plan's cursor sauce tx (or the last send) gave; prints its next step
      --signature <signature>    Solana: a transaction of the plan you broadcast another way, to confirm
      --close                    Solana, with --cursor: give up on the cook, and close the code buffer it staged
      --rpc-url <url>            Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>            Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                  Read no chain: no endpoint, not even a built-in one
      --pots <dir>               The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)
      --json                     Print one JSON object instead
  -h, --help                     Show this help
      --no-update-check          No notice of a newer sauce, and no registry read for one

Sends transactions you signed with any signer — a hardware wallet, a KMS, another wallet's
tool — and never takes a key. Each operand is one SIGNED transaction: on an EVM chain the
raw 0x… hex a signer returns (its chain and sender are read from it); on Solana the base64
wire transaction, every signature checked against its message. `-` reads them from stdin,
separated by whitespace.

They go out in the order given. Each is simulated as it was signed first — on an EVM chain
an eth_call from its sender, its gas limit held to what that used; on Solana a simulation
that checks the signatures — and one that would fail is not sent: the reason is printed
(exit 1), and nothing after it is sent. Each is confirmed before the next is simulated, so
a cook after its Pot's deployment runs on the Pot. Prints, for each, the hash (a Solana
signature), status and what it cost, the explorer and trace pages, the decoded reason a
failure gives, and for a cook what moved and what it left in the Pot; on Solana what main
returned. A Solana transaction lands within about a minute of being built, or never: one
whose blockhash has expired is refused, to build and sign again. One the chain already
has is read back, not sent again; one it had, pending, then lost (dropped or reorged out)
is reported gone, to sign anew. A Solana transaction missing a signature (its fee payer's,
or any its message names) is refused by name.

A Solana cook too large for one transaction is a plan of steps (sauce tx prints the first,
and its cursor): the setup (the Pot, token accounts, the program staged in a code buffer, a
lookup table), the cook, then closing the code buffer. With --cursor, after sending it
prints the next step, built fresh from what the cluster shows, with the cursor for the one
after: sign its transactions and send them with that cursor, until the step is done.
Whatever did not land is built again, so a step whose blockhash expired comes back with
only what is left. --cursor alone builds the next step without sending anything; a
transaction you broadcast another way is confirmed with --signature, so the plan knows
how its cook went. A step with nothing to sign says why in its wait (a cook handed out
that can still land, or a lookup table in use only from the next slot): send the cursor
alone again for it. A cook its simulation says would fail is not built: the step says
why, with the logs, and the cursor alone, once what it needs is there, simulates it again.
--close gives up on the cook and closes the code buffer. A cursor
carries no key and no endpoint; @file reads it from a file, or from the JSON a step was
printed as.

What landed is kept as the other commands keep it: a Pot one deployed in the Pot store.

Sends only on a supported chain: Ethereum, Base, Arc and Solana. On any other (a preview chain)
it is refused before anything is read or signed, with the supported chains and the GitHub issue
to ask for that chain with; compile and simulate work there.

Examples:
  sauce send 0x02f8… 0x02f8…              (sauce tx's plan: the deployment, then the cook)
  sauce send AQAB… --chain solana
  sauce send AQAB… AQAB… --cursor @step.json --json > next.json
```

## `sauce reclaim`

```text
List the code buffers and lookup tables a Solana owner left open, and close them.

Usage: sauce reclaim --chain solana (--owner <pubkey> | --keypair <path> | --wallet <name>) [--lookup-table <address>]… [--keep <cursor | @file>]… [--keep-tables] [--yes]

Options:
      --chain <slug|id>             The chain: solana
      --owner <pubkey>              Whose: with no key, the closing transactions come back unsigned
      --lookup-table <address>      A lookup table to close (default: the owner's Sauce tables, scanned for)
      --keep <cursor | @file>       A plan still under way, by its cursor: its code buffer and lookup table stay open
      --keep-tables                 Close the code buffers only, and leave the lookup tables for later cooks
      --wallet <name>               Sign with a wallet of the wallet directory (sauce wallet), EVM or Solana
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
  -y, --yes                         Approve, without asking, what it sends first (deploying your Pot, an approval)
      --rpc-url <url>               Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>               Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                     Read no chain: no endpoint, not even a built-in one
      --json                        Print one JSON object instead
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

Solana only:
      --keypair <path>  Sign with a keypair file (a JSON array of 64 bytes)

Lists what a Solana owner has open from its cooks, and the rent it holds: the Kitchen code
buffers a staged program ran from (a run closes its own, unless closing it failed; a plan
given up on, or never finished, leaves one), and the address lookup tables its accounts
went through (a run keeps each for the next cook naming the same accounts). The tables are
the owner's that hold the Kitchen's execution-fee config, which every Sauce cook's table
holds; a table the owner made otherwise is left alone, and --lookup-table names tables
outright, as some endpoints refuse to scan for them.

A buffer closes in one transaction, its rent back at once. A table closes in two: it is
deactivated now, and closed once its deactivation slot has left the cluster's recent slot
hashes, 512 slots (about three and a half minutes) later: run the command again then. It
serves cooks until then, and none after, so --keep-tables leaves them.

Nothing in use is closed: a buffer or an active table a transaction named in the last 300
slots (about two minutes) is left open, as a cook built for it may still land, and the
listing says from which slot it can close. A plan you mean to carry on with, whose cook
may be handed out later, is kept whole with --keep and its cursor.

A run takes 32 code buffers and 24 lookup tables at most (the tables it can close or
deactivate first), and says how many more are open: run it again once these are closed.

With the owner's key (--keypair, or --wallet), it asks, then sends each transaction and
prints it; --yes sends without asking. With --owner alone it prints the transactions
unsigned, as JSON, for the owner to sign anywhere and send with sauce send.

Closes only on a supported chain: Ethereum, Base, Arc and Solana. On any other (a preview chain)
it is refused before anything is read or signed, with the supported chains and the GitHub issue
to ask for that chain with; compile and simulate work there.

Examples:
  sauce reclaim --chain solana --owner <pubkey>
  sauce reclaim --chain solana --keypair ~/.config/solana/id.json --yes
```

## `sauce pot`

```text
Predict a Pot's address, deploy it, and list the Pots you deployed.

Usage: sauce pot --chain <slug|id> --owner <address> [--salt <label> | --salt-hex <bytes32>] [--deploy …]
       sauce pot <list | import> [options]

Options:
      --owner <address>             Whose Pot: cook() is onlyOwner
      --chain <slug|id>             The chain the Pot is for
      --salt <label>                Name one of the owner's Pots: salt = keccak256(label)
      --salt-hex <bytes32>          …or give its salt exactly
      --deploy                      Send the deployment (needs an endpoint and a signer)
      --rpc-url <url>               Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>               Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                     Read no chain: no endpoint, not even a built-in one
      --wallet <name>               Sign with a wallet of the wallet directory (sauce wallet), EVM or Solana
      --wallets [<dir>]             The wallet directory (default: ~/.sauce/wallets)
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
      --pots <dir>                  The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)
  -y, --yes                         Accepted, approving nothing: --deploy itself is the approval
      --auto-approve                Accepted, approving nothing: --deploy itself is the approval
      --format <json|cast>          json (default), or a `cast send` line with placeholders
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

EVM chains only:
      --keystore <path>    Sign with a JSON keystore (v3), with a password source
      --private-key <hex>  Or sign with a raw key (lands in shell history)

Solana only:
      --keypair <path>  Sign with a keypair file (a JSON array of 64 bytes)

A Pot's address is CREATE2 from the released Kitchen over (owner, salt), so it is known
before it exists. You need not deploy it yourself: sauce run deploys it when it first
needs it (asking, or with -y), and sauce tx plans its deployment first. This does it by
hand. Prints the address and the unsigned Kitchen.deployPot transaction as JSON; with
--deploy, sends it unless the Pot is already there, and waits until the endpoint shows its
code. The owner defaults to the signer. Deploying is permissionless: with --owner, the
signer sends and pays for another owner's Pot, which is that owner's alone. The default
salt is zero: the one Pot an owner has by default. With a signer and no --owner, it is the
signer's own Pot, so `sauce pot --chain base --keystore <keystore>` prints your address and
your Pot (the keystore's own address field is read, with no password, where it has one).
Without --deploy it also reads
the chain: whether the released engine and Kitchen are there, the Kitchen's fee, and
whether the Pot is deployed and whose it is (under `deployment`, and on stderr).

On Solana a Pot is the Kitchen's PDA over (owner, salt): this prints it and the create_pot
instruction; --deploy (with --keypair) creates it. There the owner signs create_pot, so
the signer is the owner.

Every Pot a command deploys (this, a run that deploys its Pot first, sauce send) is
recorded in the Pot store (--pots, default
~/.sauce/pots) once the chain shows it deployed: its chain, owner, salt and kind, the
Kitchen and the release it was minted under (the engine, and the compiler whose programs
it runs), and the transaction that deployed it. sauce tx sends nothing, so it records
nothing.

Verbs (`sauce pot <verb> --help` for each):
  list      List the Pots you deployed or imported, each with the release it was minted under
  import    Record a Pot deployed elsewhere, read from the chain with the release that minted it

Deploys (or prints the deployment) only on a supported chain: Ethereum, Base, Arc and Solana. On
any other (a preview chain) it is refused before anything is read or signed, with the supported
chains and the GitHub issue to ask for that chain with; compile and simulate work there.

Examples:
  sauce pot --owner 0x… --chain base
  sauce pot --deploy --chain base --keystore ~/.keys/me.json --salt treasury
  sauce pot --deploy --chain base --owner 0x… --keystore <keystore>
  sauce pot --deploy --chain solana --keypair ~/.config/solana/id.json
  sauce pot list --chain base
```

### `sauce pot list`

```text
List the Pots you deployed or imported, each with the release it was minted under.

Usage: sauce pot list [--chain <slug|id>] [--owner <address>] [--pots <dir>] [--json]

Options:
      --chain <slug|id>  Only the Pots on this chain
      --owner <address>  Only this owner's Pots
      --pots <dir>       The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Lists the Pot store (--pots, default ~/.sauce/pots): every Pot a command on this machine
deployed, and every Pot `sauce pot import` recorded. Each with its chain, address, kind
(private, private-fixed-router or shared), owner and salt; the Kitchen and the release it
was minted under: the compiler whose programs it runs, and the engine and Kitchen
versions, with the engine's address; and the transaction that deployed it. It reads no
chain: what a Pot holds, and whether it is still there, `sauce pot --rpc-url` reads.

Examples:
  sauce pot list
  sauce pot list --chain base --owner 0x… --json
```

### `sauce pot import`

```text
Record a Pot deployed elsewhere, read from the chain with the release that minted it.

Usage: sauce pot import --chain <slug|id> --pot <address> [options]
       sauce pot import --chain <slug|id> --owner <address> [--salt <label> | --salt-hex <bytes32>] [options]

Options:
      --chain <slug|id>     The chain the Pot is on
      --owner <address>     Or its owner, with the salt (default 0): every release's Pot of theirs there
      --salt <label>        Name one of the owner's Pots: salt = keccak256(label)
      --salt-hex <bytes32>  …or give its salt exactly
      --rpc-url <url>       Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>       Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline             Read no chain: no endpoint, not even a built-in one
      --pots <dir>          The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)
      --json                Print one JSON object instead
  -h, --help                Show this help
      --no-update-check     No notice of a newer sauce, and no registry read for one

EVM chains only:
      --pot <address>  The Pot, by address

Records in the Pot store (--pots, default ~/.sauce/pots) a Pot this machine did not
deploy: one deployed from another machine, through another wallet, or before the store
existed. It reads the chain, and records only what it finds there.

With --pot, the Pot is read for its owner, salt and Kitchen, and its release told from its
address: the one whose Kitchen and Pot init-code hash give that address for that owner and
salt, for each kind of Pot. An address no release this sauce knows mints is refused. With
--owner (and --salt or --salt-hex; default zero), every release's Pot of that owner and
salt that has code is recorded. A Solana Pot holds nothing that names its owner, so there
it is found by --owner and its salt: the Kitchen's account for them, and its engine the
program that owns it. A Pot already recorded keeps its record.

Examples:
  sauce pot import --chain base --pot 0x…
  sauce pot import --chain base --owner 0x… --salt treasury
  sauce pot import --chain solana --owner <pubkey>
```

## `sauce globals`

```text
List the tokens, protocols and other names a program on a chain can use.

Usage: sauce globals --chain <slug|id> [--tokens] [--protocols] [--protocol <name>] [--stocks] [--search <text>] [--json]

Options:
      --chain <slug|id>  The chain whose names to list
      --tokens           Only the token symbols
      --protocols        Only the protocol namespaces
      --protocol <name>  One namespace (UniswapV4, or its slug) with its methods
      --stocks           Only the chain's tokenized stocks
      --search <text>    Only the tokens, stocks included, whose symbol, name or ticker contains the text
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Every name a program compiled for the chain may use without declaring it, from the SDK's
registries (routes.sourceGlobals) — the ones the compile resolves: token symbols with
their addresses and decimals, protocol namespaces with each contract's address (and,
with --protocol, its methods), the chain names, the defines, and the
zero-import @sauce/token functions. With no filter it lists everything but the chain's
tokenized stocks, which it counts: Ethereum and Solana have over a thousand each. A stock
token is named like any other (SPCXc.balanceOf(...), balanceOf(TSLAx, account) on
Solana); --stocks lists them with what each one is, and --search finds one by symbol,
company name or ticker.

Examples:
  sauce globals --chain base
  sauce globals --chain base --protocol UniswapV3 --json
  sauce globals --chain base --search spacex
```

## `sauce price`

```text
Turn a price into a pool's sqrtPriceX96 and a swap's limits, priceLimit included.

Usage: sauce price --chain <slug|id> <price> <quote> per <base> [--offline] [--json]
       sauce price --chain <slug|id> <base> <quote> (<price> | --sqrt-price-x96 <value>) [--json]
       sauce price --chain <slug|id> <base> <quote> --pool <address> [--json]

Options:
      --chain <slug|id>         The chain the pool is on
      --sqrt-price-x96 <value>  Read a pool's sqrtPriceX96 as a price instead
      --pool <address>          Read the price from this V3-style pool of the pair now (needs an endpoint)
      --rpc-url <url>           Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>           Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline                 Read no chain: no endpoint, not even a built-in one
      --json                    Print one JSON object instead
  -h, --help                    Show this help
      --no-update-check         No notice of a newer sauce, and no registry read for one

`2700 USDC per WETH` says it in words: 2,700 USDC for one WETH. The same price is
`WETH USDC 2700`: <base> <quote> <price>, the price how many <quote> tokens one <base> is
worth. A token is a symbol the chain registers (sauce globals --tokens), or an address with
its decimals (0x…:18); with an endpoint, an address alone, its decimals read from the
token. The first line says what the price means, both ways round
(1 WETH = 2700 USDC, 1 USDC = 0.00037… WETH). Then the pool's sqrtPriceX96 at that price,
for the pair's order on the chain (token0 is the lower address), and for each direction
(selling the base token, then buying it):
  sqrtPriceLimitX96  the same number as a swap's limit: a floor when selling token0, a
                     ceiling when selling token1
  priceLimit         input units paid per output unit bought, times 1e18, rounded down:
                     the price times 10^(18 + input decimals - output decimals), the
                     distributed swap's priceLimit, as sauce pools prints it
  maxAvgPrice        the same number, as the distributed swap's maxAvgPrice
  minAvgPrice        the other way round, output units received per input unit times
                     1e18, rounded up, for a check out * 1e18 >= minAvgPrice * spent
Uniswap V3 and V4 and their forks share this price. With --sqrt-price-x96, a pool's
price is read back the other way. With --pool, it is read from that pool of the pair now:
a Uniswap V3, PancakeSwap V3 or Aerodrome Slipstream pool (sauce pools lists them), named
by its venue when the registry's factory made it.

It also reads the pair's price now, from its deepest Uniswap V3 pool on the chain, and
warns when the price given is 10x or more away from it, saying so when the price looks
written the wrong way round. With --offline, nothing reaches a network.

Examples:
  sauce price --chain base 2700 USDC per WETH
  sauce price --chain base 2700 USDC per WETH --offline
  sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568
  sauce price --chain base SPCXc USDC --pool 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E
```

## `sauce pools`

```text
List a pair's price-limit pools on a chain, deepest first, with their prices.

Usage: sauce pools --chain <slug|id> <token> <token> [--v4-key <fee:spacing>]… [--block <number|tag>] [--json]
       sauce pools --chain solana <pay token> <buy token> [--pay <token> [--price-limit <n>] [--per-venue] [--slots <n>]] [--json]

Options:
      --chain <slug|id>  The chain the pools are on
      --rpc-url <url>    Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>    Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline          Read no chain: no endpoint, not even a built-in one
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

EVM chains only:
      --v4-key <fee:spacing>  Also try this hookless Uniswap V4 pool key (3000:60)
      --block <number|tag>    Read the pools at this block: a number, or latest, safe, finalized (default: latest)

Solana only:
      --pay <token>      Choose the pools a distributed swap paying this token takes, and print their slots' accounts
      --price-limit <n>  With --pay: only pools whose price with the fee is within this priceLimit
      --per-venue        With --pay: the deepest pool of each venue only
      --slots <n>        With --pay: how many slots the program has (default 4)

Every pool of the pair at the price-limit venues the registry records on the chain:
Uniswap V3 and PancakeSwap V3 at each fee tier their factory enables, Aerodrome Slipstream
at each tick spacing of each of its CLFactories, and hookless Uniswap V4 pools at the keys
100:1, 500:10, 3000:60 and 10000:200, and any --v4-key. A token is a symbol the chain
registers (sauce globals --tokens), or an address: its decimals and symbol are read from
the token (or give them, 0x…:8).

Pools with liquidity come first, deepest first: by the liquidity at each pool's price,
which is in the same units at every venue for one pair. For each: the venue and the
contract a program finds it through, its address (a V4 pool's id and key), its fee read
from the pool (a V4 pool's LP fee and protocol fee, from StateView), tick spacing,
liquidity, tick and sqrtPriceX96, and both ways round: what one token costs in the other
before and with the fee, the distributed swap's priceLimit at that price (pay base units per
buy base unit times 1e18: the price times 10^(18 + pay decimals - buy decimals)), and about
how much of the paid token, fee included, moves the price 1% against the taker, walked
through the pool's ticks. Pools with no liquidity at their price are listed after them, as
skipped. Then what was looked at.

It reads the chain in five requests, each one eth_call for every read in it, all at one
block, which it names: --block, or the latest when it starts. Pass that block to sauce
simulate --block to run on the prices priceLimit was taken from.

On Solana: every pool of the pair at each venue whose swap takes a price limit that stops
it (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper,
DefiTuna, Crema, and Phoenix's markets), found with getProgramAccounts on each venue's
program. For each: its fee, liquidity and price both ways with the fee and as a swap's
priceLimit, how a program finds it by key (Orca.Whirlpool.pool(USDC, WSOL, 4)) where its
venue finds pools by key, and its slot paying each token: the nine accounts a swap at it
takes (program, pool, config, the two vaults, one more account its swap takes, three tick
arrays), each unused one the System program. A pool the distributed swap skips is listed as
skipped with why. A token is a symbol the chain registers (SOL for WSOL), or a mint. --pay
chooses the pools a swap paying that token takes (within --price-limit, one a venue with
--per-venue, --slots of them) and prints them in slot order for main's --args (the System
program for a slot with none), and their slots as accounts. A venue it could not read leaves
the listing partial: a note says which, and the command exits 1.

Examples:
  sauce pools --chain base USDC WETH
  sauce pools --chain base USDC 0x… --json
  sauce pools --chain base WETH USDC --v4-key 50:1
  sauce pools --chain solana USDC WSOL --json
  sauce pools --chain solana USDC WSOL --pay USDC --price-limit 119047619047619047 --per-venue --slots 5 --json
```

## `sauce inspect`

```text
Take a cook, a Kitchen call, a program or a file apart.

Usage: sauce inspect <hex | tx-hash | file | -> [--chain <slug|id>] [--source <file | ->] [options]

Options:
      --chain <slug|id>   Chain the program runs on (base, 8453, solana)
      --target <evm|svm>  Checked against the chain; svm alone means solana
      --compact-args      Take main's arguments as compact-v1, not ABI-v1
      --source-dir <dir>  Resolve the program's relative imports here (default: beside it; from stdin, .)
      --source <file>     The program a cook was compiled from: decode its arguments
      --rpc-url <url>     Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>     Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline           Read no chain: no endpoint, not even a built-in one
      --json              Print one JSON object instead
  -h, --help              Show this help
      --no-update-check   No notice of a newer sauce, and no registry read for one

Low-level (a program's inputs are main's parameters, given with --args):
      --define NAME=VALUE    A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana
      --defines <file.json>  Compile-time values from a JSON object of NAME to value; --define wins

Reads what a SauceScript author wrote back out of bytes: a Pot.cook (its engine and its
program), a Kitchen.deployPot (the Pot it makes), an ERC-20 call, or a bare program. A
32-byte hash with --chain (or --rpc-url) is a transaction, fetched first. With --source, a
cook's program is checked against that file's and the arguments after it are decoded
against its main. A file operand is compiled and reported. No opcode listing: programs are
reported by size and hash.

Examples:
  sauce inspect 0x… --chain base --source split.sauce.ts
  sauce inspect 0x<tx hash> --chain base
  sauce inspect buy.sauce.ts --chain base
```

## `sauce verify`

```text
Check that a payload or cook runs the audited settle program.

Usage: sauce verify <payload | calldata | tx-hash> [--pin <hash:bytes>]… [--engine <address>]… [--chain <slug|id>]

Options:
      --pin <hash:bytes>  Also accept this historical settle program (keccak256:length)
      --engine <address>  Also accept a cook on this engine, besides the released one
      --chain <slug|id>   The chain a transaction hash is on
      --min-out <amount>  Solana: the floor the settle must enforce on its first escrow
      --spl-count <n>     Solana: how many escrows the settle sweeps with its first token program
      --rpc-url <url>     Your own RPC endpoint for the chain (default: a built-in public one)
      --config <file>     Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }
      --offline           Read no chain: no endpoint, not even a built-in one
      --json              Print one JSON object instead
  -h, --help              Show this help
      --no-update-check   No notice of a newer sauce, and no registry read for one

Takes a settle payload, Pot.cook calldata, or — with an --chain — a transaction hash, and
checks the settle it carries with the SDK's validateSettleProgram: the program must hash
to the current pin (or a --pin), and its arguments must be the one canonical encoding.
Prints tokens, minOut and recipient. A cook must name the released engine (or an
--engine). A rejection exits 1 with its code: the SDK's SettleFailureCode, or
UNKNOWN_ENGINE.

On Solana (--chain solana and a transaction signature): an SVM settle's
floor and split are compiled into it, so give them, --min-out and --spl-count. The
engine invocation the cook made is checked by the SDK's verifySvmSettleExecution against
the settle recompiled for those values; a rejection is NO_SETTLE or NOT_GENUINE.

Examples:
  sauce verify 0x<payload>
  sauce verify 0x<tx hash> --chain base --pin 0x…:435
  sauce verify <signature> --chain solana --min-out 0 --spl-count 1
```

## `sauce skills`

```text
Install, update or check this package's agent skills in a project.

Usage: sauce skills <install | update | status> [--agent <agent>,…] [--dir <project>] [--force]

Options:
      --agent <agent>    claude, codex, cursor, copilot, gemini, agents-md or all (default: all)
      --dir <project>    The project (default .)
      --force            update: overwrite files edited since they were installed
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

The skills ship once, as Agent Skills directories, and are written where agents read
them: .claude/skills/ (claude) and .agents/skills/ (codex, cursor, copilot, gemini), which
between them reach all five. That is the default, and what --agent all means; an agent
named alone gets the one it reads. --agent agents-md, only when asked for, also writes an
index of the skills into a block of AGENTS.md, for a tool that reads that file but no
skills directory. update and status take the targets installed.

Each skills directory also gets tsconfig.json, the SauceScript project sauce init
<dir> --tsconfig writes, so an editor types the skills' example programs. It is installed,
updated and reported like a skill file.

  install  The first install. Never overwrites: on a project already installed it says
           whether the skills are current, and to run update if not.
  update   Adds new skill files, replaces changed ones, removes retired ones. A file edited
           since it was installed is kept and shown, unless --force.
  status   Each target: up to date, outdated or modified, with its files. Exits 1 while
           any is outdated or not installed.
```

## `sauce update`

```text
Update this sauce command, the way it was installed.

Usage: sauce update [--check] [--version <version|tag>] [--json]

Options:
      --check                  Say which version is installed and which an update installs; install nothing
      --version <version|tag>  The version or dist-tag to install (default: latest)
      --json                   Print one JSON object instead
  -h, --help                   Show this help
      --no-update-check        No notice of a newer sauce, and no registry read for one

Updates the copy of the package this sauce runs from, the way it was installed, which its
own path says:
  a global install    npm, pnpm, yarn or bun installs the version globally again, run with
                      no shell (npm with the prefix this copy is under), and the command
                      prints the version before and after
  a project's copy    the project updates it: the command its package manager takes is
                      printed, pinned exactly, and nothing runs
  npx's cache         the npx -y command that runs the latest is printed
  anything else       refused, with npm's global install of it
After a global update, skills installed in the current directory (sauce skills status) are
updated by the NEW sauce, and what changed is printed; and where the version replaced had
its runtime packages installed (sauce runtime), the NEW sauce installs its own.

The version comes from the npm registry, read when this command runs. --check reads it and
installs nothing. Every other command says, on stderr, when its update check has seen a
newer version (sauce --help says how), and suggests this command.

Examples:
  sauce update --check
  sauce update
  sauce update --version 1.2.0
```

## `sauce runtime`

```text
Install or check the packages sauce mcp and Solana simulations load.

Usage: sauce runtime [status] [--json]
       sauce runtime install [--json]

Options:
      --json             Print one JSON object instead
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Two commands load packages a library install of this package leaves out, being its
optional peer dependencies: sauce mcp (the MCP SDK and zod) and a Solana simulation in a
local copy (LiteSVM). Each takes your own copies, where the package resolves them at
exactly the versions it pins; else this version's runtime folder, ~/.sauce/runtime/<version>,
which the first use installs with npm ci from the lockfile the package ships (every package
pinned with its integrity hash), into a temporary directory renamed into place. Other
versions' folders go then, but the newest older one. sauce mcp setup and sauce update
install it ahead of the first use.

  status   Where each command's packages come from, and whether the folder is installed.
  install  Installs the folder now, if it is not; npm reaches the registry your npm
           configuration names.

Examples:
  sauce runtime
  sauce runtime install
```

## `sauce init`

```text
Scaffold a project that uses this package.

Usage: sauce init [<dir>] [--agent <agent>,…] [--force] [--install]
       sauce init <dir> --tsconfig [--force]

Options:
      --agent <agent>    Whose skills to install: claude, codex, cursor, copilot, gemini, agents-md or all
      --force            Overwrite files that already exist with other content
      --install          Run npm install in the project afterwards
      --tsconfig         Write only <dir>/tsconfig.json: an editor's SauceScript project for programs there
  -h, --help             Show this help
      --no-update-check  No notice of a newer sauce, and no registry read for one

Writes package.json (pinning this exact version), AGENTS.md (the project's instructions,
which coding agents read), CLAUDE.md and GEMINI.md importing it for those agents, a
.gitignore for local config, sauce.config.example.json (placeholders only),
programs/tsconfig.json (SauceScript's names, and a plugin, for an editor checking the
programs there: kept apart from the project's other TypeScript), and then
installs the agent skills (`sauce skills install`), for every agent unless --agent names
some. It runs no package manager unless --install, which runs npm install.

--tsconfig writes only <dir>/tsconfig.json, the same SauceScript project as
programs/tsconfig.json, for programs in a project init did not write, or in another
directory: an editor takes a file's nearest tsconfig.json, so every *.sauce.ts under <dir>
gets SauceScript's names and the plugin. Where the project's own tsconfig.json also covers
them, add "exclude": ["**/*.sauce.ts"] there, so its TypeScript does not check them too.

Examples:
  sauce init my-project
  sauce init programs --tsconfig
```

## `sauce mcp`

```text
Serve the commands and the agent skills to coding agents over MCP.

Usage: sauce mcp [--config <file> | --offline] [--wallets <dir> | --no-wallets] [--pots <dir>] [--store <dir>] [--no-stores]
       sauce mcp (--password-env <NAME> | --password-file <path> | --password-command <command>) [--wallets <dir>] [--config <file>]
       sauce mcp --http <port> [--host <address>] [--allowed-host <name>]… [--config <file>]
       sauce mcp setup [--agent <agent>,…] [--dir <project>] [--config <file>] [--force]

Options:
      --config <file>               Your own RPC endpoints: { "rpcUrls": { "<chain id>": "<url>" } } (default: public ones)
      --offline                     Reach no network of its own: no built-in endpoint, and nothing installed
      --http <port>                 Serve Streamable HTTP on this port (0 picks one), instead of stdio
      --host <address>              With --http: the interface to bind (default 127.0.0.1)
      --allowed-host <name>         With --http: a Host it answers besides loopback's; required off loopback ('*': any)
      --max-body <bytes>            The largest message it reads, over either transport (default 2 MiB)
      --allow-private-rpc           With --http: let a caller's rpcUrl be http: or a private address (a private deployment)
      --wallets [<dir>]             Over stdio: the wallet directory its wallet tools serve (default ~/.sauce/wallets)
      --no-wallets                  Over stdio: serve no wallet tools; nothing signs
      --password-env <NAME>         The password is the environment variable NAME (only that one is read)
      --password-file <path>        …or a file only you can read (else it is asked for)
      --password-command <command>  …or what this command prints (a secret manager's CLI)
      --pots <dir>                  Over stdio: keep the Pot store here (default ~/.sauce/pots, as sauce pot list reads)
      --no-stores                   Over stdio: keep none of the command's stores (by default it keeps them, as sauce does)
      --agent <agent>               setup: claude, codex, cursor, copilot, gemini or all (default all)
      --dir <project>               setup: the project (default .)
      --force                       setup: replace a "sauce" entry that differs
  -h, --help                        Show this help
      --no-update-check             No notice of a newer sauce, and no registry read for one

The Sauce MCP server. Every server, over stdio or HTTP, has this command's building half
as tools: sauce_chains, sauce_globals, sauce_price, sauce_pools, sauce_compile,
sauce_actions, sauce_tx, sauce_pot, sauce_reclaim, sauce_simulate, sauce_inspect and
sauce_verify; sauce_send, which broadcasts what the caller signed; the agent skills as
tools (sauce_skills, sauce_skill, sauce_dev, sauce_install_skills) and as resources, at
sauce://skills/<path>; and a prompt, sauce_write_program. Over stdio it also has the
wallet tools and the
store tools (below). No tool takes a key or a password: a transaction comes back unsigned,
for the user's own wallet, or is sent from one of the server's own wallets.

A coding agent starts the server itself, from its MCP configuration. Add it once:
  claude mcp add sauce -- sauce mcp    # Claude Code
  codex mcp add sauce -- sauce mcp     # OpenAI Codex
  gemini mcp add sauce sauce mcp       # Gemini CLI
  sauce mcp setup                      # every project file at once
Claude Desktop (claude_desktop_config.json) and Cursor (.cursor/mcp.json) take the entry
  "sauce": { "command": "sauce", "args": ["mcp"] }
under mcpServers, and VS Code (.vscode/mcp.json) under servers. A desktop client that does
not find `sauce` on its PATH takes the absolute path `which sauce` prints as the command.

Over stdio it serves the wallets of the wallet directory (--wallets, default
~/.sauce/wallets, the one sauce wallet uses; --no-wallets serves none): sauce_wallet_list
and sauce_wallet_address read them with no password, and sauce_wallet_create,
sauce_wallet_import and sauce_wallet_send work once the wallets are enabled. A password
source given here enables them, read once at start: the variable an MCP client's config
passes from the agent's .env, a file, or a command. Without one, the agent enables them
with sauce_wallet_enable, naming where the password comes from (a variable of the
server's environment, a file only you can read, an entry of such a .env file, or a new
random one it writes to a file), never the password itself and never a command. No tool
takes or returns a password or a key. sauce_wallet_send simulates what it is given and
holds it to the wallet's policy (sauce wallet --help) before it sends.
The HTTP server never signs: --wallets and the password flags are refused there, and it
has no wallet tools.

Over stdio it keeps this command's stores as the command does, in the same directories,
for an agent that reaches Sauce only through it: every Pot a tool's transaction deploys
(sauce_send, sauce_wallet_send) is recorded in the Pot store (--pots, default
~/.sauce/pots), which sauce_pot_list and sauce_pot_import read and write, as sauce pot list
and sauce pot import do. The wallet directory
is one of those stores: --no-stores keeps none, and serves no wallet tool. Over HTTP it
keeps nothing, and has none of those tools.

Over stdio by default, what a coding agent launches. With --http, Streamable HTTP at /mcp,
stateless: on 127.0.0.1 unless --host says otherwise, answering only a loopback Host or an
--allowed-host one. It authenticates no one, so off loopback it needs --allowed-host, and
goes behind your own authentication. It reads a chain through a caller's rpcUrl, else
--config's entry for it, else a built-in public endpoint; it reads no environment, and never
shows a URL from the file.

setup adds the server to a project for each agent, in the file its vendor documents:
.mcp.json (claude), .codex/config.toml (codex), .cursor/mcp.json (cursor),
.vscode/mcp.json (copilot) and .gemini/settings.json (gemini), keeping what else each holds.

The server's packages, the MCP SDK and zod, are the package's optional peer dependencies:
your own copies at the versions pinned, else this version's runtime folder (sauce runtime),
which the first start installs, and setup ahead of it. --offline installs nothing, and
reads a chain only through a caller's rpcUrl.

Examples:
  sauce mcp
  sauce mcp --password-env SAUCE_WALLET_PASSWORD
  sauce mcp --http 3000
  sauce mcp setup --agent claude,cursor
```

## Next

- [The sauce command](../guides/cli.md): installing it, and what each command is for.
- [Troubleshooting](../guides/troubleshooting.md): what a command's message means.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.
