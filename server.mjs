#!/usr/bin/env node
// Memory Vault — Claude-style memory primitives over a local folder, via MCP.
//
//   node server.mjs                (or: npm start) — serve the vault
//   npx memory-vault install       — wire the current repo to the vault
//                                    (starts the server if down, lets you pick
//                                    harnesses, writes each one's MCP config +
//                                    the shared rules files; alias: connect)
//   npx memory-vault uninstall     — undo install for the repo; memories are
//                                    never touched (alias: disconnect)
//
// The store is a plain directory of markdown files (default ./memory), one
// subdirectory per project plus an org-wide shared/ space, each with its own
// MEMORY.md index. The server exposes the same core commands as Claude's
// memory tool — view, create, str_replace, insert, delete, rename. The model
// does the rest, exactly as Claude does natively: it keeps the index, one
// file per memory, and decides what deserves saving.
//
// Scoping: POST /mcp/<project> sandboxes a session to memory/<project>/ plus
// the read-write shared/ space; bare POST /mcp is the unscoped whole-vault
// (gardener) view.
//
// Env:
//   MEMORY_DIR   the memory folder (default ./memory)
//   VAULT_PORT   listen port on 127.0.0.1 (default 8787)
//
// MCP: stateless Streamable HTTP — POST one JSON-RPC message per request.
// Connect (per repo): claude mcp add --transport http --scope project vault http://localhost:8787/mcp/<project>

import { createServer } from "node:http";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename as fsRename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { openSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MEMORY_DIR = resolve(process.env.MEMORY_DIR ?? "./memory");
const PORT = Number(process.env.VAULT_PORT ?? 8787);

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "memory-vault", version: "0.3.1" };

const instructionsFor = (scope) =>
  scope
    ? `You have a persistent memory directory for the project "${scope}". MEMORY.md at its root is this project's index — view it before starting work, and read any memory file it points to that looks relevant.

Each memory is one markdown file holding one fact, with frontmatter (name: kebab-case slug, description: one-line summary), stored at the root of the directory. After writing a memory file, add or update its one-line pointer in MEMORY.md ("- [name](file.md) — hook"). Before saving, check whether an existing file already covers it — update that file rather than creating a duplicate; delete memories that turn out to be wrong, and remove their index line.

The shared/ directory is org-wide memory visible to every project, with its own shared/MEMORY.md index — check it for relevant org facts, and store facts that apply beyond this project there (updating shared/MEMORY.md).

Store durable facts, corrections, lessons, and decisions — things that should outlive this session and be visible to every future session in every harness. Don't store what the repo or chat history already records.`
    : `You are viewing the whole memory vault. Each subdirectory is one project's memory space with its own MEMORY.md index; shared/ is org-wide memory visible to every project. The root MEMORY.md lists the spaces — view it and the relevant space's MEMORY.md before starting work.

Each memory is one markdown file holding one fact, with frontmatter (name: kebab-case slug, description: one-line summary). After writing a memory file, add or update its one-line pointer in that space's MEMORY.md ("- [name](file.md) — hook"). Before saving, check whether an existing file already covers it — update that file rather than creating a duplicate; delete memories that turn out to be wrong, and remove their index line.

Store durable facts, corrections, lessons, and decisions — things that should outlive this session and be visible to every future session in every harness. Don't store what the repo or chat history already records.`;

// ── Path sandbox ──────────────────────────────────────────────────────────────

class ToolError extends Error {}

const scopeDir = (scope) => join(MEMORY_DIR, scope);
const SHARED_DIR = join(MEMORY_DIR, "shared");
const under = (abs, root) => abs === root || abs.startsWith(root + sep);

function resolvePath(p, scope) {
  if (typeof p !== "string" || !p.trim()) throw new ToolError("path is required");
  // Tolerate "/memories/foo.md" and "memories/foo.md" spellings.
  const cleaned = p.trim().replace(/^\/?(memories\/)?/, "");
  // In a project scope, "shared/…" is carved out to the vault-level shared space.
  const inShared = scope && (cleaned === "shared" || cleaned.startsWith("shared/"));
  const abs = resolve(scope && !inShared ? scopeDir(scope) : MEMORY_DIR, cleaned);
  const roots = scope ? [scopeDir(scope), SHARED_DIR] : [MEMORY_DIR];
  if (!roots.some((root) => under(abs, root))) {
    throw new ToolError(`path escapes the memory directory: ${p}`);
  }
  return abs;
}

