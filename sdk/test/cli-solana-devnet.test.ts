/**
 * `solana-devnet` and `solana-testnet` through the `sauce` command, in process: every Solana path
 * acts for the chain the user named. Each is a supported chain, so transaction commands reach the
 * endpoint and check its released programs before building or sending; `compile` and reads say the
 * chain. Each one's endpoint must serve its cluster: `solana-devnet` against another cluster's is
 * refused, naming the cluster it serves, and `solana-testnet` likewise (a devnet endpoint included,
 * though the two run one engine build), while `solana` against a devnet endpoint works as it always
 * did. A devnet or testnet Pot is one record in the Pot store, under Solana's chain and its cluster,
 * whichever chain recorded it or reads it back.
 */
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAddressDecoder, type Address } from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { planChain } from "../src/cli/wallet-send.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/kitchen.js";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const LOCAL_GENESIS = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn";

const OWNER = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const PROGRAM = "function main(): Uint256 {\n  return 1;\n}\n";

/** A Solana endpoint of the cluster `genesis` is, holding `accounts` (each by its owning program)
 *  and nothing else, that keeps every method it is asked. Its URL is its own: the command asks an
 *  endpoint's genesis hash once per process, by URL. */
interface Cluster {
  readonly url: string;
  readonly methods: string[];
  readonly server: Server;
}

async function cluster(
  genesis: string,
  accounts: Readonly<Record<string, string>> = {},
): Promise<Cluster> {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const sent = JSON.parse(body) as unknown;
      const calls = [sent].flat() as Array<{ id: number; method: string; params?: unknown[] }>;
      const answers = calls.map((call) => {
        methods.push(call.method);
        const owner = accounts[String(call.params?.[0])];
        const result =
          call.method === "getGenesisHash"
            ? genesis
            : call.method === "getAccountInfo"
              ? {
                  context: { slot: 1 },
                  value:
                    owner === undefined
                      ? null
                      : {
                          data: ["", "base64"],
                          executable: false,
                          lamports: 1,
                          owner,
                          rentEpoch: 0,
                          space: 0,
                        },
                }
              : undefined;

        return result === undefined
          ? { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not here" } }
          : { jsonrpc: "2.0", id: call.id, result };
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(sent) ? answers : answers[0]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    url: `http://127.0.0.1:${address.port}/${randomBytes(6).toString("hex")}`,
    methods,
    server,
  };
}

let work: string;
let clusters: Cluster[] = [];
const serving = async (
  genesis: string,
  accounts?: Readonly<Record<string, string>>,
): Promise<Cluster> => {
  const made = await cluster(genesis, accounts);
  clusters.push(made);

  return made;
};
const file = (name: string, text: string): string => {
  const path = join(work, name);
  writeFileSync(path, text);

  return path;
};

/** A Solana keypair file as `solana-keygen` writes one: the seed, then the public key. */
function keypair(name: string): string {
  const seed = randomBytes(32);
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }));
  const publicKey = spki.export({ format: "der", type: "spki" }).subarray(-32);

  return file(name, JSON.stringify([...seed, ...publicKey]));
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-solana-devnet-"));
});
afterEach(async () => {
  await Promise.all(
    clusters.map(async (one) => {
      one.server.close();
      await once(one.server, "close");
    }),
  );
  clusters = [];
  rmSync(work, { recursive: true, force: true });
});

async function sauce(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    canAsk: () => false,
    confirm: async () => undefined,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };
  const code = await runCli(argv, io);

  return { code, stdout, stderr };
}

const json = (run: { stdout: string }): Record<string, unknown> =>
  JSON.parse(run.stdout) as Record<string, unknown>;

