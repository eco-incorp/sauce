/**
 * The operator release gate (`scripts/release-gate.mjs`) prints no part of a configuration it cannot
 * read: the file is an `--rpc-config` of endpoints that carry keys, so a parse error that quotes an
 * excerpt of it would print a key. Tested through the script itself, which reads the configuration
 * before it does anything else.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/release-gate.mjs");

describe("the release gate's configuration errors", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-release-gate-config-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const URL_TEXT = "https://example.invalid/rpc?key=hunter2-secret-value";

  /** Runs the real script on `file`: it reads the configuration before it does anything else. */
  const gate = (file: string) =>
    spawnSync(process.execPath, [SCRIPT, "--package", "1.0.0", "--rpc-config", file], {
      encoding: "utf8",
      timeout: 60_000,
    });

  it.each([
    ["not JSON: a URL where JSON should be", URL_TEXT],
    ["truncated JSON holding a URL", `{ "1": "${URL_TEXT}`],
    ["JSON text that is a string holding a URL", JSON.stringify(URL_TEXT)],
    ["a JSON array holding a URL", JSON.stringify([URL_TEXT])],
    ["JSON null", "null"],
  ])("says nothing of a configuration that is %s, naming only its path", (_what, text) => {
    const file = join(dir, "malformed.json");
    writeFileSync(file, text);
    const ran = gate(file);

    expect(ran.status).toBe(2);
    const printed = `${ran.stdout}\n${ran.stderr}`;
    // Nothing of the file's text is printed: no run of six of its characters, once its path (which
    // the message names) is taken out, and nothing of what the parser made of it.
    const rest = printed.split(file).join("<the file>");
    const shown = [...text].flatMap((_c, at) =>
      at + 6 <= text.length ? [text.slice(at, at + 6)] : [],
    );
    expect(shown.filter((window) => rest.includes(window))).toEqual([]);
    expect(rest).not.toMatch(/Unexpected token|SyntaxError|is not valid JSON/);
    expect(printed).toContain(file);
  });

  it("names only the path of a configuration it cannot read", () => {
    const file = join(dir, "missing.json");
    const ran = gate(file);

    expect(ran.status).toBe(2);
    expect(ran.stderr).not.toMatch(/ENOENT|no such file/i);
    expect(`${ran.stdout}\n${ran.stderr}`).toContain(file);
  });

  it("does not repeat an endpoint given where the path goes", () => {
    const ran = gate(URL_TEXT);

    expect(ran.status).toBe(2);
    const printed = `${ran.stdout}\n${ran.stderr}`;
    const shown = [...URL_TEXT].flatMap((_c, at) =>
      at + 6 <= URL_TEXT.length ? [URL_TEXT.slice(at, at + 6)] : [],
    );
    expect(shown.filter((window) => printed.includes(window))).toEqual([]);
    expect(printed).toMatch(/takes the path of a file, not a URL/);
  });
});
