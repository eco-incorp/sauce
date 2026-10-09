/**
 * The update check, with nothing reached: the cache is text the test holds, the time a number it
 * sets, the registry an answer it gives and the refresh a call it records. Then the check in the
 * command — one line on stderr after the command's own output, none with --offline,
 * --no-update-check or the config's "updateCheck": false, and a refresh nothing waits for — and the
 * real refresh's process, which leaves nothing holding this one open.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newer, PACKAGE, readLatest, REGISTRY } from "../src/cli/npm-registry.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  cacheText,
  DAY,
  noticeDue,
  parseCache,
  refreshCache,
  startDetached,
  updateCheck,
  updateCheckOff,
  updateNote,
  updateNotice,
  writeCacheFile,
  type RefreshIo,
  type UpdateCheck,
} from "../src/cli/update-check.js";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const cache = (at: number, latest?: string): string =>
  cacheText({
    checkedAt: new Date(at).toISOString(),
    ...(latest === undefined ? {} : { latest }),
    version: "1.0.0",
  });

/** A check over `text` at `now`, recording each refresh it starts. */
function checked(
  text: string | undefined | (() => string | undefined),
  options: { version?: string; now?: () => number; refresh?: () => void } = {},
) {
  let refreshes = 0;
  let reads = 0;
  const check = updateCheck({
    version: options.version ?? "1.0.0",
    now: options.now ?? (() => NOW),
    read: () => {
      reads++;

      return typeof text === "function" ? text() : text;
    },
    refresh: () => {
      refreshes++;
      options.refresh?.();
    },
  });

  return { check, refreshes: () => refreshes, reads: () => reads };
}

describe("the cache", () => {
  it("reads its time and latest version, and nothing that is not a cache", () => {
    expect(parseCache(cache(NOW, "1.2.0"))).toEqual({ at: NOW, latest: "1.2.0" });
    expect(parseCache(cache(NOW))).toEqual({ at: NOW });
    for (const text of [
      undefined,
      "",
      "{",
      "null",
      "[]",
      '"text"',
      "{}",
      '{ "checkedAt": "yesterday" }',
      '{ "checkedAt": 1760000000000 }',
    ]) {
      expect([text, parseCache(text)]).toEqual([text, undefined]);
    }
    // A latest that is no version is left out: the time still counts.
    for (const latest of ["latest", "1.2", "v1.2.0", "1.2.0 ", 120]) {
      const text = JSON.stringify({ checkedAt: new Date(NOW).toISOString(), latest });
      expect(parseCache(text)).toEqual({ at: NOW });
    }
  });

  it("is due a notice only for a newer release, or a newer prerelease when one runs", () => {
    for (const [latest, version, due] of [
      ["1.0.1", "1.0.0", true],
      ["2.0.0", "1.9.9", true],
      ["1.0.0", "1.0.0", false],
      ["0.9.9", "1.0.0", false],
      // A prerelease named latest is no notice to a release...
      ["1.1.0-beta.1", "1.0.0", false],
      // ...but is to an older prerelease, as is the release it leads to.
      ["1.1.0-beta.2", "1.1.0-beta.1", true],
      ["1.1.0", "1.1.0-beta.1", true],
      ["1.1.0-beta.1", "1.1.0", false],
      ["1.0.1+build.5", "1.0.0", true],
      ["1.0.1", "unknown", false],
      ["not a version", "1.0.0", false],
    ] as const) {
      expect([latest, version, noticeDue(latest, version)]).toEqual([latest, version, due]);
    }
  });

  it("says the versions, and the command that updates", () => {
    expect(updateNotice("0.99.12", "0.99.13")).toBe(
      "sauce 0.99.12 → 0.99.13 is available: run `sauce update`",
    );
    const note = updateNote("0.99.12", "0.99.13");
    expect(note).toMatch(
      /^A newer @eco-incorp\/sauce is available: 0\.99\.13 \(this server runs 0\.99\.12\)/,
    );
    expect(note).toContain("`sauce update`");
    expect(note).toContain(`\`npx -y ${PACKAGE}@latest mcp setup --force\``);
  });
});