describe("solana-devnet supports transactions but still requires the released programs", () => {
  it("sauce tx, sauce run and sauce pot --deploy reach the cluster and refuse a missing engine", async () => {
    const devnet = await serving(DEVNET_GENESIS);
    const program = file("main.sauce.ts", PROGRAM);
    const signer = keypair("owner.json");
    const reach = ["--rpc-url", devnet.url];
    const runs = [
      await sauce("tx", program, "--chain", "solana-devnet", "--owner", OWNER, ...reach),
      await sauce(
        ...["run", program, "--chain", "solana-devnet", "--keypair", signer, "--yes"],
        ...reach,
      ),
      await sauce("pot", "--deploy", "--chain", "devnet", "--keypair", signer, ...reach),
    ];
    for (const run of runs) {
      expect(run.code).toBe(1);
      expect(run.stderr).not.toMatch(/preview chain|is refused/);
      expect(run.stderr).toContain(
        `the released engine ${v12SvmEngineProgramId()} is not deployed on solana-devnet`,
      );
    }
    expect(devnet.methods).toContain("getGenesisHash");
    expect(devnet.methods).toContain("getAccountInfo");
    expect(devnet.methods).not.toContain("sendTransaction");
  });
});

describe("still runs on solana-devnet", () => {
  it("compiles, and reports the chain; --target svm alone is still Solana", async () => {
    const compiled = await sauce(
      ...["compile", file("main.sauce.ts", PROGRAM), "--chain", "solana-devnet", "--json"],
    );
    expect(compiled.stderr).not.toMatch(/is refused/);
    expect(compiled.code).toBe(0);
    expect(json(compiled)).toMatchObject({ chain: "solana-devnet" });
    const targeted = await sauce(
      ...["compile", file("svm.sauce.ts", PROGRAM), "--target", "svm", "--json"],
    );
    expect(targeted.code).toBe(0);
    expect(json(targeted)).toMatchObject({ chain: "solana" });
  });

  it("predicts a Pot as solana-devnet's, with its deployment instruction", async () => {
    const mainnet = json(await sauce("pot", "--chain", "solana", "--owner", OWNER));
    const pot = await sauce("pot", "--chain", "solana-devnet", "--owner", OWNER);
    expect(pot.code).toBe(0);
    const predicted = json(pot);
    expect(predicted).toMatchObject({
      chain: "solana-devnet",
      owner: OWNER,
    });
    // The Kitchen's id is the same on every cluster, and so is the Pot's address.
    expect(predicted.pot).toBe(mainnet.pot);
    expect(predicted).toHaveProperty("instruction");
    expect(predicted).not.toHaveProperty("refused");
    expect(mainnet).toMatchObject({ chain: "solana" });
    expect(predicted.instruction).toEqual(mainnet.instruction);
  });

  it("reads a Pot's status through a devnet endpoint", async () => {
    const devnet = await serving(DEVNET_GENESIS);
    const pot = await sauce(
      ...["pot", "--chain", "solana-devnet", "--owner", OWNER, "--rpc-url", devnet.url],
    );
    expect(pot.code).toBe(0);
    expect(json(pot)).toMatchObject({
      chain: "solana-devnet",
      deployment: { pot: { deployed: false } },
    });
    expect(devnet.methods[0]).toBe("getGenesisHash");
    expect(devnet.methods).toContain("getAccountInfo");
  });
});

