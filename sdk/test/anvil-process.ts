/**
 * How every suite starts anvil: on a port the OS hands out, never attached to an anvil it did not
 * start, and never outliving the process that started it.
 *
 * - A port that already answers is REFUSED, naming the process that holds it (an anvil a crashed
 *   run left behind, say). Before this, a suite polled the port until something answered — and an
 *   orphan left on a fixed port by an earlier run answered, so the suite asserted against its stale
 *   chain (a recipient already holding the tokens a test was about to send it).
 * - The port is the OS's ({@link freePort}, or {@link freePortSync} for a suite whose clients are
 *   built when its module loads), so suites in parallel workers, or in another checkout on the same
 *   machine, never meet on one; a fixed number is still accepted, and still refused when taken.
 * - It answers once THIS anvil does: one that exits first (it could not bind the port) fails the
 *   start with its own message.
 * - A watchdog kills it when the process that started it is gone, however that went (a crash, a
 *   signal, SIGKILL). It has to be a process of its own: jest runs a suite against a copy of
 *   `process` (jest-util's `createProcessObject`), whose `exit` and signal listeners the real
 *   process never calls, so no handler a suite registers can stop an anvil when its worker dies.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { connect, createServer } from "node:net";

/** A port nothing listens on, from the OS. */
export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, "close");

  return port;
}

/** {@link freePort}, synchronously: for a suite whose clients are built when its module loads. */
export function freePortSync(): number {
  const found = spawnSync(
    process.execPath,
    [
      "-e",
      "const s = require('node:net').createServer();" +
        "s.listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); });",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  const port = Number(found.stdout);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`no free port from the OS: ${found.stderr || found.error?.message || "?"}`);
  }

  return port;
}

/** Whether something accepts a connection on `port` at 127.0.0.1. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(2_000);
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * The processes listening on `port`: `pid 123 (anvil)`. Read the fast way each system has — macOS's
 * `netstat -anv` names a socket's process, Linux's `ss -p` too — and else by lsof, which on a busy
 * macOS takes tens of seconds to scan every process, so it is given five.
 */
export function holdersOf(port: number): string {
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

/** Kills the process with pid `argv[2]` once the one with pid `argv[1]` is gone; exits with it. */
const WATCHDOG = `
const [parent, anvil] = process.argv.slice(1).map(Number);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
setInterval(() => {
  if (!alive(anvil)) process.exit(0);
  if (!alive(parent)) {
    try {
      process.kill(anvil, "SIGKILL");
    } catch {}
    process.exit(0);
  }
}, 500);
`;

/**
 * Starts the watchdog that SIGKILLs process `child` as soon as process `parent` is gone, polling
 * twice a second, and exits when `child` does: detached and unref'd, so it holds nothing open here.
 */
export function watchdog(parent: number, child: number): ChildProcess {
  const watcher = spawn(process.execPath, ["-e", WATCHDOG, String(parent), String(child)], {
    detached: true,
    stdio: "ignore",
  });
  watcher.unref();

  return watcher;
}

const RPC_CHAIN_ID = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}';

/**
 * Starts anvil with `args` on `port` and resolves once it answers there: refused when something
 * already answers on the port, and failed when this anvil exits before it answers. A watchdog stops
 * it if this process goes first; the suite stops it otherwise, as ever (`kill`, then its `exit`).
 */
export async function spawnAnvil(
  port: number,
  args: readonly string[] = [],
  timeout = 20_000,
): Promise<ChildProcess> {
  if (await answers(port)) {
    throw new Error(
      `port ${port} already answers, held by ${holdersOf(port)}: a test starts its own anvil, never ` +
        "attaches to one left running (a crashed run's?). Stop that process, then run the suite again.",
    );
  }
  const anvil = spawn("anvil", ["--port", String(port), ...args, "--silent"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let said = "";
  anvil.stderr!.on("data", (chunk: Buffer) => {
    if (said.length < 4_000) said += chunk.toString();
  });
  const failed = new Promise<never>((_, reject) => {
    anvil.once("error", (error) => reject(new Error(`anvil could not start: ${error.message}`)));
    anvil.once("exit", (code, signal) =>
      reject(
        new Error(
          `anvil exited (${signal ?? `code ${code}`}) before it answered on port ${port}` +
            (said.trim() === "" ? "" : `: ${said.trim()}`),
        ),
      ),
    );
  });
  failed.catch(() => undefined);
  if (anvil.pid !== undefined) watchdog(process.pid, anvil.pid);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const exited = () => anvil.exitCode !== null || anvil.signalCode !== null;
  try {
    for (const deadline = Date.now() + timeout; !exited();) {
      const up = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: RPC_CHAIN_ID,
        signal: AbortSignal.timeout(2_000),
      }).then(
        (response) => response.ok,
        () => false,
      );
      // What answered is this anvil only while it runs: one that could not bind the port exits.
      if (up && !exited()) return anvil;
      if (Date.now() > deadline) throw new Error(`anvil did not answer on ${rpcUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // It exited: `failed` says how.
    return await failed;
  } catch (error) {
    if (!exited()) {
      const gone = once(anvil, "exit");
      anvil.kill();
      await gone;
    }
    throw error;
  }
}
