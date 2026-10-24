/**
 * The Solana cook tools' `via` and `maxExecutionFee`, against a JSON-RPC endpoint that answers only
 * what building a cook asks: the Kitchen's fee config, a Pot that does not exist, a blockhash, and
 * the token accounts a cook names, there or not as each test chooses.
 * The fee the endpoint holds is the test's, so each refusal and each fee returned is one it chose.
 * Building and signing nothing else, these need no engine: what runs the cook is the SDK's own
 * suites' business (`sdk/test/cli-solana.e2e.test.ts`, `sdk/test/svm/direct-engine.e2e.test.ts`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import {
  address,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
  type Address,
} from "@solana/kit";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { resolveSvmAccountName } from "../../sdk/dist/svm/account-names.js";
import { v12SvmEngineProgramId } from "../../sdk/dist/deployments/index.js";
import { svmEnginePath, svmKitchenPath } from "../../sdk/dist/svm/engine-artifacts.js";
import { connect, failed, ok, type Connected } from "./harness.js";
import { signableBy } from "./wallet-mcp/phantom.js";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const KITCHEN = "SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot";
const FEE = 5_000n;
/** `ExecutionFeeConfig`: its Anchor discriminator, then the fee as a u64 LE. */
const CONFIG = Buffer.from([60, 73, 184, 44, 4, 104, 241, 138, 0x88, 0x13, 0, 0, 0, 0, 0, 0]);
const BLOCKHASH = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn";
/** The release's programs, by address: the packaged binaries. */
const RELEASED: Record<string, Buffer> = {
  [v12SvmEngineProgramId()]: readFileSync(svmEnginePath("mainnet")),
  [KITCHEN]: readFileSync(svmKitchenPath()),
};

const PROGRAM = [
  "function main(",
  "  tokenProgram: Account,",
  "  source: Account<Writable>,",
  "  destination: Account<Writable>,",
  "  authority: Account<Signer>,",
  "  amount: Uint256",
  ") {",
  "  transfer(MINT, tokenProgram, source, destination, authority, amount);",
  "}",
  "",
].join("\n");

const ACCOUNTS = {
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  source: "So11111111111111111111111111111111111111112",
  destination: "SysvarRent111111111111111111111111111111111",
};

