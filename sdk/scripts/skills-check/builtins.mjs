// Checks the SauceScript reference (skills/sauce-script/references/) against the compiler:
//   - builtins.json: every entry's example program compiles on each target it lists, and where an
//     entry is single-target, its program for the other target fails with the error it states;
//     its count is its length;
//   - builtins.md: every example in a table's "Example" column compiles, on each target its row
//     claims, inside a `main` that declares the names the example uses without declaring them;
//   - every form in a "Rejected" column, and every program in builtins-rejections.mjs, is refused;
//   - every error message builtins.md quotes matches what the compiler says, and every quoted
//     message and every row of its "Not supported" table is claimed by a program that triggers it.
import { stripVTControlCharacters } from "node:util";

import { rejections } from "./builtins-rejections.mjs";

// ---- Reading the markdown -------------------------------------------------------------------------
// Code spans per CommonMark: a run of N backticks opens, the next run of exactly N closes.
function spans(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === "`") n++;
    const open = i;
    i += n;
    let j = i;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (text[j + m] === "`") m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) continue;
    let code = text.slice(i, close);
    if (/^ .* $/.test(code) && code.trim() !== "") code = code.slice(1, -1);
    out.push({ start: open, end: close + n, code });
    i = close + n;
  }
  return out;
}
// Double-quoted text outside code spans: the reference quotes compiler messages this way.
function quotes(text) {
  const code = spans(text);
  const marks = [];
  for (let k = 0; k < text.length; k++)
    if (text[k] === '"' && !code.some((s) => k >= s.start && k < s.end)) marks.push(k);
  const out = [];
  for (let q = 0; q + 1 < marks.length; q += 2) out.push(text.slice(marks[q] + 1, marks[q + 1]));
  return out;
}
function cells(line) {
  const code = spans(line);
  const parts = [];
  let last = 0;
  for (let k = 0; k < line.length; k++)
    if (line[k] === "|" && line[k - 1] !== "\\" && !code.some((s) => k >= s.start && k < s.end)) {
      parts.push(line.slice(last, k));
      last = k + 1;
    }
  parts.push(line.slice(last));
  return parts.slice(1, -1).map((c) => c.trim().replace(/\\\|/g, "|"));
}
// An entry's labelled detail, `  - Example: …`, and the column of a table row it stands for.
const LABELS = {
  Types: "Types",
  Example: "Example",
  "On EVM": "EVM",
  "On SVM": "SVM",
  "Reverts when": "Reverts when",
};
// Table rows, with their header and section, and paragraphs or lists joined into one text. An
// entry, a top-level list item with indented details beneath (`- \`form\` …` then `  - Example: …`),
// is read as a row: the item's line is its "Form" (and its "Targets", where it names **Both**,
// **EVM** or **SVM**), and each labelled detail the column its label names.
function blocks(md) {
  const out = [];
  let section = "";
  let header = null;
  let para = [];
  let entry = null;
  const flush = () => {
    if (para.length) out.push({ section, text: para.join(" ") });
    para = [];
  };
  const close = () => {
    if (entry === null) return;
    const head = entry.head.join(" ");
    if (entry.details.length === 0) para.push(head);
    else {
      const targets = /\*\*(?:Both|EVM|SVM)\*\*/.test(head) ? ["Targets"] : [];
      const details = entry.details.map(({ label, text }) => ({ label, text: text.join(" ") }));
      out.push({
        section,
        header: ["Form", ...targets, ...details.map((d) => d.label)],
        row: [head, ...targets.map(() => head), ...details.map((d) => d.text)],
        text: [head, ...details.map((d) => d.text)].join(" | "),
      });
    }
    entry = null;
  };
  let fenced = false;
  for (const line of md.split("\n")) {
    // A fenced program is code, compiled as a ```sauce block, not prose: nothing in it is quoted.
    if (/^\s*```/.test(line)) {
      close();
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const detail = /^ {2}- (.*)$/.exec(line);
    if (entry !== null && detail !== null) {
      const labelled = /^([A-Z][A-Za-z ]*?): (.*)$/.exec(detail[1]);
      const label = labelled !== null ? LABELS[labelled[1]] : undefined;
      entry.details.push(
        label !== undefined
          ? { label, text: [labelled[2]] }
          : { label: "Behaviour", text: [detail[1]] },
      );
      continue;
    }
    if (entry !== null && /^ {2,}\S/.test(line)) {
      (entry.details.at(-1)?.text ?? entry.head).push(line.trim());
      continue;
    }
    close();
    if (/^#{1,6} /.test(line)) {
      flush();
      section = line.replace(/^#+ /, "");
      header = null;
    } else if (line.startsWith("|")) {
      flush();
      const row = cells(line);
      if (header === null) header = row;
      else if (!row.every((c) => /^:?-+:?$/.test(c)))
        out.push({ section, header, row, text: row.join(" | ") });
    } else if (line.startsWith("- ")) {
      header = null;
      entry = { head: [line.slice(2).trim()], details: [] };
    } else {
      header = null;
      if (line.trim() === "" || /^-{3,}$/.test(line.trim())) flush();
      else para.push(line.trim());
    }
  }
  close();
  flush();
  return out;
}

// ---- Matching messages ----------------------------------------------------------------------------
const flat = (s) =>
  stripVTControlCharacters(String(s)).replace(/`/g, "").replace(/\s+/g, " ").trim();
// `…` elides text, `N` stands for a number, `<placeholder>` for a name.
const pattern = (quote) =>
  new RegExp(
    flat(quote)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/…/g, ".*?")
      .replace(/<[^>]+>/g, ".+?")
      .replace(/\bN\b/g, "\\d+"),
  );

// ---- The harness an example compiles in -----------------------------------------------------------
// The type of each name an example uses without declaring it; any other name is a number.
const BYTES = ["data", "program", "sig", "query", "input", "selector", "instruction"];
const ACCOUNTS = [
  "vault",
  "tokenAccount",
  "tokenProgram",
  "source",
  "destination",
  "acct",
  "state",
];
const ARRAYS = { amounts: "Uint256[]" };
const SVM_ROLES = {
  state: "Account<Writable, Signer>",
  source: "Account<Writable>",
  destination: "Account<Writable>",
};
const ABIS = {
  ERC20: JSON.stringify([
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      type: "function",
      name: "totalSupply",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      type: "function",
      name: "approve",
      stateMutability: "nonpayable",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ]),
  Library: JSON.stringify([
    {
      type: "function",
      name: "run",
      stateMutability: "nonpayable",
      inputs: [{ name: "x", type: "uint256" }],
      outputs: [],
    },
  ]),
};
const RESERVED = new Set(
  "const let if else for while of return true false new Array require revert throw log eval hex ctx crypto Math abi evm svm function break continue".split(
    " ",
  ),
);
function typeOf(name, target, code) {
  if (BYTES.includes(name)) return "bytes";
  if (ARRAYS[name]) return ARRAYS[name];
  const account =
    ACCOUNTS.includes(name) || (/svm\.call\(/.test(code) && ["owner", "router"].includes(name));
  if (account) return target === "svm" && SVM_ROLES[name] ? SVM_ROLES[name] : "Account";
  return "Uint256";
}
function freeNames(code) {
  const body = code.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/hex`[^`]*`/g, "hex``");
  const declared = new Set();
  for (const m of body.matchAll(/\b(?:const|let)\s+(\[[^\]]*\]|\w+)/g))
    for (const n of m[1].match(/\w+/g) ?? []) declared.add(n);
  const names = new Set();
  // Identifiers that are not a property (after `.`) or a record key (before `:`).
  for (const m of body.matchAll(/(?<![\w.$])([A-Za-z_]\w*)\b(?!\s*:)/g))
    if (!RESERVED.has(m[1]) && !declared.has(m[1]) && !ABIS[m[1]]) names.add(m[1]);
  // A shorthand record field, `{ amount }`, is a value.
  for (const m of body.matchAll(/[{,]\s*([A-Za-z_]\w*)\s*(?=[,}])/g))
    if (!RESERVED.has(m[1]) && !declared.has(m[1])) names.add(m[1]);
  return [...names];
}
function harness(code, target) {
  const body = code.replace(/\{ … \}/g, "{ }").replace(/…/g, "");
  const params = [];
  const prelude = [];
  for (const name of freeNames(body)) {
    if (name === "USDC") {
      // A token symbol is an SDK name; here it is a bound ERC-20.
      params.push("usdc: Uint256");
      prelude.push("const USDC = ERC20.at(usdc);");
    } else if (/\.catch\(/.test(body) && new RegExp(`\\b${name}\\s*=`).test(body)) {
      prelude.push(`let ${name} = true;`); // a variable the handler assigns
    } else params.push(`${name}: ${typeOf(name, target, body)}`);
  }
  const returns = /^return\b/.test(body.trim()) ? "bytes" : "void";
  const statement = /[;}]\s*$/.test(body.trim()) ? body : `const value = ${body};`;
  return `function main(${params.join(", ")}): ${returns} { ${prelude.join(" ")} ${statement} }`;
}
// The targets an example compiles on: its row's claim, narrowed by what the example itself uses.
function targetsOf(block, code) {
  let claimed = ["evm", "svm"];
  const column = block.header.indexOf("Targets");
  if (column !== -1) {
    const t = block.row[column];
    if (/\*\*EVM\*\*/.test(t)) claimed = ["evm"];
    else if (/\*\*SVM\*\*/.test(t)) claimed = ["svm"];
  } else if (/\(EVM\)/.test(block.section)) claimed = ["evm"];
  else if (/\(SVM\)/.test(block.section)) claimed = ["svm"];
  for (const target of ["evm", "svm"]) {
    const col = block.header.indexOf(target.toUpperCase());
    if (col !== -1 && /^not available/.test(block.row[col]))
      claimed = claimed.filter((x) => x !== target);
  }
  if (/\bsvm\./.test(code)) claimed = claimed.filter((x) => x === "svm");
  if (/\b(?:evm|abi)\.|\b(?:ERC20|Library|USDC)\b|\.catch\(|\blog\([^)]*,/.test(code))
    claimed = claimed.filter((x) => x === "evm");
  return claimed;
}

// ---- The check ------------------------------------------------------------------------------------
export function checkBuiltins(md, compiler, fail, where) {
  const counts = { examples: 0, rejected: 0 };
  const enc = new TextEncoder();
  const build = ({ src, files = {}, contracts, sdkPackages }, target) => {
    const all = { "main.ts": src, ...files };
    return compiler.compile({
      target,
      entry: "main.ts",
      resolve: (p) => {
        const key = p.replace(/^\.\//, "");
        if (all[key] !== undefined) return enc.encode(all[key]);
        return sdkPackages ? compiler.resolveSdkModule(p) : undefined;
      },
      ...(sdkPackages ? { resolvePackage: (s) => compiler.resolveSdkPackage(s) } : {}),
      ...(contracts ? { inlineContracts: contracts } : {}),
    });
  };
  const all = blocks(md);
  const messages = [];

  for (const block of all.filter((b) => b.row)) {
    const example = block.header.indexOf("Example");
    for (const { code } of example === -1 ? [] : spans(block.row[example])) {
      const targets = targetsOf(block, code);
      if (targets.length === 0) fail(where, `\`${code}\` claims no target it can compile on`);
      for (const target of targets) {
        const src = harness(code, target);
        try {
          build({ src, contracts: Object.entries(ABIS) }, target);
          counts.examples++;
        } catch (error) {
          fail(where, `example \`${code}\` does not compile on ${target}: ${flat(error.message)}`);
        }
      }
    }
    const rejected = block.header.indexOf("Rejected");
    for (const { code } of rejected === -1 ? [] : spans(block.row[rejected])) {
      try {
        build({ src: `function main(): void { const value = ${code}; }` }, "evm");
        fail(where, `\`${code}\` is listed as rejected, but it compiles`);
      } catch (error) {
        messages.push(flat(error.message));
        counts.rejected++;
      }
    }
  }

  const doc = flat(md);
  for (const r of rejections) {
    for (const target of r.targets) {
      let message;
      try {
        build(r, target);
      } catch (error) {
        message = flat(error.message);
      }
      if (message === undefined) {
        fail(where, `must be rejected on ${target}, but compiles: ${r.src.slice(0, 120)}`);
        continue;
      }
      counts.rejected++;
      for (const quote of r.quotes ?? [])
        if (!pattern(quote).test(message))
          fail(where, `"${quote}" is not what the compiler says on ${target}: ${message}`);
    }
    for (const quote of r.quotes ?? [])
      if (!doc.includes(flat(quote))) fail(where, `does not quote "${quote}"`);
  }
  for (const quote of all.flatMap((b) => quotes(b.text)))
    if (!rejections.some((r) => (r.quotes ?? []).some((q) => q.includes(quote))))
      fail(where, `quotes "${quote}", which no program in builtins-rejections.mjs triggers`);
  const unsupported = all
    .filter((b) => b.row && b.header[0] === "Not supported")
    .map((b) => b.row[0]);
  for (const row of unsupported)
    if (!rejections.some((r) => r.row === row))
      fail(
        where,
        `"${row}" is listed as not supported, but builtins-rejections.mjs tries none of it`,
      );
  for (const r of rejections)
    if (r.row && !unsupported.includes(r.row)) fail(where, `has no "Not supported" row "${r.row}"`);
  return counts;
}

