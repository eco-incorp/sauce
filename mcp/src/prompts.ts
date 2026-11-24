/**
 * A prompt for the task an agent comes to Sauce for — writing a program and running it — the
 * workflow through this server's tools, with the skill the task starts from embedded, for a client
 * that offers prompts but does not let its model read resources itself.
 *
 * Skills are named by directory and embedded only when the package ships them, so a renamed skill
 * leaves the prompt pointing at the index rather than at nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import { shippedSkills, SKILLS_INDEX, WRITE_IT_YOURSELF, type Skill } from "./resources.js";
import {
  PACKAGED_SKILLS,
  resolveChain,
  SUPPORTED_CHAIN_SLUGS,
  supportedChainNames,
} from "./sdk.js";

export const PROMPT_NAMES = ["sauce_write_program"] as const;

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

/** Whether a prompt's `chain` argument names a Solana chain: an SVM chain by slug, alias or id
 *  (`solana`, `devnet`, `1399811149`), or `svm`. */
const solana = (chain: string | undefined): boolean => {
  const name = chain?.trim() ?? "";

  return (
    /^svm$/i.test(name) ||
    (name !== "" && resolveChain(/^\d+$/.test(name) ? Number(name) : name)?.kind === "svm")
  );
};

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
        "tools: read the skills, look up the chain's names, compile, simulate, and build the " +
        "unsigned Pot deployment and cook for the user to sign.",
      argsSchema: {
        task: z.string().min(1).max(4000).describe("What the program should do, in plain words."),
        chain: z
          .string()
          .max(64)
          .optional()
          .describe(`The chain it runs on, by slug or id (${SUPPORTED_CHAIN_SLUGS.join(", ")}).`),
      },
    },
    ({ task, chain }): GetPromptResult => ({
      description: "Write, compile, simulate and build a Sauce program",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Write a Sauce program that does this${chain === undefined ? "" : ` on ${chain}`}: ${task}`,
              "",
              `Read the Sauce skills first (with sauce_skill, or as resources: ${readList(skills, solana(chain) ? ["sauce-overview", "sauce-solana", "sauce-cli"] : ["sauce-overview", "sauce-script", "sauce-chains", "sauce-cli"])}),`,
              "and follow them.",
              ...(chain === undefined
                ? ["No chain is given: ask the user which, a testnet to prototype or mainnet."]
                : []),
              "A testnet (arc-testnet, base-sepolia, sepolia) has USDC, CCTP and Circle Gateway but no",
              "DEX, lending market or oracle: compile and simulate a swap, a pool or a lending market",
              "on mainnet (arc, base, ethereum), where sauce_simulate signs and sends nothing.",
              ...WRITE_IT_YOURSELF,
              "Then, with this server's tools:",
              "1. sauce_globals for the chain: use the token symbols and protocol namespaces it lists",
              "   rather than writing addresses. (A fixed sequence of protocol operations can be an",
              "   actions document in JSON instead: sauce_actions, and the sauce-actions skill.)",
              "2. sauce_compile until the program compiles; read any error and fix the line it names.",
              "3. sauce_simulate, to simulate the cook from the Pot's owner: check what it moved (or",
              "   why it reverts) before going on. assumeBalance gives the Pot a balance for that",
              "   simulation only: tell the user the result assumed it, and say whether it ran on a",
              "   testnet or mainnet.",
              "4. sauce_pot for the owner's Pot: its address and what it holds. Its deployment needs",
              "   no step of its own: sauce_tx plans it first when the Pot has no code yet.",
              "5. sauce_tx for the unsigned cook transaction.",
              `Transactions are built only on ${supportedChainNames()}: on any other chain (a`,
              "preview chain) steps 1, 2 and 4 work (sauce_pot reads the prediction), step 3 runs",
              "wherever the release is deployed on the chain, and step 5 returns `refused` with the",
              "chain-support request to offer the user instead.",
              "Nothing here signs: hand the owner the unsigned transactions to sign and send with",
              "their own wallet, and never ask for a private key.",
            ].join("\n"),
          },
        },
        ...embedded(skills, solana(chain) ? "sauce-solana" : "sauce-overview", root),
      ],
    }),
  );
}