function rel(abs, scope) {
  if (scope) {
    if (under(abs, SHARED_DIR)) return join("shared", relative(SHARED_DIR, abs));
    return relative(scopeDir(scope), abs) || ".";
  }
  return relative(MEMORY_DIR, abs) || ".";
}

// ── The six memory commands ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: "view",
    description:
      "View a file or directory in the memory folder. Directories list their entries; files return numbered lines. Start every session by viewing MEMORY.md, the index.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the memory root ('.' for the root listing)" },
        view_range: {
          type: "array",
          items: { type: "number" },
          description: "Optional [start, end] line range (1-indexed, inclusive)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "create",
    description:
      "Create or overwrite a file in the memory folder. Memories are markdown files with 'name:' and 'description:' frontmatter; after creating one, update MEMORY.md.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the memory root" },
        file_text: { type: "string", description: "Full file contents" },
      },
      required: ["path", "file_text"],
    },
  },
  {
    name: "str_replace",
    description:
      "Replace an exact string in a memory file. The old string must occur exactly once.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the memory root" },
        old_str: { type: "string", description: "Exact text to replace (must be unique in the file)" },
        new_str: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  {
    name: "insert",
    description: "Insert text after a given line in a memory file (0 = beginning of file).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the memory root" },
        insert_line: { type: "number", description: "Line number to insert after (0 = top)" },
        insert_text: { type: "string", description: "Text to insert" },
      },
      required: ["path", "insert_line", "insert_text"],
    },
  },
  {
    name: "delete",
    description:
      "Delete a file or directory in the memory folder. Remember to remove the memory's line from MEMORY.md.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the memory root" },
      },
      required: ["path"],
    },
  },
  {
    name: "rename",
    description: "Move or rename a file or directory within the memory folder.",
    inputSchema: {
      type: "object",
      properties: {
        old_path: { type: "string", description: "Current path relative to the memory root" },
        new_path: { type: "string", description: "New path relative to the memory root" },
      },
      required: ["old_path", "new_path"],
    },
  },
];

