/**
 * sauce_pot on Solana against a JSON-RPC endpoint that answers only what the tool asks: the Pot
 * and the Pot's associated token account for each mint the cluster registers. The endpoint holds
 * exactly the accounts a test puts there, so each answer the tool gives is one the test chose. Its
 * cluster is the one its path names (`/devnet`, `/mainnet`), which solana-devnet is held to.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { address } from "@solana/kit";

import {
  V12_RELEASE_SETS,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../../sdk/dist/deployments/index.js";
import { derivePotPda } from "../../sdk/dist/svm/index.js";
import { connect, failed, ok, type Connected } from "./harness.js";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SYSTEM = "11111111111111111111111111111111";
/** `sauce_pot`'s salt when none is given. */
const ZERO_SALT = new Uint8Array(32);
/** Each cluster's genesis hash, by the endpoint path that serves it. */
const GENESIS: Readonly<Record<string, string>> = {
  "/devnet": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "/mainnet": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
/** A program that is no engine of any release: the SPL Token program. */
const FOREIGN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** The program id of v12-svm `version`'s engine, as the release table holds it. */
const engineOf = (version: string): string => {
  const engine = V12_RELEASE_SETS.find((set) => set["v12-svm"].version === version)?.["v12-svm"]
    .engine;
  assert.ok(engine, `the release table holds an engine for v12-svm ${version}`);

  return engine;
};

interface TokenAccount {
  symbol: string;
  mint: string;
  decimals: number;
  account: string;
  exists: boolean;
  balance: string | null;
}

describe("sauce_pot on Solana", () => {
  let server: Server;
  let url: string;
  let mcp: Connected;
  /** The accounts the endpoint holds, with each token account's balance. */
  const present = new Map<string, string | null>();
  /** The Pot's address as the endpoint serves it: an account with its storage, as `create_pot`
   *  leaves it, owned by the installed engine (`"engine"`) or by the program given, or the System
   *  Program's holding lamports and no data. */
  const pots = new Map<string, "engine" | "lamports" | { readonly owner: string }>();
  const asked: string[] = [];

  before(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const call = JSON.parse(body) as { id: number; method: string; params?: [string] };
        const account = call.params?.[0] ?? "";
        asked.push(`${call.method} ${account}`);
        const context = { slot: 1 };
        const held = pots.get(account);
        const programOwning =
          held === "engine"
            ? v12SvmEngineProgramId()
            : typeof held === "object"
              ? held.owner
              : undefined;
        const result =
          call.method === "getGenesisHash"
            ? GENESIS[request.url ?? ""]
            : call.method === "getAccountInfo"
              ? {
                  context,
                  value:
                    programOwning !== undefined
                      ? {
                          data: [Buffer.alloc(10_240).toString("base64"), "base64"],
                          executable: false,
                          lamports: 72_161_280,
                          owner: programOwning,
                          rentEpoch: 0,
                          space: 10_240,
                        }
                      : held === "lamports" || present.has(account)
                        ? {
                            data: ["", "base64"],
                            executable: false,
                            lamports: 2_039_280,
                            owner: SYSTEM,
                            rentEpoch: 0,
                            space: 0,
                          }
                        : null,
                }
              : {
                  context,
                  value: {
                    amount: present.get(account) ?? "0",
                    decimals: 6,
                    uiAmount: null,
                    uiAmountString: "0",
                  },
                };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    url = `http://127.0.0.1:${port}/`;
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads whether the Pot exists, and each registered mint's token account", async () => {
    const empty = ok(await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url }));
    assert.equal(empty.deployed, false);
    const accounts = empty.tokenAccounts as TokenAccount[];
    const usdc = accounts.find((each) => each.symbol === "USDC");
    assert.ok(usdc !== undefined, "USDC is registered on Solana");
    assert.ok(accounts.every((each) => !each.exists && each.balance === null));

    // The Pot, and its USDC account holding 2.5 USDC.
    pots.set(empty.pot as string, "engine");
    present.set(usdc.account, "2500000");
    const held = ok(await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url }));
    assert.equal(held.deployed, true);
    assert.ok((held.notes as string[]).some((note) => /deployed already/.test(note)));
    for (const each of held.tokenAccounts as TokenAccount[]) {
      assert.deepEqual(
        [each.exists, each.balance],
        each.symbol === "USDC" ? [true, "2500000"] : [false, null],
        each.symbol,
      );
    }

    // balances: false reads only whether the Pot exists.
    asked.length = 0;
    const bare = ok(
      await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url, balances: false }),
    );
    assert.equal(bare.deployed, true);
    assert.equal(bare.tokenAccounts, undefined);
    assert.deepEqual(asked, [`getAccountInfo ${String(empty.pot)}`]);
  });

  it("does not call a Pot address that holds only lamports deployed: no engine owns it, and cooks run on it as it is", async () => {
    const bare = { chain: "solana", owner: OWNER, rpcUrl: url, balances: false };
    const before = ok(await mcp.call("sauce_pot", bare));
    // What anyone can do to an owner's Pot address: send it lamports. The Kitchen cooks it as it is.
    pots.set(before.pot as string, "lamports");
    const funded = ok(await mcp.call("sauce_pot", bare));
    assert.equal(funded.deployed, false);
    const notes = funded.notes as string[];
    assert.ok(
      notes.some(
        (note) =>
          note.includes("holds 2039280 lamports and no engine owns it") &&
          note.includes("cooks run on it as it is"),
      ),
      notes.join("\n"),
    );
    assert.ok(!notes.some((note) => /deployed already/.test(note)));
    // Not created, so its deployment is still there to sign, and create_pot tops up the rent.
    assert.deepEqual(funded.instruction, before.instruction);
  });

  it("names the program that owns an existing Pot's account when it is no engine: deployed, with its owner and a note, and no engine of its own", async () => {
    const bare = { chain: "solana", owner: OWNER, rpcUrl: url, balances: false };
    const before = ok(await mcp.call("sauce_pot", bare));
    const pot = before.pot as string;
    // An account at the Pot's address that a program this SDK does not know as an engine owns.
    pots.set(pot, { owner: FOREIGN });
    try {
      const foreign = ok(await mcp.call("sauce_pot", bare));
      assert.equal(foreign.deployed, true);
      assert.equal(foreign.ownerProgram, FOREIGN);
      // No engine owns it, so the engine is the installed one, as for a Pot not created yet.
      assert.equal(foreign.engine, v12SvmEngineProgramId());
      const notes = foreign.notes as string[];
      assert.ok(
        notes.some((note) =>
          note.includes(`account is owned by ${FOREIGN}, which is not an engine this SDK knows`),
        ),
        notes.join("\n"),
      );
    } finally {
      pots.set(pot, "lamports");
    }
  });

  for (const [version, runsCompiler] of [
    ["1.4.0", true],
    ["1.3.0", false],
  ] as const) {
    it(`says which earlier engine owns a Pot of v12-svm ${version}, and where cooks on it run`, async () => {
      const bare = { chain: "solana", owner: OWNER, rpcUrl: url, balances: false };
      const before = ok(await mcp.call("sauce_pot", bare));
      const pot = before.pot as string;
      const owning = engineOf(version);
      pots.set(pot, { owner: owning });
      try {
        const owned = ok(await mcp.call("sauce_pot", bare));
        assert.equal(owned.deployed, true);
        // The owning engine, not the installed one, which a new Pot runs on.
        assert.equal(owned.engine, owning);
        assert.notEqual(owned.engine, v12SvmEngineProgramId());
        assert.equal(owned.ownerProgram, undefined);
        const notes = owned.notes as string[];
        const said = runsCompiler
          ? `is owned by engine ${owning} (v12-svm ${version}): cooks on it run there`
          : `is owned by v12-svm ${version} (${owning}); it is cooked on v12-svm`;
        assert.ok(
          notes.some((note) => note.includes(said)),
          notes.join("\n"),
        );
      } finally {
        pots.set(pot, "lamports");
      }
    });
  }

  it("predicts a Pot on solana-devnet through a devnet endpoint alone, with its create_pot", async () => {
    asked.length = 0;
    const devnet = ok(
      await mcp.call("sauce_pot", {
        chain: "solana-devnet",
        owner: OWNER,
        rpcUrl: `${url}devnet`,
        balances: false,
      }),
    );
    const solana = ok(await mcp.call("sauce_pot", { chain: "solana", owner: OWNER }));
    assert.equal(devnet.chain, "solana-devnet");
    // Devnet is a supported chain: nothing is refused, and the deployment is there to sign.
    assert.equal(devnet.refused, undefined);
    // The release's program ids, the same on every cluster, and so is the Pot's address.
    assert.equal(devnet.engine, v12SvmEngineProgramId());
    assert.equal(devnet.kitchen, v12SvmKitchenProgramId());
    const pda = await derivePotPda(address(v12SvmKitchenProgramId()), address(OWNER), ZERO_SALT);
    assert.equal(devnet.pot, pda.address);
    assert.equal(devnet.pot, solana.pot);
    // The Kitchen's create_pot for the owner and salt: what mainnet's prediction builds, byte for
    // byte, to the release's Kitchen, the owner signing and paying, the Pot written.
    const instruction = devnet.instruction as {
      programAddress: string;
      accounts: Array<{ address: string; role: string }>;
      data: string;
    };
    assert.deepEqual(instruction, solana.instruction);
    assert.equal(instruction.programAddress, v12SvmKitchenProgramId());
    assert.ok(instruction.data.length > 0);
    assert.ok(
      instruction.accounts.some(
        (meta) =>
          meta.address === OWNER && /signer/i.test(meta.role) && /writable/i.test(meta.role),
      ),
      "the owner signs and pays",
    );
    assert.ok(
      instruction.accounts.some(
        (meta) => meta.address === devnet.pot && /writable/i.test(meta.role),
      ),
      "the Pot is written",
    );
    // Read through the devnet endpoint alone: its cluster, then the Pot. Nothing is sent.
    assert.deepEqual(asked, ["getGenesisHash ", `getAccountInfo ${String(devnet.pot)}`]);

    // An endpoint of another cluster is refused, named, before the Pot is read.
    asked.length = 0;
    assert.match(
      failed(
        await mcp.call("sauce_pot", {
          chain: "solana-devnet",
          owner: OWNER,
          rpcUrl: `${url}mainnet`,
        }),
      ),
      /solana-devnet is Solana's devnet cluster, and the endpoint serves mainnet-beta: give a devnet endpoint/,
    );
    assert.deepEqual(asked, ["getGenesisHash "]);
  });
});