describe("an endpoint serves the cluster the chain names", () => {
  it.each([
    [MAINNET_GENESIS, "mainnet-beta"],
    [TESTNET_GENESIS, "testnet"],
    [LOCAL_GENESIS, `another cluster, whose genesis hash is ${LOCAL_GENESIS}`],
  ])(
    "refuses solana-devnet against %s's endpoint, naming what it serves, having read nothing else",
    async (genesis, served) => {
      const other = await serving(genesis);
      const refusal =
        `solana-devnet is Solana's devnet cluster, and the endpoint serves ${served}: give a ` +
        "devnet endpoint";
      const runs = [
        await sauce("pot", "--chain", "solana-devnet", "--owner", OWNER, "--rpc-url", other.url),
        await sauce(
          ...["simulate", file("main.sauce.ts", PROGRAM), "--chain", "solana-devnet"],
          ...["--owner", OWNER, "--rpc-url", other.url],
        ),
        await sauce(
          ...["pot", "import", "--chain", "solana-devnet", "--owner", OWNER],
          ...["--rpc-url", other.url, "--pots", join(work, "pots")],
        ),
        await sauce(
          "reclaim",
          "--chain",
          "solana-devnet",
          "--owner",
          OWNER,
          "--rpc-url",
          other.url,
        ),
      ];
      for (const run of runs) {
        expect(run.code).toBe(1);
        expect(run.stderr).toContain(refusal);
        expect(run.stderr).not.toContain(other.url);
      }
      // Its genesis hash, asked once, and nothing more of it.
      expect(other.methods).toEqual(["getGenesisHash"]);
      expect(readdirSync(work)).not.toContain("pots");
    },
  );

  it("takes a devnet endpoint for solana-devnet, and one of any cluster for solana, as always", async () => {
    const devnet = await serving(DEVNET_GENESIS);
    const named = await sauce(
      ...["simulate", file("main.sauce.ts", PROGRAM), "--chain", "solana-devnet"],
      ...["--owner", OWNER, "--rpc-url", devnet.url],
    );
    // Not gated: past the cluster, it reaches the release check, which names the missing engine
    // on the chain the user named.
    expect(named.code).toBe(1);
    expect(named.stderr).not.toMatch(/give a devnet endpoint|is refused/);
    expect(named.stderr).toContain(
      `the released engine ${v12SvmEngineProgramId()} is not deployed on solana-devnet: this ` +
        "SDK's cook cannot run there (the cluster has no such program). Nothing was simulated, " +
        "built or sent",
    );
    expect(devnet.methods).toContain("getAccountInfo");

    // `--chain solana` against a devnet endpoint, as people run devnet today: the cluster is not
    // asked, and the cook reaches it.
    const old = await serving(DEVNET_GENESIS);
    const solana = await sauce(
      ...["simulate", file("main.sauce.ts", PROGRAM), "--chain", "solana"],
      ...["--owner", OWNER, "--rpc-url", old.url],
    );
    expect(solana.code).toBe(1);
    expect(solana.stderr).toContain(
      `the released engine ${v12SvmEngineProgramId()} is not deployed on solana: this SDK's ` +
        "cook cannot run there",
    );
    expect(old.methods).not.toContain("getGenesisHash");
  });
});

