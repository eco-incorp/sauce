/**
 * Two prompts for the tasks an agent comes to Sauce for — writing a program and running it, and
 * opening a cross-chain intent — each the workflow through this server's tools, with the skill the
 * task starts from embedded, for a client that offers prompts but does not let its model read
 * resources itself.
 *
 * Skills are named by directory and embedded only when the package ships them, so a renamed skill
 * leaves the prompt pointing at the index rather than at nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import { shippedSkills, SKILLS_INDEX, type Skill } from "./resources.js";
import { PACKAGED_SKILLS } from "./sdk.js";

export const PROMPT_NAMES = ["sauce_write_program", "sauce_open_intent"] as const;

/** The resource for `dir`, embedded; or nothing when the package ships no such skill. */
function embedded(skills: readonly Skill[], dir: string, root: string) {
  const skill = skills.find((each) => each.dir === dir);
  if (skill === undefined) return [];

  return [
    {
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: skill.uri,
          mimeType: "text/markdown",
          text: readFileSync(join(root, skill.dir, "SKILL.md"), "utf8"),
        },
      },
    },
  ];
}

/** `dirs` as the skill resources to read, those the package ships. */
const readList = (skills: readonly Skill[], dirs: readonly string[]): string =>
  [
    ...dirs.flatMap((dir) => skills.filter((skill) => skill.dir === dir).map((skill) => skill.uri)),
    SKILLS_INDEX,
  ].join(", ");

export function registerPrompts(server: McpServer, root: string = PACKAGED_SKILLS): void {
  const skills = shippedSkills(root);

  server.registerPrompt(
    "sauce_write_program",
    {
      title: "Write, compile and run a Sauce program",
      description:
        "Walks an agent through a Sauce program for a task, end to end with this server's " +
        "tools: read the skills, look up the chain's names, compile, rehearse, and build the " +
        "unsigned Pot deployment and cook for the user to sign.",
      argsSchema: {
        task: z.string().min(1).max(4000).describe("What the program should do, in plain words."),
        chain: z.string().max(64).optional().describe("The chain it runs on (base, solana, 8453)."),
      },
    },
    ({ task, chain }): GetPromptResult => ({
      description: "Write, compile, rehearse and build a Sauce program",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Write a Sauce program that does this${chain === undefined ? "" : ` on ${chain}`}: ${task}`,
              "",
              `Read the Sauce skills first (with sauce_skill, or as resources: ${readList(skills, ["sauce-overview", "sauce-script", "sauce-run"])}),`,
              "and follow them. Then, with this server's tools:",
              "1. sauce_globals for the chain: use the token symbols and protocol namespaces it lists",
              "   rather than writing addresses. (A fixed list of protocol calls can be an action",
              "   program in JSON instead: sauce_actions.)",
              "2. sauce_compile until the program compiles; read any error and fix the line it names.",
              "3. sauce_simulate, with an endpoint (rpcUrl, or the server's own), to rehearse the",
              "   cook from the Pot's owner: check what it moved (or why it reverts) before going on.",
              "4. sauce_pot for the owner's Pot, and its deploy transaction if it is not deployed.",
              "5. sauce_tx for the unsigned cook transaction.",
              "Nothing here signs: hand the owner the unsigned transactions to sign and send with",
              "their own wallet, and never ask for a private key.",
            ].join("\n"),
          },
        },
        ...embedded(skills, "sauce-overview", root),
      ],
    }),
  );

  server.registerPrompt(
    "sauce_open_intent",
    {
      title: "Open a cross-chain intent",
      description:
        "Walks an agent through a Sauce program that opens a cross-chain intent: read the " +
        "intents skill, compile with the intent's deadline and creator, and build the unsigned " +
        "transactions that publish and fund it (or the cook that opens it from a Pot).",
      argsSchema: {
        task: z
          .string()
          .min(1)
          .max(4000)
          .describe("What should happen on the destination chain, and the reward."),
        source: z.string().max(64).optional().describe("The chain the intent is opened from."),
        destination: z.string().max(64).optional().describe("The chain it is filled on."),
      },
    },
    ({ task, source, destination }): GetPromptResult => ({
      description: "Open a Sauce cross-chain intent",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Write a Sauce program that opens a cross-chain intent" +
                (source === undefined ? "" : ` from ${source}`) +
                (destination === undefined ? "" : ` to ${destination}`) +
                `: ${task}`,
              "",
              `Read the Sauce skills first (with sauce_skill, or as resources: ${readList(skills, ["sauce-overview", "sauce-intents"])}),`,
              "and follow them. Then, with this server's tools:",
              "1. sauce_globals for each chain involved, for its tokens and protocols.",
              "2. sauce_compile with the intent's deadline and creator (intentDeadline,",
              "   intentCreator) until it compiles; its intents are listed by sauce_inspect with",
              "   the source alone.",
              "3. For an intent fixed when it is built: sauce_publish for the unsigned approvals and",
              "   Portal.publishAndFund, from the wallet that funds the reward (dryRun to rehearse",
              "   them, with an endpoint). For one that measures a value on chain:",
              "   run the program on a Pot with sauce_tx.",
              "Nothing here signs: hand the wallet's owner the unsigned transactions, in order, and",
              "never ask for a private key.",
            ].join("\n"),
          },
        },
        ...embedded(skills, "sauce-intents", root),
      ],
    }),
  );
}
