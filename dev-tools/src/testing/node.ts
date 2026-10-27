/**
 * A local anvil: started on a free port, waited for, stopped. Every test file can start its own, in
 * parallel. A port that already answers is refused, naming what holds it, and a node is handed back
 * only once its own anvil answers, from the port it listens on: never one a crashed run left
 * running, nor anything else that speaks JSON-RPC there, even a process that took the port between
 * the check and anvil's start. Nothing the kit starts outlives the process that started it. The
 * repository's own suites start anvil the same way (`sdk/test/anvil-process.ts`), which the
 * published kit cannot import.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
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

interface Listener {
  readonly pid: number;
  readonly command: string;
}

/** What `command` printed, before it exited, failed, or ran out of its five seconds. */
function outputOf(command: string, args: readonly string[]): Promise<string> {
  return new Promise((ok) => {
    execFile(command, args, { encoding: "utf8", timeout: 5_000 }, (_error, stdout) =>
      ok(stdout ?? ""),
    );
  });
}

/**
 * The processes listening on `port`. Read the fast way each system has — macOS's `netstat -anv`
 * names a socket's process, Linux's `ss -p` too — and else by lsof, which on a busy macOS can take
 * tens of seconds, so it is given five. None, when no tool names one. Asynchronous: test files that
 * start their nodes in parallel do not wait on each other's lookups.
 */
async function listenersOf(port: number): Promise<Listener[]> {
  let listeners: Listener[] = [];
  if (process.platform === "darwin") {
    listeners = (await outputOf("netstat", ["-anv", "-p", "tcp"]))
      .split("\n")
      .filter((line) => / LISTEN /.test(line) && line.split(/\s+/)[3]?.endsWith(`.${port}`))
      .flatMap((line) => {
        const found = /\s(\S+):(\d+)\s/.exec(line.slice(line.indexOf(" LISTEN ")));

        return found === null ? [] : [{ pid: Number(found[2]), command: found[1]! }];
      });
  } else if (process.platform === "linux") {
    listeners = [
      ...(await outputOf("ss", ["-ltnpH", `sport = :${port}`])).matchAll(/\("([^"]+)",pid=(\d+)/g),
    ].map(([, command, pid]) => ({ pid: Number(pid), command: command! }));
  }
  if (listeners.length === 0) {
    listeners = [
      ...(await outputOf("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"])).matchAll(
        /^p(\d+)\nc(.*)$/gm,
      ),
    ].map(([, pid, command]) => ({ pid: Number(pid), command: command! }));
  }

  return listeners.filter(
    (listener, index) => listeners.findIndex(({ pid }) => pid === listener.pid) === index,
  );
}

/** What holds `port`, for a refusal: `pid 123 (anvil)`. */
async function holdersOf(port: number, found?: readonly Listener[]): Promise<string> {
  const listeners = found ?? (await listenersOf(port));

  return listeners.length === 0
    ? `a process none of netstat, ss and lsof named (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`)`
    : listeners.map(({ pid, command }) => `pid ${pid} (${command})`).join(", ");
}

/** The processes the kit started that still run. */
const running = new Set<ChildProcess>();

/**
 * Keeps `child` from outliving this process: stopped when it exits, or when a signal that would end
 * it arrives — which then ends it as the signal would have, unless something else of the process
 * handles that signal.
 */
export function stopWithProcess(child: ChildProcess): void {
  if (running.size === 0) {
    process.once("exit", stopRunning);
    for (const signal of ENDING) process.once(signal, ended);
  }
  running.add(child);
  child.once("exit", () => {
    running.delete(child);
    if (running.size > 0) return;
    process.off("exit", stopRunning);
    for (const signal of ENDING) process.off(signal, ended);
  });
}

const ENDING = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function stopRunning(): void {
  for (const child of running) child.kill("SIGKILL");
}

function ended(signal: NodeJS.Signals): void {
  stopRunning();
  // Each of these listeners was registered once: with none left, the signal's own action applies.
  for (const each of ENDING) process.off(each, ended);
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
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
      `port ${port} already answers, held by ${await holdersOf(port)}: the testing kit starts its own ` +
        "anvil, and never attaches to one already running (a crashed run's?). Stop that process.",
    );
  }
  const url = `http://127.0.0.1:${port}`;
  const binary = options.binary ?? "anvil";
  // anvil honours HTTP_PROXY with no loopback bypass, and a fork reads its endpoint through the
  // kit's loopback proxy: that hop stays direct (the proxy reaches the endpoint through HTTP_PROXY).
  const bypass = [process.env.NO_PROXY ?? process.env.no_proxy, "127.0.0.1", "localhost"]
    .filter(Boolean)
    .join(",");
  const child = spawn(binary, ["--port", String(port), "--silent", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NO_PROXY: bypass, no_proxy: bypass },
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
  stopWithProcess(child);

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
    // What answered is this anvil only while it runs (one that could not bind the port exits), and
    // only when it is what listens there: another process may have taken the port first.
    if (up && !exited()) {
      const listeners = await listenersOf(port);
      if (listeners.length === 0 || listeners.some(({ pid }) => pid === child.pid)) {
        return { url, process: child, stop };
      }
      await stop();
      throw new Error(
        `port ${port} answers, but ${await holdersOf(port, listeners)} holds it, not this anvil ` +
          `(pid ${child.pid}): another process took the port before anvil could`,
      );
    }
    if (!up) await new Promise((ok) => setTimeout(ok, 100));
  }
  await stop();
  throw new Error(`anvil did not answer within 60 s: ${stderr.trim()}`);
}
