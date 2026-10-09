/**
 * The test harness's anvil start (`anvil-process.ts`): it refuses a port something already answers
 * on — an anvil left running is the case that cost a stale chain — naming what holds it; it answers
 * only once its own anvil does; and its watchdog kills the anvil once the process that started it is
 * gone, however that process went.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { freePort, freePortSync, spawnAnvil, watchdog } from "./anvil-process.js";

const ANVIL = spawnSync("anvil", ["--version"]).status === 0;
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** Where the refusal names the holder by its pid: netstat on macOS, ss on Linux, lsof elsewhere. */
const NAMES = process.platform === "darwin" || process.platform === "linux";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/** Resolves once `pid` is gone, or rejects after `ms`. */
async function gone(pid: number, ms = 10_000): Promise<void> {
  for (const deadline = Date.now() + ms; alive(pid);) {
    if (Date.now() > deadline) throw new Error(`pid ${pid} is still running`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
};

describe("ports from the OS", () => {
  it("are free, asynchronously and synchronously", async () => {
    for (const port of [await freePort(), freePortSync()]) {
      expect(port).toBeGreaterThan(0);
      const server = createServer().listen(port, "127.0.0.1");
      await once(server, "listening");
      server.close();
      await once(server, "close");
    }
  });
});

describe("the watchdog", () => {
  it("kills the process it watches once the process that started it is gone", async () => {
    const parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
      stdio: "ignore",
    });
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
      stdio: "ignore",
    });
    try {
      const watcher = watchdog(parent.pid!, child.pid!);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect([alive(child.pid!), alive(watcher.pid!)]).toEqual([true, true]);
      // The way a crashed run goes: no handler of its own runs.
      parent.kill("SIGKILL");
      await gone(child.pid!);
      await gone(watcher.pid!);
    } finally {
      await stop(parent);
      await stop(child);
    }
  });

  it("exits with the process it watches", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
      stdio: "ignore",
    });
    const watcher = watchdog(process.pid, child.pid!);
    await stop(child);
    await gone(watcher.pid!);
  });
});

(ANVIL ? describe : describe.skip)("spawnAnvil", () => {
  it("starts anvil on the port, answering once it does", async () => {
    const port = await freePort();
    const anvil = await spawnAnvil(port, ["--chain-id", "8453"]);
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      expect(((await response.json()) as { result: string }).result).toBe("0x2105");
    } finally {
      await stop(anvil);
    }
  });

  it("refuses a port an anvil left running holds, naming it, and starts nothing", async () => {
    const port = await freePort();
    const left = await spawnAnvil(port);
    try {
      const refused = spawnAnvil(port);
      await expect(refused).rejects.toThrow(`port ${port} already answers, held by`);
      if (NAMES) await expect(refused).rejects.toThrow(`held by pid ${left.pid} (anvil)`);
      // The anvil already there is the one still answering, untouched.
      expect(left.exitCode).toBeNull();
    } finally {
      await stop(left);
    }
  }, 30_000);

  it("refuses a port anything else answers on", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as { port: number };
    try {
      const refused = spawnAnvil(port);
      await expect(refused).rejects.toThrow(`port ${port} already answers`);
      if (NAMES) await expect(refused).rejects.toThrow(`held by pid ${process.pid} `);
    } finally {
      server.close();
      await once(server, "close");
    }
  }, 30_000);

  it("fails, with anvil's reason, when its anvil exits before it answers", async () => {
    await expect(spawnAnvil(await freePort(), ["--chain-id", "not-a-number"])).rejects.toThrow(
      /anvil exited \(code \d+\) before it answered on port \d+: .+/,
    );
  });
});

describe("every test anvil", () => {
  /** The tracked sources under `dirs`, but this harness's own two files. */
  const sources = (dirs: readonly string[]): Array<readonly [string, string]> =>
    execFileSync("git", ["ls-files", "--", ...dirs], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter(
        (file) =>
          /\.(?:ts|mts|mjs|js)$/.test(file) && !/\/anvil-process(?:\.test)?\.ts$/.test(file),
      )
      .map((file) => [file, readFileSync(join(REPO, file), "utf8")] as const);

  it("starts through spawnAnvil, which refuses a taken port and leaves no orphan", () => {
    const direct = sources(["sdk/test", "mcp/test"])
      .filter(([, text]) =>
        /\bspawn(?:Sync)?\(\s*["']anvil["']\s*,\s*\[(?!\s*["']--version["'])/.test(text),
      )
      .map(([file]) => file);
    expect(direct).toEqual([]);
  });

  it("is on a port from the OS: no suite names a fixed port, or a range by jest worker", () => {
    // Two suites that each took `N + JEST_WORKER_ID` from overlapping N met on one port, and one
    // asserted against the other's chain. A port from the OS cannot be shared.
    const fixed = sources(["sdk/test", "mcp/test", "actions/tests"]).flatMap(([file, text]) => [
      ...(/JEST_WORKER_ID/.test(text) ? [`${file}: a port by JEST_WORKER_ID`] : []),
      ...(/\bspawnAnvil\(\s*\d/.test(text) ? [`${file}: spawnAnvil given a number`] : []),
      ...(/\b(?:const|let)\s+\w*port\w*\s*(?::\s*number\s*)?=\s*\d/i.test(text)
        ? [`${file}: a port that is a number`]
        : []),
      ...(/["']--port["']\s*,\s*(?:String\(\s*)?["']?\d/.test(text)
        ? [`${file}: anvil given a fixed --port`]
        : []),
    ]);
    expect(fixed).toEqual([]);
  });
});
