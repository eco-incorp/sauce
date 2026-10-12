/**
 * A local anvil: started on a free port, waited for, stopped. Every test file can start its own, in
 * parallel. A port that already answers is refused, naming what holds it, and a node is handed back
 * only once its own anvil answers: never one a crashed run left running, nor anything else that
 * speaks JSON-RPC there. The repository's own suites start anvil the same way
 * (`sdk/test/anvil-process.ts`), which the published kit cannot import.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect, createServer } from "node:net";

/** A free TCP port on this machine. */
export async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => ok(port));
    });
    server.on("error", fail);
  });
}

/** Whether something accepts a connection on `port` at 127.0.0.1. */
function answers(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(2_000);
    const done = (open: boolean) => {
      socket.destroy();
      ok(open);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * The processes listening on `port`: `pid 123 (anvil)`. Read the fast way each system has — macOS's
 * `netstat -anv` names a socket's process, Linux's `ss -p` too — and else by lsof, which on a busy
 * macOS can take tens of seconds, so it is given five.
 */
function holdersOf(port: number): string {
  const run = (command: string, args: readonly string[]) =>
    spawnSync(command, args, { encoding: "utf8", timeout: 5_000 }).stdout ?? "";
  let holders: string[] = [];
  if (process.platform === "darwin") {
    holders = run("netstat", ["-anv", "-p", "tcp"])
      .split("\n")
      .filter((line) => / LISTEN /.test(line) && line.split(/\s+/)[3]?.endsWith(`.${port}`))
      .flatMap((line) => {
        const found = /\s(\S+):(\d+)\s/.exec(line.slice(line.indexOf(" LISTEN ")));

        return found === null ? [] : [`pid ${found[2]} (${found[1]})`];
      });
  } else if (process.platform === "linux") {
    holders = [...run("ss", ["-ltnpH", `sport = :${port}`]).matchAll(/\("([^"]+)",pid=(\d+)/g)].map(
      ([, command, pid]) => `pid ${pid} (${command})`,
    );
  }
  if (holders.length === 0) {
    holders = [
      ...run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]).matchAll(
        /^p(\d+)\nc(.*)$/gm,
      ),
    ].map(([, pid, command]) => `pid ${pid} (${command})`);
  }

  return holders.length === 0
    ? `a process none of netstat, ss and lsof named (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`)`
    : [...new Set(holders)].join(", ");
}

/** One JSON-RPC request, with the node's error message when it fails. */
export async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);

  return body.result;
}

export interface AnvilProcess {
  readonly url: string;
  readonly process: ChildProcess;
  /** Stops anvil and waits for it to exit. */
  stop(): Promise<void>;
}

/**
 * Starts `anvil` with `args` on `options.port` (a free one by default) and waits until it answers:
 * refused when something already answers on the port, and failed when this anvil exits before it
 * answers.
 */
export async function startAnvil(
  args: readonly string[],
  options: { binary?: string; port?: number } = {},
): Promise<AnvilProcess> {
  const port = options.port ?? (await freePort());
  if (await answers(port)) {
    throw new Error(
      `port ${port} already answers, held by ${holdersOf(port)}: the testing kit starts its own ` +
        "anvil, and never attaches to one already running (a crashed run's?). Stop that process.",
    );
  }
  const url = `http://127.0.0.1:${port}`;
  const binary = options.binary ?? "anvil";
  const child = spawn(binary, ["--port", String(port), "--silent", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const spawned = new Promise<void>((ok, fail) => {
    child.once("spawn", ok);
    child.once("error", (error: NodeJS.ErrnoException) =>
      fail(
        error.code === "ENOENT"
          ? new Error(
              `${binary} was not found: the testing kit runs chains on Foundry's anvil ` +
                "(https://getfoundry.sh), which must be on PATH, or pass its path as `anvil`",
            )
          : error,
      ),
    );
  });
  await spawned;

  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const stop = async (): Promise<void> => {
    if (exited()) return;
    const gone = new Promise((ok) => child.once("exit", ok));
    child.kill("SIGTERM");
    await gone;
  };

  for (let attempt = 0; attempt < 600; attempt++) {
    if (exited()) {
      throw new Error(
        `anvil exited with ${child.signalCode ?? `code ${child.exitCode}`}: ${stderr.trim()}`,
      );
    }
    const up = await rpc(url, "eth_chainId").then(
      () => true,
      () => false,
    );
    // What answered is this anvil only while it runs: one that could not bind the port exits.
    if (up && !exited()) return { url, process: child, stop };
    if (!up) await new Promise((ok) => setTimeout(ok, 100));
  }
  await stop();
  throw new Error(`anvil did not answer within 60 s: ${stderr.trim()}`);
}
