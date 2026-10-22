/**
 * The chains the `sauce` command supports (`src/cli/support.ts`) and the chain-support request it
 * links to: the four supported chains, every other one a preview chain, the request's URLs held
 * to the issue form they open (`.github/ISSUE_TEMPLATE/chain-support.yml`), field by field — and
 * none of it in the package's API, which keeps every chain.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalChains, requireChain } from "../src/chains/canonical.js";
import * as chains from "../src/chains/index.js";
import * as root from "../src/index.js";
import {
  CHAIN_SUPPORT_FIELDS,
  CHAIN_SUPPORT_ISSUES_URL,
  CHAIN_SUPPORT_LABEL,
  CHAIN_SUPPORT_NEW_ISSUE_URL,
  CHAIN_SUPPORT_REPOSITORY,
  CHAIN_SUPPORT_TEMPLATE,
  CHAIN_SUPPORT_TITLE_PREFIX,
  chainSupport,
  chainSupportRequest,
  isSupportedChain,
  previewChains,
  SUPPORTED_CHAIN_SLUGS,
  supportedChains,
} from "../src/cli/support.js";

const FORM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".github",
    "ISSUE_TEMPLATE",
    CHAIN_SUPPORT_TEMPLATE,
  ),
  "utf8",
);

/** The form's fields, in order: each `id` with the `label` under it and whether it is required. */
const fields = [...FORM.matchAll(/^ {4}id: ([\w-]+)\n {4}attributes:\n {6}label: (.+)\n/gm)].map(
  (m) => ({ id: m[1]!, label: m[2]! }),
);

/** `url`'s query, as a map. */
const query = (url: string): Record<string, string> =>
  Object.fromEntries(new URL(url).searchParams.entries());

describe("support levels", () => {
  it("supports Ethereum, Base, Arc and Solana, and previews every other chain", () => {
    expect([...SUPPORTED_CHAIN_SLUGS]).toEqual(["ethereum", "base", "arc", "solana"]);
    expect(supportedChains().map((chain) => chain.id)).toEqual([1, 8453, 5042, 1399811149]);
    for (const chain of canonicalChains) {
      const supported = (SUPPORTED_CHAIN_SLUGS as readonly string[]).includes(chain.slug);
      expect([chain.slug, chainSupport(chain)]).toEqual([
        chain.slug,
        supported ? "supported" : "preview",
      ]);
      expect(isSupportedChain(chain)).toBe(supported);
    }
    expect(previewChains()).toHaveLength(canonicalChains.length - 4);
    expect(previewChains().map((chain) => chain.id)).toEqual(
      canonicalChains
        .filter((chain) => !SUPPORTED_CHAIN_SLUGS.includes(chain.slug as never))
        .map((chain) => chain.id)
        .sort((a, b) => a - b),
    );
  });

  it("takes any spelling the registry resolves, and refuses a chain it does not have", () => {
    expect(chainSupport("mainnet")).toBe("supported");
    expect(chainSupport(8453)).toBe("supported");
    expect(chainSupport(1399811149n)).toBe("supported");
    expect(chainSupport("arc-mainnet")).toBe("supported");
    expect(chainSupport("arb")).toBe("preview");
    expect(() => chainSupport("hyperliquid")).toThrow(/Unknown chain 'hyperliquid'/);
    expect(isSupportedChain("hyperliquid")).toBe(false);
  });

  it("is the command's policy alone: the package exports none of it", () => {
    for (const name of [
      "chainSupport",
      "chainSupportRequest",
      "supportedChains",
      "previewChains",
    ]) {
      expect(name in chains).toBe(false);
      expect(name in root).toBe(false);
    }
  });
});

describe("the chain-support issue form", () => {
  it("labels and titles every request as the search and the request expect", () => {
    expect(FORM).toMatch(new RegExp(`^labels: \\["${CHAIN_SUPPORT_LABEL}"\\]$`, "m"));
    expect(FORM).toMatch(new RegExp(`^title: "${CHAIN_SUPPORT_TITLE_PREFIX}"$`, "m"));
  });

  it("has exactly the fields a request prefills, by id and in the body's order", () => {
    expect(fields.map((field) => field.id)).toEqual(Object.values(CHAIN_SUPPORT_FIELDS));
    // Only the contact is optional.
    const required = [...FORM.matchAll(/^ {6}required: (true|false)$/gm)].map((m) => m[1]);
    expect(required).toEqual(["true", "true", "true", "true", "true", "false"]);
  });
});

