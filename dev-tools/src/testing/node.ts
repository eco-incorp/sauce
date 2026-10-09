/**
 * A local anvil: started on a free port, waited for, stopped. Every test file can start its own, in
 * parallel.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

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
 * Starts `anvil` with `args` (a port is added) and waits until it answers. `env` replaces the
 * process environment anvil gets, when given.
 */
export async function startAnvil(
  args: readonly string[],
  options: { binary?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<AnvilProcess> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const binary = options.binary ?? "anvil";
  const child = spawn(binary, ["--port", String(port), "--silent", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    ...(options.env === undefined ? {} : { env: options.env }),
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

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((ok) => child.once("exit", ok));
    child.kill("SIGTERM");
    await exited;
  };

  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`anvil exited with code ${child.exitCode}: ${stderr.trim()}`);
    }
    try {
      await rpc(url, "eth_chainId");
      return { url, process: child, stop };
    } catch {
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }
  await stop();
  throw new Error(`anvil did not answer within 60 s: ${stderr.trim()}`);
}
