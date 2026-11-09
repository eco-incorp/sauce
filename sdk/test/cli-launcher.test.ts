import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// No other CLI modules are present: a version refusal must work before resolving its imports.
describe("the sauce launcher on an unsupported Node runtime", () => {
  let work: string;
  let launcher: string;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-launcher-"));
    launcher = join(work, "main.mjs");
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/main.ts", import.meta.url)),
      "utf8",
    );
    writeFileSync(
      launcher,
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    );
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it.each(["22.20.0", "23.11.0"])(
    "refuses Node %s with an upgrade action before loading the command",
    (version) => {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
           await import(${JSON.stringify(pathToFileURL(launcher).href)});`,
          "--",
          "--help",
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/Node\.js 24/);
      expect(result.stderr).toContain(version);
      expect(result.stderr).toMatch(/[Uu]pgrade/);
      expect(result.stderr).toContain("@eco-incorp/sauce@latest");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    },
  );
});