async function callTool(name, args, scope) {
  if (scope) await mkdir(scopeDir(scope), { recursive: true });
  switch (name) {
    case "view": {
      const abs = resolvePath(args.path, scope);
      const st = await stat(abs).catch(() => null);
      if (!st) throw new ToolError(`not found: ${args.path}`);
      if (st.isDirectory()) {
        const entries = await readdir(abs, { withFileTypes: true });
        const lines = entries
          .filter((e) => !e.name.startsWith("."))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort();
        return `Directory: ${rel(abs, scope)}\n${lines.join("\n") || "(empty)"}`;
      }
      const lines = (await readFile(abs, "utf8")).split("\n");
      let [start, end] = Array.isArray(args.view_range) ? args.view_range : [1, lines.length];
      start = Math.max(1, Number(start) || 1);
      end = Math.min(lines.length, Number(end) || lines.length);
      return lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(4)}: ${l}`)
        .join("\n");
    }

    case "create": {
      const abs = resolvePath(args.path, scope);
      if (typeof args.file_text !== "string") throw new ToolError("file_text is required");
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, args.file_text);
      return `Created ${rel(abs, scope)}`;
    }

    case "str_replace": {
      const abs = resolvePath(args.path, scope);
      const text = await readFile(abs, "utf8").catch(() => {
        throw new ToolError(`not found: ${args.path}`);
      });
      const { old_str: oldStr, new_str: newStr } = args;
      if (typeof oldStr !== "string" || typeof newStr !== "string") {
        throw new ToolError("old_str and new_str are required");
      }
      const count = text.split(oldStr).length - 1;
      if (count === 0) throw new ToolError("old_str not found in file");
      if (count > 1) throw new ToolError(`old_str occurs ${count} times — must be unique`);
      await writeFile(abs, text.replace(oldStr, newStr));
      return `Edited ${rel(abs, scope)}`;
    }

    case "insert": {
      const abs = resolvePath(args.path, scope);
      const text = await readFile(abs, "utf8").catch(() => {
        throw new ToolError(`not found: ${args.path}`);
      });
      const lines = text.split("\n");
      const at = Number(args.insert_line);
      if (!Number.isInteger(at) || at < 0 || at > lines.length) {
        throw new ToolError(`insert_line must be between 0 and ${lines.length}`);
      }
      lines.splice(at, 0, String(args.insert_text ?? ""));
      await writeFile(abs, lines.join("\n"));
      return `Inserted into ${rel(abs, scope)} after line ${at}`;
    }

    case "delete": {
      const abs = resolvePath(args.path, scope);
      if (abs === MEMORY_DIR || (scope && (abs === scopeDir(scope) || abs === SHARED_DIR))) {
        throw new ToolError("refusing to delete the memory root");
      }
      const st = await stat(abs).catch(() => null);
      if (!st) throw new ToolError(`not found: ${args.path}`);
      await rm(abs, { recursive: true });
      return `Deleted ${rel(abs, scope)}`;
    }

    case "rename": {
      const from = resolvePath(args.old_path, scope);
      const to = resolvePath(args.new_path, scope);
      if (!(await stat(from).catch(() => null))) throw new ToolError(`not found: ${args.old_path}`);
      await mkdir(dirname(to), { recursive: true });
      await fsRename(from, to);
      return `Renamed ${rel(from, scope)} → ${rel(to, scope)}`;
    }

    default:
      throw new JsonRpcError(-32602, `Unknown tool: ${name}`);
  }
}

// ── JSON-RPC / MCP dispatch ───────────────────────────────────────────────────

class JsonRpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function dispatch(method, params, scope) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion)
          ? params.protocolVersion
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(scope),
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      if (typeof params?.name !== "string") {
        throw new JsonRpcError(-32602, "tools/call requires a tool name");
      }
      try {
        const text = await callTool(params.name, params.arguments ?? {}, scope);
        return { content: [{ type: "text", text }], isError: false };
      } catch (err) {
        if (err instanceof JsonRpcError) throw err;
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
    default:
      throw new JsonRpcError(-32601, `Method not found: ${method}`);
  }
}

// ── HTTP server (127.0.0.1 only) ──────────────────────────────────────────────

const rpcJson = (id, payload) => JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...payload });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(
      `memory-vault (local) — store: ${MEMORY_DIR}\n` +
        `MCP endpoints: POST /mcp/<project> (project scope), POST /mcp (whole vault)\n` +
        `Connect (per repo): claude mcp add --transport http --scope project vault http://localhost:${PORT}/mcp/<project>\n`,
    );
    return;
  }
  const scopeMatch = url.pathname.match(/^\/mcp(?:\/([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?$/);
  if (!scopeMatch) {
    res.writeHead(404).end("Not found");
    return;
  }
  const scope = scopeMatch[1]?.toLowerCase();
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let message;
  try {
    message = JSON.parse(body);
  } catch {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(rpcJson(null, { error: { code: -32700, message: "Parse error" } }));
    return;
  }
  if (Array.isArray(message) || typeof message !== "object" || message === null) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(rpcJson(null, { error: { code: -32600, message: "Expected a single JSON-RPC message" } }));
    return;
  }
  if (message.id === undefined || message.id === null) {
    res.writeHead(202).end(); // notification
    return;
  }

  try {
    const result = await dispatch(message.method, message.params, scope);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(rpcJson(message.id, { result }));
  } catch (err) {
    const code = err instanceof JsonRpcError ? err.code : -32603;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(rpcJson(message.id, { error: { code, message: err.message } }));
  }
});

// ── connect — wire the current repo to the vault ──────────────────────────────
//
// One command replaces the setup recipe: make sure the server is up, then for
// each harness present write both layers it needs — the MCP registration in
// its own config format, and the memory ritual in a rules file it loads.

const SELF = fileURLToPath(import.meta.url);
const exists = (p) => stat(p).then(() => true, () => false);

const MEMORY_SECTION = `## Memory

This repo uses the vault MCP server (\`vault\`) for persistent memory. At session start, view \`MEMORY.md\` with the vault tools and read any entries relevant to the task. Before finishing, save durable facts, corrections, lessons, and decisions to the vault — one markdown file per fact with \`name:\`/\`description:\` frontmatter — and add or update its line in \`MEMORY.md\`. Check whether an existing memory already covers it before creating a new one. Facts that apply beyond this project go in \`shared/\` (update \`shared/MEMORY.md\`). Prefer the vault over any built-in auto-memory.
`;

// Markers around the written section let uninstall remove it verbatim even if
// the section text changes in a future version. (Sections written before the
// markers existed are removed by exact-text match instead.)
const MARK_BEGIN = "<!-- memory-vault:begin -->";
const MARK_END = "<!-- memory-vault:end -->";
const MARKED_SECTION = `${MARK_BEGIN}\n${MEMORY_SECTION}${MARK_END}\n`;

const projectSlug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);

// Machine-level record of which repos ran install — advisory, not
// authoritative (repos move and vanish), so readers treat entries as hints.
// Lives outside the store: it describes this machine's wiring, not memories.
const CONNECTIONS_PATH = join(homedir(), ".memory-vault-connections.json");

