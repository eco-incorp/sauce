/**
 * `sauce simulate` with no key, no deployed Pot and no real balances: the Pot's deployment and the
 * cook rehearsed together, the Pot given balances by state override (`--assume-balance`, a keyless
 * `--fund`), and what the cook did read back from its logs. On a local anvil running the released
 * gated stack (`cli-anvil.ts`), through both routes:
 *
 *   - `eth_simulateV1`, which anvil serves: the deploy and the cook in one simulated block, with the
 *     cook's logs and traced native transfers;
 *   - `eth_call` with state overrides, reached through a proxy that answers `eth_simulateV1` the way
 *     a node without it does: the Pot put in place as `Kitchen.deployPot` deploys it, then the cook.
 *
 * Nothing is ever sent: after every rehearsal the Pot is still not deployed and nobody's balance
 * has moved.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md).
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, getAddress, pad, type Address, type Hex } from "viem";

import { kitchenAddress } from "../src/cli/commands.js";
import { POT_ROUTER_SLOT, probePot } from "../src/cli/rehearse.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import {
  describeEvm,
  FEE,
  fixture,
  jsonOf,
  registered,
  sauce,
  startChain,
  WORKER,
  type LocalChain,
} from "./cli-anvil.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAY = join(HERE, "../../skills/sauce-run/examples/pay.sauce.ts");
/** An owner nobody holds the key of, with nothing: no Pot, no native currency, no tokens. */
const OWNER: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const USDT_CREATION = `${fixture("NoReturnERC20")}${encodeAbiParameters(
  [{ type: "string" }, { type: "string" }, { type: "uint8" }],
  ["Tether USD", "USDT", 6],
).slice(2)}` as Hex;

/** What a rehearsal never asks a node for: anything that sends, signs or changes the chain. */
const WRITES = /^(eth_send|eth_sign|personal_|anvil_|evm_|hardhat_|debug_)/;

/**
 * A JSON-RPC proxy to `upstream` on loopback, for this suite only. It answers `eth_simulateV1` as a
 * node without it does, refuses (and records) any method that writes, and passes the rest through
 * — so a rehearsal through it is shown to have asked for nothing but reads.
 */
async function withoutSimulateV1(
  upstream: string,
): Promise<{ url: string; server: Server; refused: string[] }> {
  const refused: string[] = [];
  const error = (id: unknown, code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const forward = async (call: { id: unknown; method: string }) => {
        if (call.method === "eth_simulateV1") {
          return error(
            call.id,
            -32601,
            "the method eth_simulateV1 does not exist/is not available",
          );
        }
        if (WRITES.test(call.method)) {
          refused.push(call.method);

          return error(call.id, -32601, `the test proxy refuses ${call.method}`);
        }
        const answer = await fetch(upstream, {
          method: "POST",
          headers: { "content-type": "application/json", connection: "close" },
          body: JSON.stringify(call),
        });

        return answer.json();
      };
      const parsed = JSON.parse(body) as
        { id: unknown; method: string } | { id: unknown; method: string }[];
      void (Array.isArray(parsed) ? Promise.all(parsed.map(forward)) : forward(parsed)).then(
        (answer) => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(answer));
        },
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };

  return { url: `http://127.0.0.1:${port}`, server, refused };
}