describe("the Solana cook tools, through the Kitchen or direct", () => {
  let server: Server;
  let url: string;
  let mcp: Connected;
  const asked: string[] = [];
  /** Whether the token accounts a cook names are on the cluster. */
  let tokenAccountsThere = true;

  before(async () => {
    assert.equal(CONFIG.readBigUInt64LE(8), FEE);
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const call = JSON.parse(body) as { id: number; method: string; params: unknown[] };
        // The release's own engine and Kitchen at their addresses, as a cluster running this release
        // holds them (another loader's account, the program in it): what the command checks first.
        const program =
          call.method === "getAccountInfo" ? RELEASED[call.params[0] as string] : undefined;
        if (program !== undefined) {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: call.id,
              result: {
                context: { slot: 1 },
                value: {
                  data: [program.toString("base64"), "base64"],
                  executable: true,
                  lamports: 1_000_000,
                  owner: "BPFLoader2111111111111111111111111111111111",
                  rentEpoch: 0,
                  space: program.length,
                },
              },
            }),
          );
          return;
        }
        asked.push(call.method);
        const context = { slot: 1 };
        // Every account asked for is the fee config, but for a Pot, which does not exist yet: a
        // direct cook asks for no Pot, so a Pot read is the one the Kitchen cook makes.
        const result =
          call.method === "getLatestBlockhash"
            ? { context, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 } }
            : call.method === "getMultipleAccounts"
              ? {
                  context,
                  value: (call.params[0] as unknown[]).map(() =>
                    tokenAccountsThere
                      ? {
                          data: [Buffer.alloc(165).toString("base64"), "base64"],
                          executable: false,
                          lamports: 2_039_280,
                          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                          rentEpoch: 0,
                          space: 165,
                        }
                      : null,
                  ),
                }
              : call.method === "getAccountInfo"
                ? {
                    context,
                    value:
                      asked.filter((method) => method === "getAccountInfo").length === 1
                        ? {
                            data: [CONFIG.toString("base64"), "base64"],
                            executable: false,
                            lamports: 1_000_000,
                            owner: KITCHEN,
                            rentEpoch: 0,
                            space: 16,
                          }
                        : null,
                  }
                : null;
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

  const tx = (extra: Record<string, unknown>) =>
    mcp.call("sauce_tx", {
      source: PROGRAM,
      chain: "solana",
      defines: { MINT: OWNER },
      owner: OWNER,
      accounts: { ...ACCOUNTS, authority: "owner" },
      args: ["400"],
      rpcUrl: url,
      ...extra,
    });

  it("via engine builds the engine's own cook: the fee it read, and no Pot", async () => {
    asked.length = 0;
    const out = ok(await tx({ via: "engine", maxExecutionFee: FEE.toString() }));

    assert.equal(out.via, "engine");
    assert.equal(out.fee, FEE.toString());
    assert.equal(out.maxExecutionFee, FEE.toString());
    assert.equal(out.pot, undefined);
    assert.match(out.transaction as string, /^[A-Za-z0-9+/=]+$/);
    // The fee config, read once; no Pot is looked up.
    assert.equal(asked.filter((method) => method === "getAccountInfo").length, 1);
  });

  it("refuses a fee above maxExecutionFee, either way, building nothing", async () => {
    for (const via of ["kitchen", "engine"]) {
      asked.length = 0;
      const refused = failed(await tx({ via, maxExecutionFee: (FEE - 1n).toString() }));

      assert.match(refused, new RegExp(`the execution fee is ${FEE} lamports, above`));
      assert.ok(!asked.includes("getLatestBlockhash"), "nothing was built");
    }
  });

  it("refuses the Pot as a signer on the direct path", async () => {
    const refused = failed(
      await tx({ via: "engine", accounts: { ...ACCOUNTS, authority: "pot" } }),
    );

    assert.match(refused, /nothing signs for the Pot/);
  });

  it("sizes either cook in sauce_compile, the direct one smaller", async () => {
    const compile = (via?: string) =>
      mcp.call("sauce_compile", {
        source: PROGRAM,
        chain: "solana",
        defines: { MINT: OWNER },
        args: ["400"],
        accounts: { ...ACCOUNTS, authority: "owner" },
        ...(via === undefined ? {} : { via }),
      });
    const kitchen = ok(await compile()).cook as { size: number; via: string };
    const direct = ok(await compile("engine")).cook as { size: number; via: string };

    assert.equal(kitchen.via, "kitchen");
    assert.equal(direct.via, "engine");
    assert.ok(direct.size < kitchen.size, `${direct.size} < ${kitchen.size}`);
  });

  it("fills every account the token methods added, from the owner, the Pot and args", async () => {
    const to = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    asked.length = 0;
    const out = ok(
      await mcp.call("sauce_tx", {
        source: "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
        chain: "solana",
        owner: OWNER,
        args: [to, "400"],
        rpcUrl: url,
      }),
    );
    const transaction = getTransactionDecoder().decode(
      new Uint8Array(Buffer.from(out.transaction as string, "base64")),
    );
    const keys = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    ).staticAccounts;
    const named = {
      chain: requireChain("solana"),
      owner: address(OWNER),
      pot: address(out.pot as string),
    };
    for (const derivation of ["authority:USDC", "@to:USDC"]) {
      const { value } = await resolveSvmAccountName(derivation, {
        ...named,
        args: { to: address(to) },
      });
      assert.ok(keys.includes(value as Address), `${derivation} is attached`);
    }
    // With no arguments there is nothing to derive the recipient's account from.
    asked.length = 0;
    assert.match(
      failed(
        await mcp.call("sauce_tx", {
          source:
            "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
          chain: "solana",
          owner: OWNER,
          rpcUrl: url,
        }),
      ),
      /takes 2 arguments/,
    );
  });

  it("creates a token account the token methods name that is not there yet, first", async () => {
    const to = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    asked.length = 0;
    tokenAccountsThere = false;
    try {
      const out = ok(
        await mcp.call("sauce_tx", {
          source:
            "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
          chain: "solana",
          owner: OWNER,
          args: [to, "400"],
          rpcUrl: url,
        }),
      ) as { step: string; transactions: Array<{ what: string }>; transaction?: string };
      // The plan's setup, the owner paying the rent; the cook comes in the step after.
      assert.equal(out.transaction, undefined);
      assert.equal(out.step, "setup");
      assert.deepEqual(
        out.transactions.map((tx) => tx.what),
        ["creating the token accounts"],
      );
    } finally {
      tokenAccountsThere = true;
    }
  });

  it("hands the owner a transaction a wallet's send tool signs: fee payer first, its signature empty", async () => {
    const to = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    const source =
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n";
    asked.length = 0;
    const cook = ok(
      await mcp.call("sauce_tx", {
        source,
        chain: "solana",
        owner: OWNER,
        args: [to, "400"],
        rpcUrl: url,
      }),
    ) as { feePayer: string; transaction: string };
    assert.equal(cook.feePayer, OWNER);
    // A versioned transaction the owner alone signs: no key of anyone else's is needed.
    assert.deepEqual(await signableBy(cook.transaction, OWNER), { version: 0, presigned: 0 });
    // A plan's step, the same, each transaction of it.
    asked.length = 0;
    tokenAccountsThere = false;
    try {
      const plan = ok(
        await mcp.call("sauce_tx", {
          source,
          chain: "solana",
          owner: OWNER,
          args: [to, "400"],
          rpcUrl: url,
        }),
      ) as { transactions: Array<{ feePayer: string; transaction: string }> };
      assert.ok(plan.transactions.length > 0);
      for (const tx of plan.transactions) {
        assert.equal(tx.feePayer, OWNER);
        await signableBy(tx.transaction, OWNER);
      }
    } finally {
      tokenAccountsThere = true;
    }
  });

  it("fills every account the program writes where it uses it: a pda from its seeds and args", async () => {
    const program = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    asked.length = 0;
    const out = ok(
      await mcp.call("sauce_tx", {
        source:
          "function main(program: Address, amount: Uint256) {\n" +
          "  svm.call(Solana.account(program), [\n" +
          '    Solana.pda(program, ["state", Solana.owner]).writable(),\n' +
          "    Solana.systemProgram,\n" +
          "  ], amount.toBytesLe(8));\n}\n",
        chain: "solana",
        owner: OWNER,
        args: [program, "400"],
        rpcUrl: url,
      }),
    );
    const transaction = getTransactionDecoder().decode(
      new Uint8Array(Buffer.from(out.transaction as string, "base64")),
    );
    const keys = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    ).staticAccounts;
    const [state] = await getProgramDerivedAddress({
      programAddress: address(program),
      seeds: [new TextEncoder().encode("state"), getAddressEncoder().encode(address(OWNER))],
    });
    for (const key of [state, program, "11111111111111111111111111111111"]) {
      assert.ok(keys.includes(key as Address), `${key} is attached`);
    }
  });

  it("refuses another account in a slot derived from the Pot, through accounts, building nothing", async () => {
    const source =
      "function main(): Uint256 {\n" +
      "  svm.call(Solana.systemProgram, [pot.signer()], hex`00`);\n" +
      "  return pot.USDC + pot.balance;\n}\n";
    for (const tool of ["sauce_tx", "sauce_simulate"]) {
      for (const [name, given] of [
        ["pot", OWNER],
        ["pot", "owner"],
        ["potUSDC", "owner:USDC"],
      ] as const) {
        asked.length = 0;
        const refused = failed(
          await mcp.call(tool, {
            source,
            chain: "solana",
            owner: OWNER,
            accounts: { [name]: given },
            rpcUrl: url,
          }),
        );
        assert.match(
          refused,
          new RegExp(
            `^accounts ${name}=${given}: the account ${name} is derived from the Pot, as ` +
              `${name === "pot" ? "pot" : "pot:USDC"} \\(`,
          ),
        );
        assert.ok(!asked.includes("getLatestBlockhash"), `${tool} built nothing`);
      }
    }
    // The Pot itself, by role, is its own slot: the cook is built.
    asked.length = 0;
    const out = ok(
      await mcp.call("sauce_tx", {
        source: "function main(): Address {\n  return pot;\n}\n",
        chain: "solana",
        owner: OWNER,
        accounts: { pot: "pot" },
        rpcUrl: url,
      }),
    );
    assert.equal(typeof out.pot, "string");
  });

  it("refuses via and maxExecutionFee on an EVM chain", async () => {
    for (const extra of [{ via: "engine" }, { maxExecutionFee: "5000" }]) {
      const refused = failed(
        await mcp.call("sauce_tx", {
          source: "function main() {}\n",
          chain: "base",
          owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          ...extra,
        }),
      );

      assert.match(refused, /is for a Solana cook/);
    }
  });
});
