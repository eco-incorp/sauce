# Your first agent session

**Tutorial** · [Documentation](../README.md) · [Quick start](quick-start.md) · [The MCP server](mcp.md)

> Coding agents such as Claude Code can write Sauce programs for you, if they have the right tools.
> You are going to give your agent those tools, then watch it write a program, compile it and try it
> on a copy of Base. Nothing is signed, nothing is sent, and no money moves.

An **MCP server** is a plugin for a coding agent: the agent calls its tools the way you call
commands. `sauce mcp` is Sauce's, and its tools are the `sauce` command's own commands under other
names. This page adds it to Claude Code and has the agent run two of them. It takes about ten
minutes.

## You will need

- No funds, no wallet and no account with an RPC provider: nothing is signed or sent, and this page
  never asks for a key.
- [Node.js](https://nodejs.org) 24 or newer (`node --version` tells you).
- [Claude Code](https://code.claude.com), signed in. Another agent works too: add the server to it
  by the [agent's own steps](mcp.md#add-the-server-to-your-agent), then carry on from step 3.
- The `sauce` command and the idea of a **Pot**, your own account that runs programs, and of
  **simulating**, a free dry run: the [Quick start](quick-start.md) covers both, and the
  [glossary](../concepts/glossary.md) names the rest.

## You will have

- Sauce's tools connected to your agent.
- A program your agent wrote, compiled for Base.
- A simulation of it that passes, and one that is refused, each with the reason.
- A clear picture of where the agent's reach ends: it can build a transaction, and only you can
  sign it.

## 1. Install the command

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

The server's own packages, the MCP SDK and `zod`, are not part of that install. Add them now, so
the agent's first start does not wait for them:

```sh
sauce runtime install
```

## 2. Add the server to Claude Code

Claude Code keeps a server for the folder it was added in. Make the folder this tutorial works in,
and add the server there:

```sh
mkdir sauce-tutorial && cd sauce-tutorial
claude mcp add sauce -- sauce mcp
```

That stores the server in `~/.claude.json`, for this folder only. To have it in every folder, add
`--scope user` after `add`. Claude Code starts `sauce mcp` itself, whenever it needs it; you never
run it. Check that it is there:

```sh
claude mcp list
```

`sauce` shows as connected. Start Claude Code in the same folder with `claude`, and inside the
session `/mcp` lists the same.

## 3. See the tools

Ask the agent:

```text
List the sauce_ tools you can use.
```

It names 35 of them, among them `sauce_skills`, `sauce_globals`, `sauce_compile`, `sauce_simulate`
and `sauce_tx`. Each is a `sauce` command: `sauce_compile` is `sauce compile`, and the agent gives
it what you would type. Four of them, starting with `sauce_skills`, hand the agent the instructions
for writing Sauce programs, so it learns the language from the server and needs nothing installed
in your project.

## 4. Have it write, compile and simulate a program

Ask:

```text
Using the Sauce tools, write a program for Base that pays USDC from the Pot. Take the recipient
and the amount as main's arguments, and first require that the Pot holds at least the amount, with
the message "not enough USDC". Compile it, then simulate paying 1 USDC to
0x000000000000000000000000000000000000dEaD with 5 USDC in the Pot.
```

Claude Code may ask your leave before it first calls each tool. Say yes: none of the tools used
here signs or sends anything. Then watch what it does. Its order may vary, but these calls are the
ones to look for:

1. It reads a skill, with `sauce_skills` and `sauce_skill`, to learn the language.
2. It calls `sauce_globals` for Base, to find the names a program may use: `USDC` is one, so the
   program contains no token address.
3. It writes a short program: a `main` function that takes the recipient and the amount, checks
   the Pot's USDC with `require`, and calls `USDC.transfer`.
4. It calls `sauce_compile`. If the compiler finds a mistake, the agent reads the message and fixes
   the line it names.
5. It calls `sauce_simulate` with the two arguments in `args` and `assumeBalance: ["USDC:5"]`,
   which pretends the Pot holds 5 USDC for this one simulation.

Its own words differ from run to run. The end of it should say the cook succeeds, that 1 USDC moved
from the Pot to the address, and that 4 USDC are left in the Pot. The server reads Base through a
public endpoint. If that one is busy and the call fails, ask the agent to try again.

## 5. Make it fail

Ask:

```text
Simulate it again, with only 0.5 USDC in the Pot.
```

This time the tool call comes back marked as an error: a cook that reverts is an error result, so
Claude Code shows the call as failed. What it returned still says what happened: `reverted: true`,
`ok: false`, and the reason `not enough USDC`, the message of the program's `require`. That is what
a real run would do: stop, and move nothing. Nothing was sent either time, because
`sauce_simulate` has no way to send.

## 6. See that the tools are the command

Ask:

```text
Save the program as pay.sauce.ts. In its header, put the sauce simulate command that repeats your
first simulation, with --assume-balance USDC:5 and the same --args.
```

Run that `sauce simulate` line yourself in a terminal, with any address as `--owner` if it asks for
one. It prints the same outcome the tool gave the agent: the cook succeeds, 1 USDC moves, and 4
USDC are left in the Pot. That is because the server calls the very functions the command does.
The program the agent wrote is an ordinary file, and everything the agent did, you can do by hand.

## What just happened

Claude Code started `sauce mcp` and talked to it over its standard input and output, called
[stdio](../concepts/glossary.md#coding-agents).
The agent used the server's tools to look up names, compile and simulate. The server answered with
data, and every transaction it could build comes back **unsigned**, for a wallet you control. Only a
local server that you have given wallets can sign, and only after you enable them: that is in
[What a local server keeps](mcp-local.md). The safest way to sign real money is your wallet's own
MCP server: [Sign with your wallet's MCP server](wallet-mcp.md).

## Next

- Next tutorial: none. Your agent can now do everything the earlier tutorials did, by asking.
  Pick one to go deeper by hand, such as [Your first cross-chain intent](first-intent.md).
- What Sauce is and why a Pot runs the program: [What Sauce is](../concepts/what-is-sauce.md).
- Every tool, its inputs and what it returns: [The MCP server's tools](mcp-tools.md).
- Other agents, your own endpoints and a server for a team: [The MCP server](mcp.md).
- The handbooks the agent reads: [Agent skills](skills.md).
