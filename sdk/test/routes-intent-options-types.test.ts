import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

describe("IntentOptions execution types", () => {
  it("requires a complete execution form and preserves explicit execution precedence", () => {
    const sdkDir = resolve(process.cwd());
    const config = ts.readConfigFile(join(sdkDir, "tsconfig.json"), ts.sys.readFile);
    if (config.error) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkDir);
    const probeDir = mkdtempSync(join(tmpdir(), "sauce-intent-options-"));
    const probePath = join(probeDir, "probe.ts");
    const routesPath = join(sdkDir, "src/routes/index.js");

    writeFileSync(
      probePath,
      `
        import type { IntentOptions } from ${JSON.stringify(routesPath)};
        const address = "0x1111111111111111111111111111111111111111" as const;
        const common = { deadline: 2000n, portal: address };
        function accepts(options: IntentOptions): void { void options; }

        accepts({ ...common, pot: address, engine: address });
        accepts({ ...common, execution: { pot: address, engine: address } });
        accepts({ ...common, execution: { code: "11111111111111111111111111111111", accounts: [] } });

        // Explicit execution wins at runtime, so redundant shorthand fields remain accepted.
        accepts({ ...common, execution: { pot: address, engine: address }, pot: address });
        accepts({ ...common, execution: { pot: address, engine: address }, engine: address });
        accepts({ ...common, execution: { pot: address, engine: address }, pot: address, engine: address });
        accepts({ ...common, execution: { code: "11111111111111111111111111111111", accounts: [] }, pot: address });

        // @ts-expect-error An intent always needs destination execution details.
        accepts(common);
        // @ts-expect-error The shorthand requires an engine alongside its Pot.
        accepts({ ...common, pot: address });
        // @ts-expect-error The shorthand requires a Pot alongside its engine.
        accepts({ ...common, engine: address });
        // @ts-expect-error Undefined execution does not bypass shorthand requirements.
        accepts({ ...common, execution: undefined, pot: address });
        // @ts-expect-error Explicit EVM execution also requires its engine.
        accepts({ ...common, execution: { pot: address } });
        // @ts-expect-error Explicit EVM execution also requires its Pot.
        accepts({ ...common, execution: { engine: address } });
        // @ts-expect-error Explicit SVM execution requires its account list.
        accepts({ ...common, execution: { code: "11111111111111111111111111111111" } });
        // @ts-expect-error Explicit SVM execution requires its staged code address.
        accepts({ ...common, execution: { accounts: [] } });
        // @ts-expect-error Invalid explicit execution cannot fall back to valid shorthand.
        accepts({ ...common, execution: { pot: address }, pot: address, engine: address });
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