describe("the check", () => {
  it("answers from a fresh cache, and starts no refresh", () => {
    const fresh = checked(cache(NOW - 23 * HOUR, "1.2.0"));
    expect(fresh.check.latest()).toBe("1.2.0");
    expect(fresh.refreshes()).toBe(0);
    expect(fresh.check.version).toBe("1.0.0");
    // Up to date, or ahead of the registry: nothing to say.
    expect(checked(cache(NOW, "1.0.0")).check.latest()).toBeUndefined();
    expect(checked(cache(NOW, "0.9.0")).check.latest()).toBeUndefined();
    expect(checked(cache(NOW, "1.2.0"), { version: "1.3.0" }).check.latest()).toBeUndefined();
  });

  it("refreshes a cache a day old, without waiting: the notice is the cache's", () => {
    const stale = checked(cache(NOW - DAY, "1.2.0"));
    expect(stale.check.latest()).toBe("1.2.0");
    expect(stale.refreshes()).toBe(1);
  });

  it("refreshes a missing, unreadable or corrupt cache, and says nothing", () => {
    const unreadable = () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    for (const text of [undefined, unreadable, "{ not json", "[]"]) {
      const run = checked(text);
      expect(run.check.latest()).toBeUndefined();
      expect(run.refreshes()).toBe(1);
    }
  });

  it("refreshes a cache from a clock that has since gone back", () => {
    const ahead = checked(cache(NOW + HOUR, "1.2.0"));
    expect(ahead.check.latest()).toBe("1.2.0");
    expect(ahead.refreshes()).toBe(1);
  });

  it("starts one refresh a day in a process, however often it is asked", () => {
    let now = NOW;
    const run = checked(cache(NOW - 2 * DAY, "1.2.0"), { now: () => now });
    for (let i = 0; i < 5; i++) run.check.latest();
    expect(run.refreshes()).toBe(1);
    now += DAY - 1;
    run.check.latest();
    expect(run.refreshes()).toBe(1);
    now += 1;
    run.check.latest();
    expect(run.refreshes()).toBe(2);
    // Each answer is read from the cache again: a refresh another process wrote is seen.
    expect(run.reads()).toBe(7);
  });

  it("is silent when the refresh cannot start, or the clock throws", () => {
    const failing = checked(cache(NOW - DAY, "1.2.0"), {
      refresh: () => {
        throw new Error("spawn EAGAIN");
      },
    });
    expect(failing.check.latest()).toBe("1.2.0");
    const clockless = checked(cache(NOW, "1.2.0"), {
      now: () => {
        throw new Error("no clock");
      },
    });
    expect(clockless.check.latest()).toBeUndefined();
  });
});

