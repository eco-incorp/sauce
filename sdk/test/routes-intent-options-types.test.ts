import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

describe("IntentOptions execution types", () => {
  it("defaults the EVM execution, still requires a complete SVM one, and rejects misspellings", () => {
    const sdkDir = resolve(process.cwd());
    const config = ts.readConfigFile(join(sdkDir, "tsconfig.json"), ts.sys.readFile);
    if (config.error) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkDir);
    const probeDir = mkdtempSync(join(tmpdir(), "sauce-intent-options-"));
    const probePath = join(probeDir, "probe.ts");
    const routesPath = join(sdkDir, "src/routes/intent-dsl.js");

    writeFileSync(
      probePath,
      `
        import type { IntentOptions } from ${JSON.stringify(routesPath)};
        const address = "0x1111111111111111111111111111111111111111" as const;
        const common = { deadline: 2000n, portal: address };
        function accepts(options: IntentOptions): void { void options; }

        // An EVM destination needs no execution: the Pot and engine are derived.
        accepts(common);
        accepts({ ...common, execution: { value: 1000n } });
        // Either may be overridden alone, through execution or the shorthand.
        accepts({ ...common, pot: address });
        accepts({ ...common, engine: address });
        accepts({ ...common, pot: address, engine: address });
        accepts({ ...common, execution: { pot: address } });
        accepts({ ...common, execution: { engine: address } });
        accepts({ ...common, execution: { pot: address, engine: address, value: 1n } });
        accepts({ ...common, execution: undefined, pot: address });
        accepts({ ...common, execution: { pot: address }, engine: address });
        accepts({ ...common, execution: { code: "11111111111111111111111111111111", accounts: [] } });
        accepts({ ...common, execution: { code: "11111111111111111111111111111111", accounts: [] }, pot: address });

        // @ts-expect-error A misspelt override would otherwise be a silently derived Pot.
        accepts({ ...common, execution: { pott: address } });
        // @ts-expect-error Explicit SVM execution requires its account list.
        accepts({ ...common, execution: { code: "11111111111111111111111111111111" } });
        // @ts-expect-error Explicit SVM execution requires its staged code address.
        accepts({ ...common, execution: { accounts: [] } });
        // @ts-expect-error The deadline is still required.
        accepts({ portal: address });
      `,
    );

    try {
      const program = ts.createProgram({
        rootNames: [...parsed.fileNames, probePath],
        options: { ...parsed.options, noEmit: true },
      });
      const probe = program.getSourceFile(probePath);
      if (probe === undefined) throw new Error("typecheck probe was not loaded");
      const diagnostics = [
        ...program.getSyntacticDiagnostics(probe),
        ...program.getSemanticDiagnostics(probe),
      ];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual(
        [],
      );
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });
});
