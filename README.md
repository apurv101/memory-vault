# Memory Vault

Your coding agents don't share a memory. Memory Vault gives them one — teach Claude Code a convention, leave mid-task, and Codex picks up exactly where it stopped. No database, no embeddings: plain Markdown files on your machine, wired to every agent over MCP with one command.

![Claude Code and Codex sharing one memory](demo.gif)

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

## Install into a repository

Run this from the repository you want to connect:

```sh
npx -y memory-vault install
```

This command:

1. Starts the local server if it is not already running.
2. Asks which harnesses to wire up, with the detected ones pre-selected (interactive terminals only — everywhere else the detected set is used as is).
3. Writes each chosen harness's MCP config and the shared rules files.

By default, `install` stores memory in `~/.memory-vault` and derives the project name from the current directory. `connect` is an alias for `install`.

```sh
npx -y memory-vault install --dry-run                # preview changes
npx -y memory-vault install --project my-app         # choose the project name
npx -y memory-vault install --harness claude,codex   # skip the prompt, pick explicitly
npx -y memory-vault install --yes                    # skip the prompt, accept detected
```

Restart your agent session after installing and approve the `vault` MCP server if prompted.

## Uninstall from a repository

```sh
npx -y memory-vault uninstall
```

Removes everything `install` wrote to the repository — the MCP entries, the rules sections, the dsh patch — deleting a file only when it held nothing else. Your memories are never touched, and the server keeps running for other projects. `disconnect` is an alias for `uninstall`.

## Check the wiring

```sh
npx -y memory-vault status
```

Shows whether the server is up and which store it serves, how the current repository is wired per harness, and every repository recorded by `install` (kept in `~/.memory-vault-connections.json`). If the server is up and the repo is wired but your agent session has no vault tools, the remaining cause is session attachment — `status` prints how to fix it.

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

The current release is a local Markdown store, an MCP interface, and a cross-harness setup command. There is no automatic extraction, semantic search, deduplication, authentication, or remote deployment.

## Package

- npm: [`memory-vault`](https://www.npmjs.com/package/memory-vault)
- MCP registry: `io.github.apurv101/memory-vault`
- License: MIT
