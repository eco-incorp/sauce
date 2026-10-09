/**
 * A newer `@eco-incorp/sauce`, said by the MCP server: once, in the first tool result of the
 * server's life, since the server prints nothing of its own (over stdio its stdout is the
 * protocol). The `sauce` command hands the server the note (`McpServeOptions.updateNote`), from the
 * cache its update check keeps (`sdk/src/cli/update-check.ts`); over HTTP, where each request gets
 * a server of its own, the process asks for it once ({@link once}), so it is said once however
 * many servers there are.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** `note`, asked once: the first call's answer, then `undefined` from every call after it. */
export function once(note: () => string | undefined): () => string | undefined {
  let asked = false;

  return () => {
    if (asked) return undefined;
    asked = true;
    try {
      return note();
    } catch {
      return undefined;
    }
  };
}

/**
 * `result` with `note` added: to its structured content's `notes` and to the JSON text that
 * repeats that content, as every tool here writes it; otherwise as a text of its own.
 */
export function withNote(result: CallToolResult, note: string): CallToolResult {
  const structured = result.structuredContent;
  const text = { type: "text" as const, text: note };
  if (
    structured === undefined ||
    !(structured.notes === undefined || Array.isArray(structured.notes))
  ) {
    return { ...result, content: [...result.content, text] };
  }
  const noted = { ...structured, notes: [...((structured.notes as unknown[]) ?? []), note] };
  const [first, ...others] = result.content;

  return {
    ...result,
    structuredContent: noted,
    content:
      first?.type === "text" && first.text === JSON.stringify(structured, null, 2)
        ? [{ type: "text", text: JSON.stringify(noted, null, 2) }, ...others]
        : [...result.content, text],
  };
}

type Callback = (...params: unknown[]) => CallToolResult | Promise<CallToolResult>;

/**
 * Every tool registered on `server` from now on returns its result with what `note` says, when it
 * says something: `note` is asked after each result a tool returns (a call that throws asks
 * nothing), so the note is the first result's when `note` is {@link once}'s. Registration is
 * wrapped on this one server, where every module registers its tools, so none is left out.
 */
export function noteResults(server: McpServer, note: () => string | undefined): void {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    callback: Callback,
  ) => unknown;
  const wrapped = (name: string, config: unknown, callback: Callback) =>
    register(name, config, async (...params: unknown[]) => {
      const result = await callback(...params);
      const said = note();

      return said === undefined ? result : withNote(result, said);
    });
  Object.assign(server, { registerTool: wrapped });
}