// ---- builtins.json ----------------------------------------------------------------------------------
export function checkBuiltinsJson(doc, compiler, fail, where) {
  const counts = { compiled: 0, rejected: 0 };
  const enc = new TextEncoder();
  const build = (program, target, item) =>
    compiler.compile({
      target,
      resolve: (p) => (p === "main.js" ? enc.encode(program) : undefined),
      ...(item.contracts ? { inlineContracts: item.contracts.map((n) => [n, doc.abis[n]]) } : {}),
    });
  if (doc.count !== doc.intrinsics.length)
    fail(where, `count is ${doc.count}, but it lists ${doc.intrinsics.length} entries`);
  for (const item of doc.intrinsics) {
    for (const target of item.targets) {
      const program = item.example?.[target];
      if (program === undefined) {
        fail(where, `${item.name} has no example for ${target}`);
        continue;
      }
      try {
        build(program, target, item);
        counts.compiled++;
      } catch (error) {
        fail(where, `${item.name} does not compile on ${target}: ${flat(error.message)}`);
      }
    }
    for (const [target, { program, error }] of Object.entries(item.unavailable ?? {})) {
      try {
        build(program, target, item);
        fail(where, `${item.name} compiles on ${target}, where it is documented as unavailable`);
      } catch (thrown) {
        counts.rejected++;
        if (!flat(thrown.message).includes(flat(error)))
          fail(where, `${item.name} on ${target} says "${flat(thrown.message)}", not "${error}"`);
      }
    }
  }
  return counts;
}