async function readConnections() {
  try {
    const parsed = JSON.parse(await readFile(CONNECTIONS_PATH, "utf8"));
    return Array.isArray(parsed.connections) ? parsed.connections : [];
  } catch {
    return [];
  }
}

async function writeConnections(connections) {
  await writeFile(CONNECTIONS_PATH, JSON.stringify({ connections }, null, 2) + "\n");
}

async function serverUp() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

// Merge one entry into a { mcpServers: { ... } } JSON config, preserving the
// rest of the file. Returns "created" | "updated" | "unchanged".
async function mergeMcpJson(path, entry, dryRun) {
  const raw = await readFile(path, "utf8").catch(() => null);
  let config = {};
  if (raw !== null) {
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(`${path} is not valid JSON — fix it or add the vault entry by hand`);
    }
  }
  config.mcpServers ??= {};
  if (JSON.stringify(config.mcpServers.vault) === JSON.stringify(entry)) return "unchanged";
  const status = raw === null ? "created" : "updated";
  config.mcpServers.vault = entry;
  if (!dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2) + "\n");
  }
  return status;
}

// Reverse of mergeMcpJson: drop the vault entry, delete the file if that was
// all it held. Returns a status string for the report.
async function removeMcpJson(path, dryRun) {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return "not present";
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return "not valid JSON — remove the vault entry by hand";
  }
  if (!config.mcpServers?.vault) return "no vault entry";
  delete config.mcpServers.vault;
  const empty = Object.keys(config).length === 1 && Object.keys(config.mcpServers).length === 0;
  if (!dryRun) {
    if (empty) await rm(path);
    else await writeFile(path, JSON.stringify(config, null, 2) + "\n");
  }
  return empty ? "deleted (only held the vault entry)" : "vault entry removed";
}

// ── harness registry ──────────────────────────────────────────────────────────
//
// Each harness owns three hooks: detect (is it on this machine / in this
// repo), install (write its MCP registration), and uninstall (remove exactly
// what install wrote, leaving the repo as it was). The shared rules files
// (AGENTS.md + CLAUDE.md) are a separate step because every harness reads the
// same ritual text. Adding a harness = adding one entry here.