describe("a devnet Pot in the Pot store", () => {
  /** A devnet Pot as a `--chain solana` command against devnet recorded it, before solana-devnet. */
  async function recorded(store: string): Promise<{ pot: Address; path: string; text: string }> {
    const kitchen = v12SvmKitchenProgramId() as Address;
    const salt = `0x${"00".repeat(32)}`;
    const { address: pot } = await derivePotPda(kitchen, OWNER, new Uint8Array(32));
    const record = {
      schema: "sauce.pot/1",
      chain: "solana",
      chainId: 1399811149,
      origin: "imported",
      cluster: "devnet",
      pot,
      owner: OWNER,
      salt,
      kind: "private",
      kitchen,
      engine: v12SvmEngineProgramId(),
      sdk: "0.0.0",
      recordedAt: "2026-10-01T00:00:00.000Z",
    };
    const dir = join(store, "1399811149-devnet");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${pot}.json`);
    const text = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(path, text, { mode: 0o600 });

    return { pot, path, text };
  }

  it("is listed through solana-devnet and solana alike, from where it always was", async () => {
    const store = join(work, "pots");
    const { pot, text } = await recorded(store);
    for (const chain of ["solana-devnet", "devnet", "solana"]) {
      const list = await sauce("pot", "list", "--chain", chain, "--pots", store, "--json");
      expect([chain, list.code]).toEqual([chain, 0]);
      expect(json(list).pots).toEqual([JSON.parse(text)]);
    }
    const shown = await sauce("pot", "list", "--chain", "solana-devnet", "--pots", store);
    expect(shown.stdout).toContain(`solana (devnet)  ${pot}  private`);
    // Base's are not it.
    expect(
      json(await sauce("pot", "list", "--chain", "base", "--pots", store, "--json")).pots,
    ).toEqual([]);
  });

  it("is found again by an import through solana-devnet, which writes nothing and moves nothing", async () => {
    const store = join(work, "pots");
    const { pot, path, text } = await recorded(store);
    const devnet = await serving(DEVNET_GENESIS, { [pot]: v12SvmEngineProgramId() });
    const imported = await sauce(
      ...["pot", "import", "--chain", "solana-devnet", "--owner", OWNER],
      ...["--rpc-url", devnet.url, "--pots", store, "--json"],
    );
    expect(imported.code).toBe(0);
    expect(json(imported).pots).toEqual([JSON.parse(text)]);
    expect(imported.stderr).toContain(
      `Pot ${pot} on solana (devnet) was already recorded in ${store}; the record is kept as it was`,
    );
    expect(readdirSync(store)).toEqual(["1399811149-devnet"]);
    expect(readdirSync(join(store, "1399811149-devnet"))).toEqual([`${pot}.json`]);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("is recorded by an import through solana-devnet as solana's, of devnet, and found through solana", async () => {
    const store = join(work, "pots");
    const kitchen = v12SvmKitchenProgramId() as Address;
    const { address: pot } = await derivePotPda(kitchen, OWNER, new Uint8Array(32));
    const devnet = await serving(DEVNET_GENESIS, { [pot]: v12SvmEngineProgramId() });
    const imported = await sauce(
      ...["pot", "import", "--chain", "solana-devnet", "--owner", OWNER],
      ...["--rpc-url", devnet.url, "--pots", store, "--json"],
    );
    expect(imported.code).toBe(0);
    expect(readdirSync(store)).toEqual(["1399811149-devnet"]);
    expect(json(imported).pots).toEqual([
      expect.objectContaining({ chain: "solana", chainId: 1399811149, cluster: "devnet", pot }),
    ]);
    const list = await sauce("pot", "list", "--chain", "solana", "--pots", store, "--json");
    expect(json(list).pots).toEqual(json(imported).pots);
  });
});

describe("a Solana transaction that names no chain", () => {
  it("is sent on the SVM chain given, else on Solana", () => {
    const tx = { kind: "svm" as const, transaction: "AQAB", what: "the cook" };
    expect(planChain([tx]).slug).toBe("solana");
    expect(planChain([tx], requireChain("solana-devnet")).slug).toBe("solana-devnet");
    // One that names its chain is on it, and a chain given otherwise is refused.
    expect(planChain([{ ...tx, chainId: 1399811150 }]).slug).toBe("solana-devnet");
    expect(() =>
      planChain([{ ...tx, chainId: 1399811149 }], requireChain("solana-devnet")),
    ).toThrow("the transactions are for chain 1399811149, not solana-devnet (1399811150)");
  });
});

describe("solana-testnet", () => {
  it("sauce tx and sauce pot --deploy reach a testnet endpoint and refuse a missing engine", async () => {
    const testnet = await serving(TESTNET_GENESIS);
    const program = file("main.sauce.ts", PROGRAM);
    const signer = keypair("owner.json");
    const reach = ["--rpc-url", testnet.url];
    const runs = [
      await sauce("tx", program, "--chain", "solana-testnet", "--owner", OWNER, ...reach),
      await sauce("pot", "--deploy", "--chain", "testnet", "--keypair", signer, ...reach),
    ];
    for (const run of runs) {
      expect(run.code).toBe(1);
      expect(run.stderr).not.toMatch(/preview chain|is refused|give a testnet endpoint/);
      expect(run.stderr).toContain(
        `the released engine ${v12SvmEngineProgramId()} is not deployed on solana-testnet`,
      );
    }
    expect(testnet.methods).toContain("getGenesisHash");
    expect(testnet.methods).not.toContain("sendTransaction");
  });

  it("compiles and predicts a Pot as solana-testnet's, the same Pot as on every cluster", async () => {
    const compiled = await sauce(
      ...["compile", file("main.sauce.ts", PROGRAM), "--chain", "solana-testnet", "--json"],
    );
    expect(compiled.code).toBe(0);
    expect(json(compiled)).toMatchObject({ chain: "solana-testnet" });
    const mainnet = json(await sauce("pot", "--chain", "solana", "--owner", OWNER));
    const pot = json(await sauce("pot", "--chain", "solana-testnet", "--owner", OWNER));
    expect(pot).toMatchObject({ chain: "solana-testnet", owner: OWNER, pot: mainnet.pot });
    expect(pot).not.toHaveProperty("refused");
  });

  it.each([
    [MAINNET_GENESIS, "mainnet-beta"],
    [DEVNET_GENESIS, "devnet"],
    [LOCAL_GENESIS, `another cluster, whose genesis hash is ${LOCAL_GENESIS}`],
  ])(
    "refuses solana-testnet against %s's endpoint, naming what it serves, having read nothing else",
    async (genesis, served) => {
      const other = await serving(genesis);
      const refusal =
        `solana-testnet is Solana's testnet cluster, and the endpoint serves ${served}: give a ` +
        "testnet endpoint";
      const runs = [
        await sauce("pot", "--chain", "solana-testnet", "--owner", OWNER, "--rpc-url", other.url),
        await sauce(
          ...["simulate", file("main.sauce.ts", PROGRAM), "--chain", "solana-testnet"],
          ...["--owner", OWNER, "--rpc-url", other.url],
        ),
        await sauce(
          ...["reclaim", "--chain", "solana-testnet", "--owner", OWNER, "--rpc-url", other.url],
        ),
      ];
      for (const run of runs) {
        expect(run.code).toBe(1);
        expect(run.stderr).toContain(refusal);
        expect(run.stderr).not.toContain(other.url);
      }
      expect(other.methods).toEqual(["getGenesisHash"]);
    },
  );

  it("lists a testnet Pot through solana-testnet and solana, never through solana-devnet", async () => {
    const store = join(work, "pots");
    const kitchen = v12SvmKitchenProgramId() as Address;
    const { address: pot } = await derivePotPda(kitchen, OWNER, new Uint8Array(32));
    const testnet = await serving(TESTNET_GENESIS, { [pot]: v12SvmEngineProgramId() });
    const imported = await sauce(
      ...["pot", "import", "--chain", "solana-testnet", "--owner", OWNER],
      ...["--rpc-url", testnet.url, "--pots", store, "--json"],
    );
    expect(imported.code).toBe(0);
    expect(readdirSync(store)).toEqual(["1399811149-testnet"]);
    expect(json(imported).pots).toEqual([
      expect.objectContaining({ chain: "solana", chainId: 1399811149, cluster: "testnet", pot }),
    ]);
    for (const chain of ["solana-testnet", "testnet", "solana"]) {
      const list = await sauce("pot", "list", "--chain", chain, "--pots", store, "--json");
      expect([chain, json(list).pots]).toEqual([chain, json(imported).pots]);
    }
    const devnet = await sauce(
      "pot",
      "list",
      "--chain",
      "solana-devnet",
      "--pots",
      store,
      "--json",
    );
    expect(json(devnet).pots).toEqual([]);
    const shown = await sauce("pot", "list", "--chain", "solana-testnet", "--pots", store);
    expect(shown.stdout).toContain(`solana (testnet)  ${pot}  private`);
  });

  it("sends a Solana transaction that names solana-testnet on it, and refuses another chain", () => {
    const tx = { kind: "svm" as const, transaction: "AQAB", what: "the cook" };
    expect(planChain([tx], requireChain("solana-testnet")).slug).toBe("solana-testnet");
    expect(planChain([{ ...tx, chainId: 1399811151 }]).slug).toBe("solana-testnet");
    expect(() =>
      planChain([{ ...tx, chainId: 1399811150 }], requireChain("solana-testnet")),
    ).toThrow("the transactions are for chain 1399811150, not solana-testnet (1399811151)");
  });
});
