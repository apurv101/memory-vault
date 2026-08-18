# Memory Vault

An organizational memory layer that works with any harness, any model. Customer-owned, permission-first, harness-neutral.

**Thesis**: the harness is temporary, the model is temporary, the memory is the org. The vault holds the one asset that survives every model swap and every vendor switch.

## What it is

- **Store**: memories as raw content plus metadata (provenance, ACLs, expiry). Embeddings are rebuilt from raw content, so the vault is never locked to an embedding model.
- **Interface**: MCP server for reads and writes, plus ingestion pipelines for an org's existing corpus (docs, tickets, chat, code).
- **Write governance**: the actual product. Session-to-memory extraction, dedup, contradiction resolution, decay, review queues, provenance on every entry.

## What it is not

- Not a harness. Harnesses are each vendor's crown jewels; the vault sits one layer below, where a standard interface (MCP) already exists.
- Not hosted memory. The vault lives inside the customer's perimeter.
- Not a model. Intelligence is rented; memory is owned.

## MVP: a local vault — Claude-style memory over a folder

Local-only, zero dependencies, one file (`server.mjs`). The store is a plain directory (`memory/`) of markdown files with `MEMORY.md` indexes — the same shape Claude Code keeps its own memory in. The server exposes exactly Claude's core memory commands over MCP — `view`, `create`, `str_replace`, `insert`, `delete`, `rename` — sandboxed to the requesting project's slice of that folder. No search engine, no database, no auth: the *model* maintains the index, checks for duplicates, and decides what to keep, guided by the server's instructions. Files are the source of truth — edit them by hand, grep them, sync the folder with git.

### Layout — per-project spaces + a shared org layer

```
memory/
  MEMORY.md               # vault index: one line per space
  shared/                 # org-wide memory, read-write from every project scope
    MEMORY.md
  <project>/              # one space per project, isolated from the others
    MEMORY.md
    *.md
    skills/<name>/        # whole skill folders scraped into the vault
```

The scope is carried in the URL: `POST /mcp/<project>` sandboxes a session to `memory/<project>/` plus `shared/`; bare `POST /mcp` is the unscoped whole-vault view — the org "gardener" scope for pruning across projects and promoting facts into `shared/`.

### Run

```sh
npm start                   # serves ./memory at http://localhost:8787 (127.0.0.1 only)
```

Env knobs: `MEMORY_DIR` (store location), `VAULT_PORT`.

### Connect from Claude Code

Per repo (recorded in the repo's `.mcp.json`):

```sh
claude mcp add --transport http --scope project vault http://localhost:8787/mcp/<project>
```

Optionally also at user scope for the whole-vault gardener view — the project-scope entry of the same name wins inside a repo:

```sh
claude mcp add --transport http --scope user vault http://localhost:8787/mcp
```

New sessions get the memory tools; the server must be running.

### Connect from DeepSeek Harness

DSH loads MCP servers as Cordis plugin instances via `@deepseek-ai/dsh-mcp-client`. A ready-to-use patch is in `dsh-cordis.patch.yml`:

```sh
# Per-session (workspace-local)
dsh --profile headless --patch ./dsh-cordis.patch.yml "your task"

# Or make it permanent by copying the entry into:
#   ~/.dsh/profiles/headless/cordis.patch.yml
#   ~/.dsh/profiles/web/cordis.patch.yml
```

The patch connects to the local vault at `http://localhost:8787/mcp/memory-vault`; tools appear as `mcp__vault__view`, `mcp__vault__create`, etc. The server must be running.

### Seed a corpus

Copy markdown files into `memory/<project>/` (or `memory/shared/`) — the store is the folder. Give each `name:` and `description:` frontmatter and an index line in that space's `MEMORY.md` (or let the model tidy that up next session).

### Cold-start an existing repo (memory scraper)

First time connecting the vault on a repo that already has harness memory? Scrape it in:

```sh
node scripts/scrape.mjs <repo-path> [--dry-run]     # writes into memory/<project>/
```

Per-harness adapters, each stamping its own `source` (`scrape:<adapter>`) and origin path:

| Adapter | Scrapes |
|---|---|
| `claude-memory` | `~/.claude/projects/<repo-slug>/memory/*.md` (Claude Code auto-memory) |
| `claude-instructions` | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` |
| `claude-skills` | `.claude/skills/*` (whole folders, into `skills/<name>/`; add `--include-user-skills` for `~/.claude/skills/*`), `.claude/commands/*.md`, `.claude/agents/*.md` |
| `codex` | `AGENTS.md` |
| `cursor` | `.cursorrules`, `.cursor/rules/*` |

Everything lands in `memory/<project>/` (project = repo dir name, override with `--project`) and only that project's `MEMORY.md` is rebuilt. Names are stable, so re-running is an idempotent refresh. `--only <a,b>` runs a subset of adapters (`skills` = `claude-skills`). User-level files (`~/.claude/CLAUDE.md`, `~/.claude/skills/`) are personal, not org memory — opt in with `--include-user` / `--include-user-skills`. `--dry-run` previews without storing; `--claude-home` overrides `~/.claude` (mainly for tests). Adding a harness = adding one adapter block in `scripts/scrape.mjs`.
## Status

MVP above is the read/write pipe. Write governance (extraction, dedup, contradiction handling, review) comes next. Strategy notes live outside this repo; see `docs/` for the architecture sketch.