const HARNESSES = [
  {
    key: "claude",
    title: "Claude Code",
    where: ".mcp.json",
    // .mcp.json is the repo-level MCP convention, useful beyond Claude Code —
    // always on.
    detect: async () => true,
    async install({ cwd, url, dryRun }) {
      const status = await mergeMcpJson(join(cwd, ".mcp.json"), { type: "http", url }, dryRun);
      return [`claude   .mcp.json ${status} (vault → ${url})`];
    },
    async uninstall({ cwd, dryRun }) {
      return [`claude   .mcp.json ${await removeMcpJson(join(cwd, ".mcp.json"), dryRun)}`];
    },
  },
  {
    key: "cursor",
    title: "Cursor",
    where: ".cursor/mcp.json",
    detect: async (cwd) => (await exists(join(homedir(), ".cursor"))) || (await exists(join(cwd, ".cursor"))),
    async install({ cwd, url, dryRun }) {
      const status = await mergeMcpJson(join(cwd, ".cursor", "mcp.json"), { url }, dryRun);
      return [`cursor   .cursor/mcp.json ${status}`];
    },
    async uninstall({ cwd, dryRun }) {
      const status = await removeMcpJson(join(cwd, ".cursor", "mcp.json"), dryRun);
      if (!dryRun && status.startsWith("deleted")) await rmdir(join(cwd, ".cursor")).catch(() => {});
      return [`cursor   .cursor/mcp.json ${status}`];
    },
  },
  {
    key: "codex",
    title: "Codex CLI",
    where: ".codex/config.toml",
    detect: async (cwd) => (await exists(join(homedir(), ".codex"))) || (await exists(join(cwd, ".codex"))),
    async install({ cwd, url, dryRun }) {
      // Project-scoped Codex config (trusted projects). TOML is appended, not
      // parsed — if a vault block already exists we only verify the URL.
      const tomlPath = join(cwd, ".codex", "config.toml");
      const toml = await readFile(tomlPath, "utf8").catch(() => null);
      if (toml === null || !toml.includes("[mcp_servers.vault]")) {
        if (!dryRun) {
          await mkdir(dirname(tomlPath), { recursive: true });
          await writeFile(tomlPath, `${toml?.trimEnd() ? toml.trimEnd() + "\n\n" : ""}[mcp_servers.vault]\nurl = "${url}"\n`);
        }
        return [`codex    .codex/config.toml ${toml === null ? "created" : "updated"} (trusted projects only)`];
      }
      return [
        toml.includes(`url = "${url}"`)
          ? "codex    .codex/config.toml unchanged"
          : `codex    .codex/config.toml already has a vault entry with a different url — update it by hand to ${url}`,
      ];
    },
    async uninstall({ cwd, dryRun }) {
      const tomlPath = join(cwd, ".codex", "config.toml");
      const toml = await readFile(tomlPath, "utf8").catch(() => null);
      if (toml === null) return ["codex    .codex/config.toml not present"];
      if (!toml.includes("[mcp_servers.vault]")) return ["codex    .codex/config.toml no vault entry"];
      const cleaned = toml.replace(/(?:^|\n)\[mcp_servers\.vault\]\n(?:(?!\[).*(?:\n|$))*/, "\n").replace(/^\n+/, "");
      if (cleaned.trim() === "") {
        if (!dryRun) {
          await rm(tomlPath);
          await rmdir(join(cwd, ".codex")).catch(() => {});
        }
        return ["codex    .codex/config.toml deleted (only held the vault entry)"];
      }
      if (!dryRun) await writeFile(tomlPath, cleaned.trimEnd() + "\n");
      return ["codex    .codex/config.toml vault entry removed"];
    },
  },
  {
    key: "dsh",
    title: "DeepSeek Harness",
    where: "dsh-cordis.patch.yml",
    detect: async () => exists(join(homedir(), ".dsh")),
    async install({ cwd, url, project, dryRun }) {
      // Repo-local Cordis patch with the project-scoped URL. dsh has no repo-level
      // auto-loaded config, so the patch is applied per-session via --patch (or
      // copied into a profile to make it permanent — the file header says how).
      const patchPath = join(cwd, "dsh-cordis.patch.yml");
      const patchEntry = `- id: mcp-vault\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: vault\n    transport: streamable-http\n    url: ${url}\n`;
      const patchContent = `# dsh Cordis patch — load the memory-vault MCP server (project "${project}").\n# Per-session:  dsh --patch ./dsh-cordis.patch.yml [--profile <name>] ["your task"]\n# Permanent:    copy the entry below into ~/.dsh/profiles/<name>/cordis.patch.yml\n# The vault server must be running (npx memory-vault install starts it if down).\n${patchEntry}`;
      const patch = await readFile(patchPath, "utf8").catch(() => null);
      if (patch === patchContent || (patch !== null && patch.includes("id: mcp-vault") && patch.includes(`url: ${url}`))) {
        return ["dsh      dsh-cordis.patch.yml unchanged — run: dsh --patch ./dsh-cordis.patch.yml"];
      }
      if (patch !== null && patch.includes("id: mcp-vault")) {
        return [`dsh      dsh-cordis.patch.yml already has a vault entry with a different url — update it by hand to ${url}`];
      }
      if (patch !== null) {
        if (!dryRun) await writeFile(patchPath, `${patch.trimEnd()}\n\n${patchEntry}`);
        return ["dsh      dsh-cordis.patch.yml updated — run: dsh --patch ./dsh-cordis.patch.yml"];
      }
      if (!dryRun) await writeFile(patchPath, patchContent);
      return ["dsh      dsh-cordis.patch.yml created — run: dsh --patch ./dsh-cordis.patch.yml"];
    },
    async uninstall({ cwd, dryRun }) {
      const patchPath = join(cwd, "dsh-cordis.patch.yml");
      const patch = await readFile(patchPath, "utf8").catch(() => null);
      if (patch === null) return ["dsh      dsh-cordis.patch.yml not present"];
      if (!patch.includes("id: mcp-vault")) return ["dsh      dsh-cordis.patch.yml no vault entry"];
      const cleaned = patch.replace(/(?:^|\n)- id: mcp-vault\n(?:[ \t].*(?:\n|$))*/, "\n");
      const onlyComments = cleaned.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("#"));
      if (onlyComments) {
        if (!dryRun) await rm(patchPath);
        return ["dsh      dsh-cordis.patch.yml deleted"];
      }
      if (!dryRun) await writeFile(patchPath, cleaned.trimEnd() + "\n");
      return ["dsh      dsh-cordis.patch.yml vault entry removed"];
    },
  },
];