describe("chainSupportRequest", () => {
  const arbitrum = chainSupportRequest("arbitrum");

  it("titles the request with the chain's name and id", () => {
    expect(arbitrum.chain).toEqual({ name: "Arbitrum One", id: 42161, slug: "arbitrum" });
    expect(arbitrum.title).toBe("Chain support: Arbitrum One (42161)");
  });

  it("searches the repository's chain-support issues for the chain's name", () => {
    expect(
      arbitrum.searchUrl.startsWith(`https://github.com/${CHAIN_SUPPORT_REPOSITORY}/issues?`),
    ).toBe(true);
    expect(query(arbitrum.searchUrl)).toEqual({
      q: 'is:issue label:chain-support "Arbitrum One"',
    });
    expect(query(CHAIN_SUPPORT_ISSUES_URL)).toEqual({ q: "is:issue label:chain-support" });
  });

  it("prefills the form, every query parameter but the template and title one of its fields", () => {
    const url = new URL(arbitrum.newIssueUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://github.com/${CHAIN_SUPPORT_REPOSITORY}/issues/new`,
    );
    expect(query(arbitrum.newIssueUrl)).toEqual({
      template: CHAIN_SUPPORT_TEMPLATE,
      title: arbitrum.title,
      chain: "Arbitrum One",
      "chain-id": "42161",
    });
    const ids = new Set(fields.map((field) => field.id));
    const filled = chainSupportRequest(10, {
      useCase: "pay suppliers in USDC",
      protocols: "Uniswap V3, USDC",
      volume: "1M USDC a month, from June",
      contact: "ops@example.com",
    });
    const keys = Object.keys(query(filled.newIssueUrl)).filter(
      (key) => key !== "template" && key !== "title",
    );
    expect(keys.sort()).toEqual([...ids].sort());
    expect(query(filled.newIssueUrl)["use-case"]).toBe("pay suppliers in USDC");
    expect(query(CHAIN_SUPPORT_NEW_ISSUE_URL)).toEqual({ template: CHAIN_SUPPORT_TEMPLATE });
  });

  it("writes the body as the form writes an issue: each field's label as a heading", () => {
    const headings = [...arbitrum.body.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(fields.map((field) => field.label));
    expect(arbitrum.body).toContain("### Chain\n\nArbitrum One\n\n### Chain id\n\n42161");
    expect(arbitrum.body).toContain("<what you want to run on Arbitrum One>");
    expect(arbitrum.body).toMatch(/### Contact\n\n_No response_$/);
    const filled = chainSupportRequest("optimism", { useCase: "a distributed swap" });
    expect(filled.body).toContain("### What you want to run there\n\na distributed swap");
    expect(filled.comment).toBe(
      [
        "Another use case for Optimism (10):",
        "",
        "- What you want to run there: a distributed swap",
        "- Protocols and tokens: <the protocols and tokens it needs>",
        "- Expected volume and timing: <the volume you expect, and from when>",
      ].join("\n"),
    );
  });

  it("asks for a chain the registry does not have, by name and id", () => {
    const request = chainSupportRequest({ name: "Hyperliquid", id: 999 });
    expect(request.chain).toEqual({ name: "Hyperliquid", id: 999 });
    expect(request.title).toBe("Chain support: Hyperliquid (999)");
    expect(query(request.newIssueUrl)).toMatchObject({ chain: "Hyperliquid", "chain-id": "999" });
    const unnumbered = chainSupportRequest({ name: "Somechain" });
    expect(unnumbered.title).toBe("Chain support: Somechain");
    expect(query(unnumbered.newIssueUrl)["chain-id"]).toBeUndefined();
    expect(unnumbered.body).toContain("### Chain id\n\n<its chain id>");
  });

  it("names a registry chain however it is spelt", () => {
    expect(chainSupportRequest(requireChain("arb"))).toEqual(arbitrum);
    expect(chainSupportRequest(42161)).toEqual(arbitrum);
  });
});
