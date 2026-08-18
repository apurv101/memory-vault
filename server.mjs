#!/usr/bin/env node
// Memory Vault — Claude-style memory primitives over a local folder, via MCP.
//
//   node server.mjs        (or: npm start)
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
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const MEMORY_DIR = resolve(process.env.MEMORY_DIR ?? "./memory");
const PORT = Number(process.env.VAULT_PORT ?? 8787);

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "memory-vault", version: "0.2.0" };

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

await mkdir(MEMORY_DIR, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`memory-vault serving ${MEMORY_DIR}`);
  console.log(`MCP endpoints: http://localhost:${PORT}/mcp/<project> (scoped), http://localhost:${PORT}/mcp (whole vault)`);
});