// The ritual. AGENTS.md carries it (Codex, Cursor, and the growing
// cross-harness convention); CLAUDE.md imports it via @AGENTS.md so the
// text lives in one place.
async function installRules({ cwd, project, dryRun }) {
  const lines = [];
  const agentsPath = join(cwd, "AGENTS.md");
  const agents = await readFile(agentsPath, "utf8").catch(() => null);
  if (agents === null) {
    if (!dryRun) await writeFile(agentsPath, `# ${project}\n\n${MARKED_SECTION}`);
    lines.push("rules    AGENTS.md created with the memory section");
  } else if (!/vault/i.test(agents)) {
    if (!dryRun) await writeFile(agentsPath, `${agents.trimEnd()}\n\n${MARKED_SECTION}`);
    lines.push("rules    AGENTS.md memory section appended");
  } else {
    lines.push("rules    AGENTS.md unchanged");
  }

  const claudeMdPath = join(cwd, "CLAUDE.md");
  const claudeMd = await readFile(claudeMdPath, "utf8").catch(() => null);
  if (claudeMd === null) {
    if (!dryRun) await writeFile(claudeMdPath, "@AGENTS.md\n");
    lines.push("rules    CLAUDE.md created (imports @AGENTS.md)");
  } else if (!/vault/i.test(claudeMd) && !claudeMd.includes("@AGENTS.md")) {
    if (!dryRun) await writeFile(claudeMdPath, `${claudeMd.trimEnd()}\n\n@AGENTS.md\n`);
    lines.push("rules    CLAUDE.md @AGENTS.md import appended");
  } else {
    lines.push("rules    CLAUDE.md unchanged");
  }
  return lines;
}

async function uninstallRules({ cwd, project, dryRun }) {
  const lines = [];
  const agentsPath = join(cwd, "AGENTS.md");
  const agents = await readFile(agentsPath, "utf8").catch(() => null);
  let sectionRemoved = false;
  let agentsDeleted = false;
  if (agents === null) {
    lines.push("rules    AGENTS.md not present");
  } else {
    // Marker-delimited sections first (written by install going forward),
    // exact text of the current section as fallback for older installs.
    const marked = /(?:^|\n)<!-- memory-vault:begin -->\n[\s\S]*?<!-- memory-vault:end -->\n?/;
    let cleaned = null;
    if (marked.test(agents)) cleaned = agents.replace(marked, "\n");
    else if (agents.includes(MEMORY_SECTION)) cleaned = agents.replace(MEMORY_SECTION, "");
    if (cleaned === null) {
      lines.push(
        /vault/i.test(agents)
          ? "rules    AGENTS.md mentions the vault but not the standard section — edit by hand"
          : "rules    AGENTS.md no memory section",
      );
    } else {
      sectionRemoved = true;
      const rest = cleaned.trim();
      if (rest === "" || rest === `# ${project}`) {
        if (!dryRun) await rm(agentsPath);
        agentsDeleted = true;
        lines.push("rules    AGENTS.md deleted (only held the memory section)");
      } else {
        if (!dryRun) await writeFile(agentsPath, cleaned.replace(/\n{3,}/g, "\n\n").trim() + "\n");
        lines.push("rules    AGENTS.md memory section removed");
      }
    }
  }

  const claudeMdPath = join(cwd, "CLAUDE.md");
  const claudeMd = await readFile(claudeMdPath, "utf8").catch(() => null);
  if (claudeMd === null) {
    lines.push("rules    CLAUDE.md not present");
  } else if (claudeMd.trim() === "@AGENTS.md" && (agentsDeleted || sectionRemoved)) {
    if (!dryRun) await rm(claudeMdPath);
    lines.push("rules    CLAUDE.md deleted (only imported AGENTS.md)");
  } else if ((agentsDeleted || sectionRemoved) && /\n@AGENTS\.md\s*$/.test(claudeMd)) {
    if (!dryRun) await writeFile(claudeMdPath, claudeMd.replace(/\n+@AGENTS\.md\s*$/, "\n"));
    lines.push("rules    CLAUDE.md @AGENTS.md import removed");
  } else if (/vault/i.test(claudeMd)) {
    lines.push("rules    CLAUDE.md mentions the vault — review by hand");
  } else {
    lines.push("rules    CLAUDE.md unchanged");
  }
  return lines;
}

