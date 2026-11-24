import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(SDK, "scripts");
const CONFIG_READER = pathToFileURL(join(SCRIPTS, "lib/fixture-rpc-config.mjs")).href;
const FETCHERS = ["fetch-program-fixtures.mjs", "fetch-contract-code.mjs"];
let temporary: string;
let config: string;
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "sauce-fixture-config-"));
  config = join(temporary, "public.json");
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

function readConfig(value: unknown, offline = false) {
  writeFileSync(config, JSON.stringify(value));
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { readFixtureRpcConfig } from ${JSON.stringify(CONFIG_READER)};
       globalThis.fetch = () => { throw new Error("unexpected network access"); };
       try {
         const result = readFixtureRpcConfig(
           { "rpc-config": process.argv[1], offline: process.argv[2] === "true" }, [1, 8453]);
         console.log(JSON.stringify([...result]));
       } catch (error) { console.error(error.message); process.exitCode = 1; }`,
      config,
      String(offline),
    ],
    { encoding: "utf8", cwd: SDK },
  );
}

describe("maintenance fetches use explicit public RPC configuration", () => {
  it.each(FETCHERS)("%s refuses a missing config before any network read", (fetcher) => {
    const result = spawnSync(
      process.execPath,
      [
        "--import=data:text/javascript,globalThis.fetch=()=>{throw new Error('unexpected network access')}",
        join(SCRIPTS, fetcher),
      ],
      { cwd: SDK, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pass --rpc-config <path>");
    expect(result.stderr).not.toContain("unexpected network access");
  });

  it("accepts the capture scripts' flat config and an ordered fallback list", () => {
    const value = {
      1: "https://ethereum.example.com",
      8453: ["https://base.example.com", "https://base-fallback.example.com"],
    };
    const result = readConfig(value);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      [1, [value[1]]],
      [8453, value[8453]],
    ]);
  });

  it.each(FETCHERS)("%s does not echo malformed JSON or its credentials", (fetcher) => {
    writeFileSync(config, '{"1":"https://private-user:private-pass@ethereum.example.com",');
    const result = spawnSync(process.execPath, [join(SCRIPTS, fetcher), "--rpc-config", config], {
      cwd: SDK,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot read --rpc-config as JSON");
    expect(result.stderr).not.toContain("private-");
  });

  it("requires all pinned chains before fetching, including with a warm cache", () => {
    const result = readConfig({ 1: "https://ethereum.example.com" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no endpoint for chain(s) 8453");
  });

  it.each(
    [
      null,
      [],
      { one: "https://ethereum.example.com" },
      { 1: [] },
      { 1: false },
      { 1: "not-a-url-private-value" },
      { 1: "https://private-user:private-pass@ethereum.example.com" },
      { 1: "https://ethereum.example.com?key=private-key" },
      { 1: "https://ethereum.example.com#private-fragment" },
      { 1: "http://ethereum.example.com" },
      { 1: "https://localhost" },
      { 1: "https://127.0.0.1" },
      { 1: "https://[::1]" },
    ].map((value) => [value]),
  )("refuses invalid or credential-bearing config without printing its values: %j", (value) => {
    const result = readConfig(value);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--rpc-config");
    expect(result.stderr).not.toContain("private-");
    expect(result.stderr).not.toContain("unexpected network access");
  });

  it("offline mode reads neither config nor network", () => {
    const result = readConfig(null, true);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it("CI resolves repository variables outside the composite action, and a fork's run gets the same public JSON", () => {
    const workflow = readFileSync(join(SDK, "../.github/workflows/ci.yml"), "utf8");
    const action = readFileSync(join(SDK, "../.github/actions/setup/action.yml"), "utf8");
    const resolved = workflow.match(
      /^ {2}CHAIN_FIXTURE_RPC_CONFIG: \$\{\{ \((.+)\) && '(\{[^']*\})' \|\| vars\.CHAIN_FIXTURE_RPC_CONFIG \}\}$/m,
    );
    expect(resolved).not.toBeNull();
    const [, fork, literal] = resolved!;
    // GitHub passes no repository variable to a fork's pull request: the literal is taken exactly
    // where setup takes the public engine artifacts, and is a config the fetchers accept.
    expect(action).toContain(`if: ${fork}\n`);
    expect(readConfig(JSON.parse(literal)).status).toBe(0);
    expect(action).not.toMatch(/\$\{\{\s*vars\./);
    expect(action).toContain('"$CHAIN_FIXTURE_RPC_CONFIG"');
  });

  it("the fetchers never reach into the command's private endpoint registry", () => {
    for (const fetcher of FETCHERS) {
      const source = readFileSync(join(SCRIPTS, fetcher), "utf8");
      expect(source).not.toMatch(/public-rpcs|createTsLoader|PUBLIC_RPCS/);
      expect(source).toContain("readFixtureRpcConfig");
    }
  });
});

describe("materialized programs always match their pin", () => {
  it.each([
    ["absent", false],
    ["absent", true],
    ["matching", false],
    ["matching", true],
    ["wrong revision", false],
    ["wrong revision", true],
    ["corrupt gzip", false],
    ["corrupt gzip", true],
  ])("%s in-place fixture, cached: %s", (state, cached) => {
    const sdk = join(temporary, "repo/sdk");
    const scripts = join(sdk, "scripts");
    const fixtures = join(sdk, "test/fixtures");
    const fixture = "svm-exact-in-programs";
    mkdirSync(scripts, { recursive: true });
    mkdirSync(join(fixtures, fixture), { recursive: true });
    copyFileSync(join(SCRIPTS, FETCHERS[0]!), join(scripts, FETCHERS[0]!));
    symlinkSync(join(SCRIPTS, "lib"), join(scripts, "lib"), "dir");
    const bytes = Buffer.from("pinned program revision");
    const pin = {
      name: "fixture-program",
      file: "fixture-program.so.gz",
      programId: "DNL1tgEj7wyDijjNFkD3LzNy7RPpkFkSRzVDqev1sGxM",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    writeFileSync(join(fixtures, fixture, "manifest.json"), JSON.stringify({ programs: [pin] }));
    writeFileSync(
      join(fixtures, "fetched-programs.json"),
      JSON.stringify({ programs: [{ fixture, name: pin.name }] }),
    );
    const dest = join(fixtures, fixture, pin.file);
    if (state !== "absent")
      writeFileSync(
        dest,
        state === "corrupt gzip"
          ? Buffer.from("not a gzip")
          : gzipSync(state === "matching" ? bytes : Buffer.from("another program revision")),
      );
    if (cached) {
      const cache = join(sdk, "../node_modules/.cache/sauce-program-fixtures");
      mkdirSync(cache, { recursive: true });
      writeFileSync(join(cache, `${pin.programId}-${pin.sha256}.so`), bytes);
    }
    const result = spawnSync(
      process.execPath,
      [
        "--import=data:text/javascript,globalThis.fetch=()=>{throw new Error('unexpected network access')}",
        join(scripts, FETCHERS[0]!),
        "--offline",
      ],
      { cwd: sdk, encoding: "utf8" },
    );
    expect(result.stderr).not.toContain("unexpected network access");
    if (state === "matching") {
      expect(result.status).toBe(0);
      expect(gunzipSync(readFileSync(dest))).toEqual(bytes);
      expect(result.stdout).toContain("1 already in place, 0 from the cache, 0 fetched, 0 refused");
    } else if (cached) {
      expect(result.status).toBe(0);
      expect(gunzipSync(readFileSync(dest))).toEqual(bytes);
      expect(result.stdout).toContain("0 already in place, 1 from the cache, 0 fetched, 0 refused");
    } else {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not in the cache, and --offline");
      expect(existsSync(dest)).toBe(false);
      expect(result.stdout).toContain("0 already in place, 0 from the cache, 0 fetched, 1 refused");
    }
  });
});
