/**
 * What the operator release gate (`scripts/release-gate.mjs`) does with the endpoints and keys it is
 * given. Its endpoints carry provider keys and its steps sign: so no configured endpoint reaches a
 * command line (the process list shows one) or an output, a child gets a small environment and no
 * lifecycle script of what it installs, and a key goes only with the loopback endpoint of the kit's
 * own fork, which makes "sends nothing to a live chain" a checked property.
 *
 * The pieces are pure functions (`scripts/lib/release-gate-checks.mjs`), tested here; the script's
 * use of them is held by its own text, since running it needs live chains.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  childEnvironment,
  confineEnvironment,
  endpointSecrets,
  GATE_ENVIRONMENT,
  requireLoopback,
  requireSigningEndpoint,
  withEndpointConfig,
  writeEndpointConfig,
} from "../scripts/lib/release-gate-checks.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/release-gate.mjs");

describe("what the release gate scrubs of an endpoint", () => {
  const URL_TEXT =
    "https://user:p%40ss-word-1234@eth.example.invalid:8443/v2/KEYSEGMENT-0123456789/extra" +
    "?apikey=QRSTUVWXYZ012345&x=1&token=a%20b%2Fc-encoded-value&n=short";

  it("holds the endpoint whole and each part of it: user, password, host, path and query", () => {
    const secrets = endpointSecrets(URL_TEXT);
    expect(secrets).toEqual(
      expect.arrayContaining([
        URL_TEXT,
        "user",
        "p%40ss-word-1234",
        "p@ss-word-1234",
        "eth.example.invalid:8443",
        "/v2/KEYSEGMENT-0123456789/extra",
      ]),
    );
  });

  it("holds each path segment and each query value of eight characters or more, decoded too", () => {
    const secrets = endpointSecrets(URL_TEXT);
    expect(secrets).toEqual(
      expect.arrayContaining([
        "KEYSEGMENT-0123456789",
        "QRSTUVWXYZ012345",
        "a%20b%2Fc-encoded-value",
        "a b/c-encoded-value",
      ]),
    );
    // Shorter ones are words, not keys, and scrubbed they would mangle every message.
    for (const word of ["v2", "extra", "1", "short", "n"]) expect(secrets).not.toContain(word);
  });

  it("holds a string that is no URL whole", () => {
    expect(endpointSecrets("not a url at all")).toEqual(["not a url at all"]);
  });
});

describe("the environment a child of the release gate gets", () => {
  const OPERATOR = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/operator",
    USERPROFILE: "C:\\Users\\operator",
    TMPDIR: "/var/tmp",
    NPM_TOKEN: "npm_secret",
    GITHUB_TOKEN: "ghp_secret",
    AWS_SECRET_ACCESS_KEY: "aws_secret",
    npm_config_registry: "https://registry.example.invalid/",
    npm_config_cache: "/home/operator/.npm",
    SAUCE_ANYTHING: "x",
  };

  it("is PATH, HOME, USERPROFILE, TMPDIR and npm's cache, the home being the temp one", () => {
    expect(
      childEnvironment(OPERATOR, { home: "/tmp/gate/home", cache: "/home/operator/.npm" }),
    ).toEqual({
      PATH: "/usr/bin:/bin",
      TMPDIR: "/var/tmp",
      HOME: "/tmp/gate/home",
      USERPROFILE: "/tmp/gate/home",
      npm_config_cache: "/home/operator/.npm",
    });
  });

  it("carries none of the operator's credentials or settings, and leaves out what is unset", () => {
    const env = childEnvironment({ PATH: "/bin", NPM_TOKEN: "npm_secret" }, { home: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", USERPROFILE: "/h" });
    expect(JSON.stringify(childEnvironment(OPERATOR, { home: "/h" }))).not.toMatch(
      /secret|registry/,
    );
  });
});

describe("the endpoint a transaction of the release gate is sent to", () => {
  it.each(["http://127.0.0.1:8545", "http://localhost:8545/", "http://[::1]:8545"])(
    "accepts the kit's own, %s",
    (url) => {
      expect(() => requireLoopback(url)).not.toThrow();
    },
  );

  it.each([
    "https://mainnet.example.invalid/v2/KEYSEGMENT-0123456789",
    "http://127.0.0.1.example.invalid/",
    "http://localhost.example.invalid",
    "http://example.invalid/@127.0.0.1",
    "http://127.0.0.1@example.invalid",
    "http://0.0.0.0:8545",
    "not a url",
    "",
  ])("refuses %j, without repeating it", (url) => {
    let said = "";
    try {
      requireLoopback(url);
    } catch (error) {
      said = error instanceof Error ? error.message : String(error);
    }
    expect(said).toMatch(/loopback/);
    expect(said).not.toContain("KEYSEGMENT");
    expect(said).not.toContain("example.invalid");
  });

  it("lets a command carry a key only with a loopback --rpc-url, and anything else read an endpoint", () => {
    const key = ["--private-key", "0x01"];
    expect(() =>
      requireSigningEndpoint(["run", "seven.sauce.ts", ...key, "--rpc-url", "http://127.0.0.1:1"]),
    ).not.toThrow();
    for (const args of [
      [
        "run",
        "seven.sauce.ts",
        ...key,
        "--rpc-url",
        "https://live.example.invalid/KEYSEGMENT-0123",
      ],
      ["run", "seven.sauce.ts", ...key],
      ["run", "seven.sauce.ts", ...key, "--config", "endpoints.json"],
      ["pot", "--deploy", ...key, "--rpc-url"],
    ]) {
      expect(() => requireSigningEndpoint(args)).toThrow(/loopback/);
      expect(() => requireSigningEndpoint(args)).not.toThrow(/KEYSEGMENT|example\.invalid/);
    }
    // A command that signs nothing may read any endpoint, a live one included.
    expect(() =>
      requireSigningEndpoint([
        "simulate",
        "x.sauce.ts",
        "--rpc-url",
        "https://live.example.invalid/K",
      ]),
    ).not.toThrow();
  });
});

describe("the file that holds the Solana endpoint", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-release-gate-hygiene-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is a --config file of that chain's endpoint, readable by its owner alone", () => {
    const url = "https://solana.example.invalid/KEYSEGMENT-0123456789";
    const path = writeEndpointConfig(dir, 1399811149, url);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ rpcUrls: { "1399811149": url } });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    // The path of the file is what a command line carries: no part of the endpoint.
    expect(path).not.toContain("KEYSEGMENT");
    expect(path.startsWith(dir)).toBe(true);
  });
});

describe("the environment the release gate keeps for itself", () => {
  // The installed testing kit runs inside the gate's own process and starts anvil, and its recorder,
  // with no environment of its own: they inherit the gate's. What the gate keeps is what they need.
  it("is PATH, TMPDIR, HOME and USERPROFILE: no token, key or registry setting of the operator's", () => {
    expect([...GATE_ENVIRONMENT].sort()).toEqual(["HOME", "PATH", "TMPDIR", "USERPROFILE"]);
  });

  it("is the environment cut to those variables, in place", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/operator",
      TMPDIR: "/var/tmp",
      NPM_TOKEN: "npm_secret",
      AWS_SECRET_ACCESS_KEY: "aws_secret",
      npm_config_cache: "/home/operator/.npm",
      ETH_RPC_URL: "https://live.example.invalid/KEYSEGMENT",
    };
    const cut = confineEnvironment(env, GATE_ENVIRONMENT);
    expect(cut).toBe(env);
    expect(env).toEqual({ PATH: "/usr/bin:/bin", HOME: "/home/operator", TMPDIR: "/var/tmp" });
  });

  describe("as the installed kit's anvil inherits it", () => {
    // The kit's own `startAnvil` (dev-tools/src/testing/node.ts, the code the published kit is
    // built from) in a process holding what an operator's environment holds. A stand-in binary
    // stands where anvil would, and writes the names of the variables it was started with: what
    // the kit hands anvil is what `spawn` gives a child that is given no `env` of its own.
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "sauce-release-gate-kit-"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const here = dirname(fileURLToPath(import.meta.url));
    const KIT = pathToFileURL(resolve(here, "../../dev-tools/src/testing/node.ts")).href;
    const LIB = pathToFileURL(resolve(here, "../scripts/lib/release-gate-checks.mjs")).href;
    const OPERATOR = {
      OPERATOR_CANARY: "operator-canary-3f9a1c7e",
      NPM_TOKEN: "npm_secret_token_value",
      ETH_RPC_URL: "https://live.example.invalid/KEYSEGMENT-0123456789",
    };

    /** The names of the variables the kit's anvil started with, the gate's cut made first or not. */
    function anvilEnvironment(cut: boolean): string[] {
      const seen = join(dir, `anvil-environment-${cut ? "cut" : "uncut"}.json`);
      const standIn = join(dir, `anvil-${cut ? "cut" : "uncut"}.mjs`);
      writeFileSync(
        standIn,
        [
          "#!/usr/bin/env node",
          'import { writeFileSync } from "node:fs";',
          `writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env)));`,
          // It is no node: the kit sees anvil exit, which it reports, and the file is written.
          "process.exit(1);",
          "",
        ].join("\n"),
      );
      chmodSync(standIn, 0o755);
      const driver = [
        `import { startAnvil } from ${JSON.stringify(KIT)};`,
        ...(cut
          ? [
              `import { confineEnvironment, GATE_ENVIRONMENT } from ${JSON.stringify(LIB)};`,
              "confineEnvironment(process.env, GATE_ENVIRONMENT);",
            ]
          : []),
        `await startAnvil([], { binary: ${JSON.stringify(standIn)} }).catch(() => undefined);`,
      ].join("\n");
      const ran = spawnSync(
        process.execPath,
        ["--no-warnings", "--input-type=module", "-e", driver],
        {
          encoding: "utf8",
          env: {
            PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
            HOME: dir,
            TMPDIR: dir,
            ...OPERATOR,
          },
        },
      );
      expect(ran.stderr).toBe("");
      expect(ran.status).toBe(0);

      return JSON.parse(readFileSync(seen, "utf8")) as string[];
    }

    it("carries the operator's variables to it when nothing cuts them: what the probe sees", () => {
      // The control: without it a test that finds none would pass for a probe that sees nothing.
      expect(anvilEnvironment(false)).toEqual(expect.arrayContaining(Object.keys(OPERATOR)));
    });

    it("carries none of them once the gate has cut its environment, and what a chain needs stays", () => {
      const names = anvilEnvironment(true);
      expect(names).toEqual(expect.arrayContaining(["PATH", "HOME", "TMPDIR"]));
      expect(names.filter((name) => name in OPERATOR)).toEqual([]);
    });
  });
});