// Interactive harness picker — plain readline, no dependencies. Only used
// when stdin/stdout are a terminal and no --harness/--yes flag was given.
async function pickHarnesses(detected) {
  console.log("Harnesses to wire to the vault:\n");
  HARNESSES.forEach((h, i) => {
    const mark = detected.includes(h.key) ? "detected" : "not detected";
    console.log(`  ${i + 1}. ${h.key.padEnd(8)} ${h.title.padEnd(18)} ${h.where.padEnd(24)} ${mark}`);
  });
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`\nInstall for [${detected.join(", ")}] — Enter to accept, or list keys/numbers, or "all": `)
  ).trim();
  rl.close();
  if (answer === "") return detected;
  if (answer.toLowerCase() === "all") return HARNESSES.map((h) => h.key);
  const keys = [];
  for (const tok of answer.split(/[,\s]+/).filter(Boolean)) {
    const h = /^\d+$/.test(tok) ? HARNESSES[Number(tok) - 1] : HARNESSES.find((x) => x.key === tok.toLowerCase());
    if (!h) throw new Error(`unknown harness: ${tok} (known: ${HARNESSES.map((x) => x.key).join(", ")})`);
    if (!keys.includes(h.key)) keys.push(h.key);
  }
  return keys;
}

async function install(argv) {
  let project = null;
  let dryRun = false;
  let harnessFlag = null;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") project = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--harness") harnessFlag = argv[++i];
    else if (argv[i] === "--yes" || argv[i] === "-y") yes = true;
    else
      throw new Error(
        `unknown flag: ${argv[i]} (usage: memory-vault install [--project <name>] [--harness <keys>] [--yes] [--dry-run])`,
      );
  }
  const cwd = process.cwd();
  project = projectSlug(project ?? basename(cwd));
  if (!project) throw new Error("could not derive a project name from the directory — pass --project <name>");
  const url = `http://localhost:${PORT}/mcp/${project}`;
  const ctx = { cwd, url, project, dryRun };
  const lines = [];

  // 1. The server. If it's already up it keeps its own MEMORY_DIR; only a
  // fresh start needs a store location.
  if (await serverUp()) {
    lines.push(`server   already running on port ${PORT}`);
  } else if (dryRun) {
    lines.push(`server   down — would start it (store: ${process.env.MEMORY_DIR ?? join(homedir(), ".memory-vault")})`);
  } else {
    const storeDir = resolve(process.env.MEMORY_DIR ?? join(homedir(), ".memory-vault"));
    const log = openSync(join(tmpdir(), "memory-vault.log"), "a");
    spawn(process.execPath, [SELF], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, MEMORY_DIR: storeDir },
    }).unref();
    for (let i = 0; i < 20 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 250));
    if (!(await serverUp())) throw new Error(`started the server but it did not come up — see ${join(tmpdir(), "memory-vault.log")}`);
    lines.push(`server   started on port ${PORT} (store: ${storeDir}, log: ${join(tmpdir(), "memory-vault.log")})`);
  }

  // 2. Pick harnesses: --harness wins; otherwise the detected set, confirmed
  // interactively when there's a terminal to ask.
  const detected = [];
  for (const h of HARNESSES) if (await h.detect(cwd)) detected.push(h.key);
  let selected;
  if (harnessFlag !== null) {
    selected = harnessFlag.split(/[,\s]+/).filter(Boolean);
    for (const key of selected) {
      if (!HARNESSES.some((h) => h.key === key))
        throw new Error(`unknown harness: ${key} (known: ${HARNESSES.map((h) => h.key).join(", ")})`);
    }
  } else if (yes || dryRun || !process.stdin.isTTY || !process.stdout.isTTY) {
    selected = detected;
  } else {
    selected = await pickHarnesses(detected);
  }

  // 3. MCP registration for each selected harness, then the shared ritual.
  for (const h of HARNESSES) {
    if (selected.includes(h.key)) lines.push(...(await h.install(ctx)));
    else lines.push(`${h.key.padEnd(9)}${detected.includes(h.key) ? "skipped" : "not detected — skipped"}`);
  }
  if (selected.length > 0) lines.push(...(await installRules(ctx)));

  // 4. Record the connection so status / a future uninstall --all can find it.
  if (selected.length > 0 && !dryRun) {
    const connections = (await readConnections()).filter((c) => c.repo !== cwd);
    connections.push({ repo: cwd, project, url, harnesses: selected, installedAt: new Date().toISOString() });
    await writeConnections(connections);
    lines.push(`registry ${CONNECTIONS_PATH} recorded`);
  }

  console.log(`memory-vault install — project "${project}"${dryRun ? " (dry run)" : ""}\n`);
  for (const l of lines) console.log(`  ${l}`);
  console.log("\nRestart your session and approve the vault MCP server when prompted.");
}