describeEvm("sauce simulate: no key, no deployed Pot, no real balances", () => {
  let local: LocalChain;
  let proxy: { url: string; server: Server; refused: string[] };
  let work: string;
  let usdc: Address;
  let usdt: Address;
  const pot = getAddress(v12PredictPot(OWNER, `0x${"00".repeat(32)}`) as Address);

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-simulate-e2e-"));
    local = await startChain("ethereum", 9200 + WORKER);
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    usdt = await local.plant(USDT_CREATION, registered(local.chain, "USDT"));
    proxy = await withoutSimulateV1(local.rpcUrl);
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    proxy?.server.close();
    await local?.stop();
  });

  // Every rehearsal through the fallback asked for reads only.
  afterEach(() => expect(proxy.refused).toEqual([]));

  /** Nothing a rehearsal does reaches the chain. */
  const untouched = async (): Promise<void> => {
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
    expect(await local.balanceOf(usdc, RECIPIENT)).toBe(0n);
    expect(await local.balanceOf(usdc, pot)).toBe(0n);
    expect(await local.publicClient.getBalance({ address: OWNER })).toBe(0n);
  };

  const pay = (rpcUrl: string, ...flags: string[]) =>
    sauce(
      "simulate",
      PAY,
      "--chain",
      "ethereum",
      "--owner",
      OWNER,
      "--rpc-url",
      rpcUrl,
      ...flags,
      "--args",
      RECIPIENT,
      "1500000",
    );

  it("rehearses the Pot's deployment and the cook in one eth_simulateV1 block, and shows what moved", async () => {
    const run = await pay(
      local.rpcUrl,
      "--assume-balance",
      "USDC:2",
      "--assume-balance",
      "USDT:2000000n",
      "--json",
    );
    const out = jsonOf(run);
    expect(out).toMatchObject({
      ok: true,
      path: "eth_simulateV1",
      from: OWNER,
      to: pot,
      value: FEE.toString(),
      deployPot: { kitchen: kitchenAddress(), owner: OWNER, salt: `0x${"00".repeat(32)}` },
      gasKind: "used",
      returns: "0x",
    });
    expect(BigInt(out.gas as string)).toBeGreaterThan(21_000n);
    // The balances it assumed, with where each token keeps them: OpenZeppelin's ERC-20 at slot 0,
    // the USDT-shaped fixture after its name, symbol, decimals and totalSupply.
    expect(out.assumed).toEqual([
      expect.objectContaining({
        holder: pot,
        token: usdc,
        symbol: "USDC",
        amount: "2000000",
        layout: "Solidity mapping at slot 0",
      }),
      expect.objectContaining({
        holder: pot,
        token: usdt,
        symbol: "USDT",
        amount: "2000000",
        layout: "Solidity mapping at slot 4",
      }),
      expect.objectContaining({ holder: OWNER, token: "native", amount: FEE.toString() }),
    ]);
    expect(out.transfers).toEqual([
      {
        token: usdc,
        symbol: "USDC",
        decimals: 6,
        kind: "transfer",
        from: pot,
        to: RECIPIENT,
        amount: "1500000",
        formatted: "1.5",
      },
      {
        token: usdt,
        symbol: "USDT",
        decimals: 6,
        kind: "transfer",
        from: pot,
        to: RECIPIENT,
        amount: "1500000",
        formatted: "1.5",
      },
    ]);
    // Traced: the value the owner sends, and the fee the Pot pays the Kitchen.
    expect(out.nativeTransfers).toEqual([
      { from: OWNER, to: pot, amount: FEE.toString(), formatted: "0.000000000000001234" },
      {
        from: pot,
        to: kitchenAddress(),
        amount: FEE.toString(),
        formatted: "0.000000000000001234",
      },
    ]);
    expect(out.balanceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: pot,
          label: "the Pot",
          deltas: [
            expect.objectContaining({ symbol: "USDC", amount: "-1500000" }),
            expect.objectContaining({ symbol: "USDT", amount: "-1500000" }),
          ],
        }),
        expect.objectContaining({
          address: RECIPIENT,
          deltas: [
            expect.objectContaining({ symbol: "USDC", amount: "1500000" }),
            expect.objectContaining({ symbol: "USDT", amount: "1500000" }),
          ],
        }),
        expect.objectContaining({
          address: OWNER,
          label: "owner",
          deltas: [expect.objectContaining({ token: "native", amount: (-FEE).toString() })],
        }),
        expect.objectContaining({
          address: kitchenAddress(),
          label: "Kitchen",
          deltas: [expect.objectContaining({ token: "native", amount: FEE.toString() })],
        }),
      ]),
    );
    await untouched();
  }, 120_000);

  it("prints the route, what it assumed and what moved", async () => {
    const run = await pay(local.rpcUrl, "--assume-balance", "USDC:2", "--assume-balance", "USDT:2");
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const lines = run.stdout.split("\n");
    expect(lines[0]).toMatch(
      new RegExp(`^The cook succeeds from ${OWNER}: gas used \\d+, returns 0x$`),
    );
    expect(run.stdout).toMatch(
      /^Rehearsed with eth_simulateV1 on the state of block \d+; nothing was signed or sent:$/m,
    );
    expect(run.stdout).toContain(
      `  1. Kitchen.deployPot(${OWNER}, 0x${"00".repeat(32)}): Pot ${pot} is not deployed on ethereum yet.`,
    );
    expect(run.stdout).toContain(`  2. the cook, from the owner ${OWNER}`);
    expect(run.stdout).toContain("  the Pot holds 2 USDC: --assume-balance");
    expect(run.stdout).toContain(`  1.5 USDC: ${pot} (the Pot) -> ${RECIPIENT}`);
    expect(run.stdout).toContain(`  ${pot} (the Pot): -1.5 USDC, -1.5 USDT`);
    expect(run.stdout).toContain(`  ${RECIPIENT}: +1.5 USDC, +1.5 USDT`);
    await untouched();
  }, 120_000);

  it("reads main's return as the type it declares, on both routes", async () => {
    const program = join(work, "reads.sauce.ts");
    writeFileSync(
      program,
      [
        "function main(holder: Address): { token: Address, held: Uint256, some: bool } {",
        "  const held = USDC.balanceOf(holder);",
        "  return { token: USDC, held: held, some: held > 0n };",
        "}",
        "",
      ].join("\n"),
    );
    const words = join(work, "words.sauce.ts");
    writeFileSync(
      words,
      "function main(): Uint256[] {\n  const out = new Array(3);\n  out[0] = 1n;\n  out[1] = 22n;\n" +
        "  out[2] = 333n;\n  return out;\n}\n",
    );
    for (const url of [local.rpcUrl, proxy.url]) {
      const run = await sauce(
        ...["simulate", program, "--chain", "ethereum", "--owner", OWNER, "--rpc-url", url],
        ...["--json", "--args", OWNER],
      );
      expect(jsonOf(run)).toMatchObject({
        ok: true,
        returnType: "{ token: Address, held: Uint256, some: bool }",
        returned: { token: usdc, held: "0", some: false },
      });
      const text = await sauce(
        ...["simulate", words, "--chain", "ethereum", "--owner", OWNER, "--rpc-url", url],
      );
      expect(text.stdout).toContain("main returns Uint256[]: [1, 22, 333]");
    }
    // compile --json says what simulate reads it as.
    const compiled = jsonOf(await sauce("compile", words, "--chain", "ethereum", "--json"));
    expect(compiled.returnType).toBe("Uint256[]");
    await untouched();
  }, 120_000);

  it("rehearses on the block --block names, and says which block it ran on", async () => {
    const holder = getAddress("0x00000000000000000000000000000000000b10c4");
    const program = join(work, "held.sauce.ts");
    writeFileSync(
      program,
      "function main(holder: Address): Uint256 {\n  return USDC.balanceOf(holder);\n}\n",
    );
    const at = async (...flags: string[]) =>
      jsonOf(
        await sauce(
          ...["simulate", program, "--chain", "ethereum", "--owner", OWNER],
          ...["--rpc-url", local.rpcUrl, "--json", ...flags, "--args", holder],
        ),
      );
    const before = await local.publicClient.getBlockNumber();
    await local.mint(usdc, holder, 5_000_000n);
    const now = await at();
    expect(now).toMatchObject({ returned: "5000000" });
    expect(BigInt(now.block as string)).toBeGreaterThan(before);
    // Pinned before the mint: every read and the rehearsal see that block's state.
    expect(await at("--block", before.toString())).toMatchObject({
      block: before.toString(),
      returned: "0",
    });
    expect(await at("--block", "latest")).toMatchObject({ returned: "5000000" });
    const bad = await sauce(
      ...["simulate", program, "--chain", "ethereum", "--owner", OWNER],
      ...["--rpc-url", local.rpcUrl, "--block", "yesterday", "--args", holder],
    );
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("--block: 'yesterday' is not a block number or a tag");
  }, 120_000);

  it("falls back to eth_call with state overrides where the endpoint has no eth_simulateV1", async () => {
    const run = await pay(
      proxy.url,
      "--assume-balance",
      "USDC:2",
      "--assume-balance",
      "USDT:2",
      "--json",
    );
    const out = jsonOf(run);
    expect(out).toMatchObject({
      ok: true,
      path: "eth_call",
      fallback: expect.stringContaining("the endpoint did not run eth_simulateV1"),
      deployPot: { owner: OWNER },
      gasKind: "estimated",
      returns: "0x",
    });
    expect(BigInt(out.gas as string)).toBeGreaterThan(50_000n);
    expect(out.transfers).toBeUndefined();
    expect(run.stderr).toContain("eth_call returns no logs");

    // The same program with too little assumed reverts on both routes, for the same reason.
    const short = await Promise.all(
      [local.rpcUrl, proxy.url].map((url) => pay(url, "--assume-balance", "USDC:1", "--json")),
    );
    const reasons = short.map((done) => {
      expect(done.code).toBe(1);

      return (JSON.parse(done.stdout) as { stage: string; reason: string }).reason;
    });
    expect(reasons[0]).toBe(reasons[1]);
    await untouched();
  }, 120_000);

  it("decodes a revert, and a Pot that is not deployed and named by --pot is refused", async () => {
    const refusing = join(work, "refuses.sauce.ts");
    writeFileSync(refusing, 'throw "not today";\n');
    for (const url of [local.rpcUrl, proxy.url]) {
      const run = await sauce(
        "simulate",
        refusing,
        "--chain",
        "ethereum",
        "--owner",
        OWNER,
        "--rpc-url",
        url,
      );
      expect(run.code).toBe(1);
      expect(run.stdout.split("\n")[0]).toBe('The cook reverts: the program threw "not today"');
    }
    const named = await sauce(
      "simulate",
      refusing,
      "--chain",
      "ethereum",
      "--pot",
      pot,
      "--rpc-url",
      local.rpcUrl,
    );
    expect(named.code).toBe(1);
    expect(named.stderr).toContain(
      `Pot ${pot} is not deployed on ethereum, and --pot does not say whose it is`,
    );
  }, 120_000);

  it("gives the Pot native currency with ETH:, and shows it leave", async () => {
    const sends = join(work, "sends.sauce.ts");
    writeFileSync(sends, `function main(to: Address) {\n  evm.call(to, 5n, hex\`\`);\n}\n`);
    const out = jsonOf(
      await sauce(
        "simulate",
        sends,
        "--chain",
        "ethereum",
        "--owner",
        OWNER,
        "--rpc-url",
        local.rpcUrl,
        "--assume-balance",
        "ETH:0.000000000000000007",
        "--json",
        "--args",
        RECIPIENT,
      ),
    );
    expect(out.assumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ holder: pot, token: "native", amount: "7" }),
      ]),
    );
    expect(out.nativeTransfers).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: pot, to: RECIPIENT, amount: "5" })]),
    );
    await untouched();
  }, 120_000);

  it("--fund without a key credits the Pot what the pull would bring, and says so", async () => {
    const run = await pay(
      local.rpcUrl,
      "--fund",
      "USDC:1.5",
      "--assume-balance",
      "USDT:2",
      "--json",
    );
    const out = jsonOf(run);
    expect(out.ok).toBe(true);
    expect(out.assumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          token: usdc,
          amount: "1500000",
          because: "what --fund would pull, credited (no key to sign the pull)",
        }),
      ]),
    );
    expect(run.stderr).toContain(
      `${OWNER} holds 0 of USDC (base units), below the 1500000 --fund USDC:1.5 needs: sauce run would refuse it`,
    );
    expect(run.stderr).toContain("--fund without a key: pulling USDC needs the owner's signature");
    await untouched();
  }, 120_000);

  it("refuses to assume a balance a token does not store", async () => {
    // A token whose balanceOf answers 7 for everyone, whatever its storage holds.
    const computed = "0x5a0Ce00000000000000000000000000000000007" as Address;
    await local.testClient.setCode({ address: computed, bytecode: "0x600760005260206000f3" });
    const run = await pay(local.rpcUrl, "--assume-balance", `${computed}:1n`);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      `no storage slot of ${computed} holds the balance its balanceOf reports`,
    );
  }, 120_000);

  it("puts in place, on the eth_call route, exactly the Pot Kitchen.deployPot then deploys", async () => {
    // Another owner's Pot, labelled, so this one test deploys it for real and compares.
    const owner = getAddress("0x5a0ce00000000000000000000000000000000b0b");
    const salt = potSalt("probe");
    const probed = await probePot(local.publicClient, kitchenAddress(), owner, salt);
    if ("reason" in probed) throw new Error(`the probe reverted: ${probed.reason}`);
    expect(probed.pot).toBe(getAddress(v12PredictPot(owner, salt) as Address));
    expect(await local.publicClient.getCode({ address: probed.pot })).toBeUndefined();

    const deployed = jsonOf(
      await sauce("pot", "--owner", owner, "--chain", "ethereum", "--salt", "probe"),
    );
    await local.send(local.deployer, deployed.to as Address, deployed.data as Hex);
    expect(await local.publicClient.getCode({ address: probed.pot })).toBe(probed.code);
    expect(
      await local.publicClient.getStorageAt({ address: probed.pot, slot: POT_ROUTER_SLOT }),
    ).toBe(pad(probed.router.toLowerCase() as Hex, { size: 32 }));
    expect(await local.publicClient.getTransactionCount({ address: probed.pot })).toBe(1);
  }, 120_000);
});
