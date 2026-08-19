# Memory Vault

Local, persistent memory for coding agents, served over MCP.

Memory Vault stores facts as ordinary Markdown files. Each project gets an isolated memory space, while `shared/` holds facts that apply across projects. The files stay on your machine and remain usable if you change models or agent harnesses.

## How it works

The MCP server gives an agent six file operations: `view`, `create`, `str_replace`, `insert`, `delete`, and `rename`.

The agent uses those tools to maintain small memory files and a `MEMORY.md` index. There is no database, vector search, or embedding model. The Markdown files are the source of truth, so you can read, edit, grep, or version them yourself.

```text
memory/
  MEMORY.md          # index of project spaces
  shared/
    MEMORY.md        # cross-project facts
    *.md
  <project>/
    MEMORY.md        # project index
    *.md
```

A project connection can access its own directory and `shared/`, but not other projects. An unscoped connection can access the whole vault for cross-project maintenance.

## Requirements

- Node.js 18 or newer
- An MCP client that supports Streamable HTTP

Memory Vault has no runtime dependencies.

## Connect a repository

Run this from the repository you want to connect:

```sh
npx -y memory-vault connect
```

This command:

1. Starts the local server if it is not already running.
2. Creates a project-scoped MCP connection.
3. Adds the memory instructions the detected agent harness needs.

By default, `connect` stores memory in `~/.memory-vault` and derives the project name from the current directory.

```sh
npx -y memory-vault connect --dry-run          # preview changes
npx -y memory-vault connect --project my-app  # choose the project name
```

Restart your agent session after connecting and approve the `vault` MCP server if prompted.

### Supported harnesses

| Harness | Files configured |
|---|---|
| Claude Code | `.mcp.json`, `CLAUDE.md` |
| Cursor | `.cursor/mcp.json`, `AGENTS.md` |
| Codex | `.codex/config.toml`, `AGENTS.md` |
| DeepSeek Harness | `dsh-cordis.patch.yml` |

For DSH, start a session with the generated patch:

```sh
dsh --patch ./dsh-cordis.patch.yml --profile headless "your task"
```

## Run the server directly

```sh
MEMORY_DIR=~/.memory-vault npx memory-vault
```

The server listens on `127.0.0.1:8787` by default.

| Environment variable | Default | Purpose |
|---|---|---|
| `MEMORY_DIR` | `./memory` | Directory containing the vault |
| `VAULT_PORT` | `8787` | Local HTTP port |

From a cloned repository, `npm start` runs the same server.

### MCP endpoints

```text
POST /mcp/<project>  project memory plus shared memory
POST /mcp            whole-vault access
```

For example, a manual Claude Code connection is:

```sh
claude mcp add --transport http --scope project vault http://localhost:8787/mcp/my-project
```

## Memory format

Store one durable fact per Markdown file:

```md
---
name: preferred-language
description: The project's preferred implementation language
---

Use TypeScript for new application code.
```

Add a pointer to the space's `MEMORY.md`:

```md
- [preferred-language](preferred-language.md) — use TypeScript for new application code
```

The server instructs agents to check for an existing memory before creating one, update facts instead of duplicating them, and remove memories that become incorrect.

## Current scope

The current release is a local Markdown store, an MCP interface, and a cross-harness setup command.

Automatic extraction, semantic search, programmatic deduplication, contradiction resolution, provenance, review queues, authentication, and remote deployment are not implemented. They are possible future directions, described in [the roadmap](docs/roadmap.md) and [architecture sketch](docs/architecture.md).

## Package

- npm: [`memory-vault`](https://www.npmjs.com/package/memory-vault)
- MCP registry: `io.github.apurv101/memory-vault`
- License: MIT