describe("the refresh", () => {
  /** A refresh over an in-memory cache, at `times` in turn, answering `answer`. */
  function refresh(
    initial: string | undefined,
    answer: () => Promise<string>,
    options: { write?: (text: string) => void } = {},
  ) {
    const writes: string[] = [];
    let now = NOW;
    let stored = initial;
    const io: RefreshIo = {
      now: () => (now += 1000),
      read: () => {
        if (stored === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });

        return stored;
      },
      write: (text) => {
        options.write?.(text);
        writes.push(text);
        stored = text;
      },
      latest: answer,
    };

    return { io, writes: () => writes.map((text) => JSON.parse(text) as Record<string, unknown>) };
  }

  it("records the attempt before it asks, then the registry's answer", async () => {
    let answered: (version: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => (answered = resolve));
    const run = refresh(cache(NOW - 2 * DAY, "1.1.0"), () => pending);
    const done = refreshCache(run.io, "1.0.0");
    // Before the registry answers, the attempt is there, keeping what was known.
    expect(run.writes()).toEqual([
      { checkedAt: new Date(NOW + 1000).toISOString(), latest: "1.1.0", version: "1.0.0" },
    ]);
    answered("1.2.0");
    await done;
    expect(run.writes()[1]).toEqual({
      checkedAt: new Date(NOW + 2000).toISOString(),
      latest: "1.2.0",
      version: "1.0.0",
    });
    expect(parseCache(cacheText(run.writes()[1] as never))?.latest).toBe("1.2.0");
  });

  it("keeps the attempt alone when the registry fails or answers no version", async () => {
    for (const answer of [
      () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
      () => Promise.resolve("latest"),
      () => Promise.resolve("<html>"),
    ]) {
      const run = refresh(cache(NOW - 2 * DAY, "1.1.0"), answer);
      await refreshCache(run.io, "1.0.0");
      expect(run.writes()).toEqual([
        { checkedAt: new Date(NOW + 1000).toISOString(), latest: "1.1.0", version: "1.0.0" },
      ]);
    }
  });

  it("starts from no cache, and asks nothing when it cannot write one", async () => {
    const fresh = refresh(undefined, () => Promise.resolve("1.2.0"));
    await refreshCache(fresh.io, "1.0.0");
    expect(fresh.writes().map((write) => write.latest)).toEqual([undefined, "1.2.0"]);
    // A cache it cannot write: the registry is not asked, since its answer would go nowhere.
    let asked = 0;
    const readOnly = refresh(
      undefined,
      () => {
        asked++;

        return Promise.resolve("1.2.0");
      },
      {
        write: () => {
          throw Object.assign(new Error("EROFS"), { code: "EROFS" });
        },
      },
    );
    await expect(refreshCache(readOnly.io, "1.0.0")).resolves.toBeUndefined();
    expect(asked).toBe(0);
  });

  it("asks the registry for the latest dist-tag, briefly, and nothing else", async () => {
    const asked: Array<{ url: string; init: RequestInit | undefined }> = [];
    const answering =
      (status: number, body: unknown): typeof fetch =>
      async (url, init) => {
        asked.push({ url: String(url), init });

        return new Response(JSON.stringify(body), { status });
      };
    await expect(readLatest(answering(200, { latest: "1.2.0", next: "2.0.0-rc.1" }))).resolves.toBe(
      "1.2.0",
    );
    expect(asked[0]!.url).toBe(`${REGISTRY}-/package/@eco-incorp%2fsauce/dist-tags`);
    expect(asked[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    await expect(readLatest(answering(404, {}))).rejects.toThrow("the registry answered 404");
    await expect(readLatest(answering(200, { next: "2.0.0" }))).rejects.toThrow(
      "the registry names no latest version",
    );
    await expect(readLatest(answering(200, null))).rejects.toThrow();
    // The comparison the notice and `sauce update` share.
    expect(newer("1.2.0", "1.1.9")).toBe(true);
  });
});

describe("the cache file", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sauce-update-check-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("is written whole, owner-only, in a directory created owner-only", () => {
    const file = join(home, ".sauce", "update-check.json");
    writeCacheFile(file, cache(NOW, "1.2.0"));
    writeCacheFile(file, cache(NOW + 1, "1.3.0"));
    // The second replaced the first, and no temporary file is left beside it.
    expect(parseCache(readFileSync(file, "utf8"))).toEqual({ at: NOW + 1, latest: "1.3.0" });
    expect(readdirSync(join(home, ".sauce"))).toEqual(["update-check.json"]);
    if (process.platform !== "win32") {
      expect(statSync(join(home, ".sauce")).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

describe("the opt-outs", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-update-config-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const config = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text);

    return path;
  };
  const read = (path: string) => nodeIo().readText(path);

  it("are --offline, --no-update-check and the config's updateCheck: false", () => {
    expect(updateCheckOff({}, read)).toBe(false);
    expect(updateCheckOff({ offline: true }, read)).toBe(true);
    expect(updateCheckOff({ "no-update-check": true }, read)).toBe(true);
    const off = config("off.json", JSON.stringify({ rpcUrls: {}, updateCheck: false }));
    expect(updateCheckOff({ config: off }, read)).toBe(true);
    // Anything else in the file, or no file to read, leaves it on.
    for (const [name, text] of [
      ["on.json", JSON.stringify({ rpcUrls: {}, updateCheck: true })],
      ["quoted.json", JSON.stringify({ updateCheck: "false" })],
      ["absent.json", JSON.stringify({ rpcUrls: {} })],
      ["broken.json", "{ not json"],
      ["null.json", "null"],
    ]) {
      expect([name, updateCheckOff({ config: config(name!, text!) }, read)]).toEqual([name, false]);
    }
    expect(updateCheckOff({ config: join(dir, "missing.json") }, read)).toBe(false);
  });
});

describe("the notice in the command", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-update-notice-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** `sauce …` with `check`, recording stdout and stderr in the order they were written. */
  async function sauce(check: UpdateCheck | undefined, ...argv: string[]) {
    const written: Array<["stdout" | "stderr", string]> = [];
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void written.push(["stdout", text]),
      stderr: (text) => void written.push(["stderr", text]),
      ...(check === undefined ? {} : { updateCheck: check }),
    };
    const code = await runCli(argv, io);
    const of = (stream: string) =>
      written
        .filter(([to]) => to === stream)
        .map(([, text]) => text)
        .join("");

    return { code, stdout: of("stdout"), stderr: of("stderr"), written };
  }

  const NOTICE = "sauce 1.0.0 → 1.2.0 is available: run `sauce update`\n";
  const newerKnown = () => checked(cache(NOW - HOUR, "1.2.0"));

  it("follows the command's own output, on stderr, and leaves --json clean", async () => {
    const run = newerKnown();
    const ran = await sauce(run.check, "globals", "--chain", "base", "--json");
    expect(ran.code).toBe(0);
    expect(JSON.parse(ran.stdout)).toMatchObject({ chain: { slug: "base" } });
    expect(ran.stderr).toBe(NOTICE);
    expect(ran.written.at(-1)).toEqual(["stderr", NOTICE]);
    expect(run.refreshes()).toBe(0);
  });

  it("follows --version, and a failing command's message", async () => {
    const version = await sauce(newerKnown().check, "--version");
    expect(version.stdout).toMatch(/^@eco-incorp\/sauce \S+\n$/);
    expect(version.stderr).toBe(NOTICE);
    const failed = await sauce(newerKnown().check, "globals", "--chain", "nowhere");
    expect(failed.code).toBe(2);
    expect(failed.stderr.endsWith(`\n${NOTICE}`)).toBe(true);
    expect(failed.stderr).toMatch(/^sauce globals: /);
  });

  it("is not printed, nor the cache read, with --offline, --no-update-check or the config's false", async () => {
    const price = ["price", "--chain", "base", "2700", "USDC", "per", "WETH"];
    const off = join(dir, "off.json");
    writeFileSync(off, JSON.stringify({ rpcUrls: {}, updateCheck: false }));
    for (const argv of [
      [...price, "--offline"],
      [...price, "--no-update-check"],
      ["--no-update-check", ...price],
      ["--no-update-check", "--no-update-check", ...price],
      [...price, "--config", off],
      ["globals", "--chain", "base", "--json", "--no-update-check"],
      ["--version", "--no-update-check"],
      ["--no-update-check", "--version"],
    ]) {
      const run = newerKnown();
      const ran = await sauce(run.check, ...argv);
      expect([argv, ran.code, ran.stderr]).toEqual([argv, 0, ""]);
      expect([argv, run.reads(), run.refreshes()]).toEqual([argv, 0, 0]);
    }
    // A config that leaves it on.
    const on = join(dir, "on.json");
    writeFileSync(on, JSON.stringify({ rpcUrls: {} }));
    const ran = await sauce(newerKnown().check, ...price, "--config", on);
    expect(ran.stderr).toBe(NOTICE);
  });

  it("is not printed by sauce update, which is the update, nor without a check", async () => {
    const run = newerKnown();
    const update = await sauce(run.check, "update", "--check");
    expect(update.stderr).not.toContain("is available");
    expect(run.reads()).toBe(0);
    const none = await sauce(undefined, "globals", "--chain", "base", "--json");
    expect(none.stderr).toBe("");
  });

  it("never waits for the refresh", async () => {
    // A refresh that never ends: the command still returns, having started it.
    let started = 0;
    const stale = checked(cache(NOW - 2 * DAY, "1.2.0"), {
      refresh: () => {
        started++;
        void new Promise(() => undefined);
      },
    });
    const ran = await sauce(stale.check, "globals", "--chain", "base", "--json");
    expect(ran.code).toBe(0);
    expect(started).toBe(1);
    expect(ran.stderr).toBe(NOTICE);
  });

  it("is an option every command lists", async () => {
    const help = await sauce(undefined, "--help");
    const names = [...help.stdout.matchAll(/^ {2}([a-z]+) {2,}/gm)].map((match) => match[1]!);
    expect(names).toEqual(expect.arrayContaining(["compile", "run", "mcp", "update"]));
    for (const name of [...names, "intent fill", "wallet new"]) {
      const own = await sauce(undefined, ...name.split(" "), "--help");
      expect([name, own.stdout]).toEqual([name, expect.stringContaining("--no-update-check")]);
    }
  });
});

describe("the refresh's process", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-update-spawn-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs on its own, holding nothing open in the process that started it", async () => {
    const marker = join(dir, "refreshed");
    const script = join(dir, "refresh.mjs");
    writeFileSync(
      script,
      'import { writeFileSync } from "node:fs";\n' +
        "setTimeout(() => writeFileSync(process.argv[2], process.argv[3]), 300);\n",
    );
    const holding = () =>
      process.getActiveResourcesInfo().filter((resource) => resource === "ProcessWrap").length;
    const before = holding();
    const started = Date.now();
    const child = startDetached(script, [marker, "1.0.0"]);
    expect(Date.now() - started).toBeLessThan(1000);
    // Unref'd: the child is not among what keeps this process's event loop alive.
    expect(holding()).toBe(before);
    expect(child.spawnargs.slice(1)).toEqual([script, marker, "1.0.0"]);
    for (let waited = 0; !existsSync(marker) && waited < 10_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(existsSync(marker)).toBe(true);
  });
});