async function uninstall(argv) {
  let project = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") project = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
    else throw new Error(`unknown flag: ${argv[i]} (usage: memory-vault uninstall [--project <name>] [--dry-run])`);
  }
  const cwd = process.cwd();
  project = projectSlug(project ?? basename(cwd));
  const ctx = { cwd, project, dryRun };
  const lines = [];
  for (const h of HARNESSES) lines.push(...(await h.uninstall(ctx)));
  lines.push(...(await uninstallRules(ctx)));

  const connections = await readConnections();
  if (connections.some((c) => c.repo === cwd)) {
    if (!dryRun) await writeConnections(connections.filter((c) => c.repo !== cwd));
    lines.push("registry connection entry removed");
  } else {
    lines.push("registry no entry for this repo");
  }

  console.log(`memory-vault uninstall — project "${project}"${dryRun ? " (dry run)" : ""}\n`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(
    "\nYour memories are untouched — the store stays in the vault directory (default ~/.memory-vault).\n" +
      "The server keeps running for other projects; restart your agent session to drop the vault tools.",
  );
}

// ── CLI dispatch ──────────────────────────────────────────────────────────────

// status — the three-layer diagnosis: server up? repo wired? and if both,
// the remaining failure mode is session attachment, which only a session
// restart / approval can fix, so say exactly that.
async function status() {
  const cwd = process.cwd();
  console.log("memory-vault status\n");

  let banner = null;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    banner = (await res.text()).trim().split("\n")[0];
  } catch {}
  console.log(
    banner !== null
      ? `  server   up on port ${PORT} — ${banner}`
      : `  server   down (port ${PORT}) — start it: npx memory-vault install (or serve)`,
  );

  console.log(`\n  this repo (${cwd}):`);
  for (const h of HARNESSES) {
    const raw = await readFile(join(cwd, h.where), "utf8").catch(() => null);
    const state = raw === null ? "not present" : /vault/i.test(raw) ? "wired" : "present, no vault entry";
    console.log(`  ${h.key.padEnd(9)}${h.where} ${state}`);
  }
  const agents = await readFile(join(cwd, "AGENTS.md"), "utf8").catch(() => null);
  console.log(
    `  rules    AGENTS.md ${agents === null ? "not present" : /vault/i.test(agents) ? "has the memory section" : "no memory section"}`,
  );

  const connections = await readConnections();
  if (connections.length === 0) {
    console.log("\n  connected repos: none recorded (installs record here from v0.3.1 on)");
  } else {
    console.log(`\n  connected repos (${connections.length}):`);
    for (const c of connections) {
      const there = await exists(c.repo);
      console.log(`    ${c.repo} → ${c.project}${there ? "" : "  (missing — moved or deleted)"}`);
    }
  }

  console.log(
    "\n  If the server is up and the repo is wired but your agent session has no vault\n" +
      "  tools: MCP servers attach at session start — restart the session and approve\n" +
      "  the vault server. Claude Code remembers a declined approval: run /mcp in the\n" +
      "  session, or `claude mcp reset-project-choices` in the repo, then restart.",
  );
}

const USAGE = `memory-vault — Claude-style memory over a local folder, via MCP

  memory-vault [serve]      serve the vault (MEMORY_DIR, VAULT_PORT)
  memory-vault install      wire the current repo to the vault: start the
                            server if down, pick harnesses (interactive in
                            a terminal), write each one's MCP config and
                            the shared rules files      (alias: connect)
                            [--project <name>] [--harness <keys>] [--yes] [--dry-run]
  memory-vault uninstall    undo install for this repo: remove the vault
                            wiring from every harness config and rules
                            file; memories are never touched
                                                        (alias: disconnect)
                            [--project <name>] [--dry-run]
  memory-vault status       show server state, this repo's wiring, and every
                            repo recorded by install`;

const cmd = process.argv[2];
if (cmd === "install" || cmd === "connect") {
  try {
    await install(process.argv.slice(3));
  } catch (err) {
    console.error(`memory-vault install: ${err.message}`);
    process.exit(1);
  }
} else if (cmd === "uninstall" || cmd === "disconnect") {
  try {
    await uninstall(process.argv.slice(3));
  } catch (err) {
    console.error(`memory-vault uninstall: ${err.message}`);
    process.exit(1);
  }
} else if (cmd === "status") {
  await status();
} else if (cmd === undefined || cmd === "serve") {
  await mkdir(MEMORY_DIR, { recursive: true });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`memory-vault serving ${MEMORY_DIR}`);
    console.log(`MCP endpoints: http://localhost:${PORT}/mcp/<project> (scoped), http://localhost:${PORT}/mcp (whole vault)`);
  });
} else {
  console.log(USAGE);
  process.exit(cmd === "help" || cmd === "--help" || cmd === "-h" ? 0 : 1);
}