describe("the file that holds the Solana endpoint, for as long as a command needs it", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-release-gate-config-file-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const url = "https://solana.example.invalid/KEYSEGMENT-0123456789";

  it("is there while the command runs, and gone once it returns", () => {
    let during: string | undefined;
    const returned = withEndpointConfig(dir, 1399811149, url, (path) => {
      during = path;
      expect(existsSync(path)).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ rpcUrls: { "1399811149": url } });

      return "the command's result";
    });
    expect(returned).toBe("the command's result");
    expect(existsSync(during!)).toBe(false);
  });

  it("is gone when the command throws, too", () => {
    let during: string | undefined;
    expect(() =>
      withEndpointConfig(dir, 1399811149, url, (path) => {
        during = path;
        throw new Error("the command failed");
      }),
    ).toThrow("the command failed");
    expect(existsSync(during!)).toBe(false);
  });
});

describe("the release gate script", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("passes no configured endpoint on a command line: the Solana one goes in a --config file", () => {
    // `--rpc-url` takes the kit's own fork (`chain.rpcUrl`), never `url`, the operator's endpoint.
    expect(source).not.toMatch(/"--rpc-url",\s*url\b/);
    // The file lives as long as the command that reads it, whatever the command does.
    expect(source).toMatch(/withEndpointConfig\(/);
    expect(source).not.toMatch(/\bwriteEndpointConfig\(/);
    expect(source).toMatch(/"--config"/);
  });

  it("cuts its own environment before any installed code loads, once it has read npm's cache", () => {
    const cacheRead = source.indexOf('"config", "get", "cache"');
    const confined = source.indexOf("confineEnvironment(process.env, GATE_ENVIRONMENT)");
    const firstLoad = source.indexOf("await installed(");
    expect(cacheRead).toBeGreaterThan(-1);
    expect(confined).toBeGreaterThan(cacheRead);
    expect(firstLoad).toBeGreaterThan(confined);
  });

  it("installs without lifecycle scripts, and runs every child in the small environment", () => {
    expect(source.match(/"--ignore-scripts"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(source).not.toMatch(/\.\.\.process\.env/);
    expect(source).toMatch(/childEnvironment\(/);
  });

  it("holds every command that carries a key to a loopback endpoint, at the one place commands run", () => {
    expect(source).toMatch(/requireSigningEndpoint\(args\)/);
  });

  it("runs the installed compiler's authored decode live on Ethereum, Base and Arc (step 6b), checked by decodeProblem", () => {
    // The step is in the list the summary prints, on the three chains that hold the solver's Pot.
    expect(source).toMatch(/\{ n: "6b", name: "[^"]+", on: \["ethereum", "base", "arc"\] \}/);
    // It writes the program, and holds each of its two runs to the function the tests refuse a
    // revert, a wrong value and a wrong engine with.
    expect(source).toContain('abi.decode(data, ["Address"])');
    expect(source).toMatch(/await step\("6b", slug,/);
    expect(source).toMatch(/decodeProblem\(\{/);
    // Through the solver's 1.3.0 Pot, and through the Pot of step 3's owner.
    expect(source).toMatch(/through\(\["--pot", SOLVER_POT\]/);
    expect(source).toMatch(/through\(\["--owner", a3\.address\]/);
    // The engine is read off the calldata of `sauce tx`, which takes no --json (what it prints is
    // the JSON): a gate that passed the flag would fail on every chain before it proved anything.
    expect(source).toMatch(/sauce\(\["tx", decode, \.\.\.flags\]\)/);
    expect(source).not.toMatch(/sauce\(\["tx"[^)]*"--json"/);
  });

  it("an --rpc-config key that is not a chain id is refused, counted and never repeated", () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-release-gate-keys-"));
    try {
      // A pasted endpoint where a chain id goes carries its credential, and registering the values
      // alone would not scrub it from a message that echoed the key.
      const cfg = join(dir, "rpc.json");
      writeFileSync(
        cfg,
        JSON.stringify({
          "1": "https://one.example.invalid/AAAAAAAAAAAA",
          "https://rpc.example.invalid/v2/SECRETKEY123": "https://two.example.invalid/BBBBBBBBBBBB",
        }),
        { mode: 0o600 },
      );
      // The package does not exist, which keeps a run that gets past the check offline.
      const ran = spawnSync(
        process.execPath,
        [SCRIPT, "--package", join(dir, "missing.tgz"), "--rpc-config", cfg],
        { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir }, timeout: 120_000 },
      );
      expect(ran.status).toBe(2);
      expect(ran.stderr.trim()).toBe(`--rpc-config ${cfg} has a key that is not a chain id`);
      for (const text of [ran.stdout, ran.stderr]) {
        for (const secret of [
          "SECRETKEY123",
          "rpc.example.invalid",
          "one.example.invalid",
          "two.example.invalid",
        ]) {
          expect(text).not.toContain(secret);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
