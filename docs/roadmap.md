# Roadmap — from local MVP to "anyone can just ask"

The goal state: a stranger tells their agent "set up memory vault for this project" and it works. That decomposes into three problems; each stage below widens who can "just ask": AJ → any Claude Code user → any MCP-client user → any employee of a customer org.

## The three problems

1. **Discoverability** — an agent that has never heard of the vault has to be able to find the recipe. Cold agents don't know things; they search registries (npm, the MCP registry, plugin marketplaces). The listing must be *self-sufficient*: instructions an agent can execute verbatim.
2. **The daemon prerequisite** — "the server must already be running" has to die. Because the store is just a folder of markdown, no daemon is actually required: a stdio-mode server spawned per session over the same folder works, and lets registry clients and plugins auto-launch the vault.
3. **Seeding the connection** — someone has to tell each session the vault exists. Who that someone is defines the product stage: a plugin for individuals, IT for orgs.

## Stages

### 1. Agent-legible listing (done 2026-08-18)
README quickstart rewritten around `npx memory-vault` with an "Agent setup (executable as written)" block: check the server, start it if down, `claude mcp add` the repo. Published on npm (`memory-vault`) and the MCP registry (`io.github.apurv101/memory-vault`).

### 2. Kill the daemon prerequisite
- `--stdio` mode with a default store location (`~/.memory-vault`), so any MCP client can spawn the server per-session with zero setup. HTTP daemon becomes an option (shared long-lived vault), not a prerequisite.
- ~~`npx memory-vault connect`~~ (done 2026-08-18, v0.3.0) — starts the server if needed and writes both layers per detected harness: MCP registration (`.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`) and the memory ritual (`AGENTS.md`, imported by `CLAUDE.md`). One command replaces the recipe — and it already covers part of stage 3's per-harness adapters.
- Update the MCP registry entry to the npx/stdio transport so clients can auto-launch.

### 3. Seed the connection at scale
- **Individuals**: Claude Code plugin (`/plugin install memory-vault`) bundling the MCP config plus usage instructions — the productized version of a global-CLAUDE.md entry. Parallel harness adapters: DSH (done, `dsh-cordis.patch.yml`), Cursor and Codex (done via `connect`, v0.3.0).
- **Orgs**: deployable service — Docker image, remote MCP endpoint with OAuth, per-user and per-project scopes — inside the customer perimeter. Admin stands it up once and pushes the connection via managed settings; employees never ask at all.

### 4. Write governance (the moat)
Once the pipe is boring, the product is governance: session-to-memory extraction, dedup, contradiction resolution, decay, review queues, provenance on every entry. This is what an org pays for; stages 1–3 are how it spreads.

## The standing bet

Harnesses are converging on memory as a first-class, pluggable concern. If MCP grows a recognized "memory backend" convention, the vault's position — early, harness-neutral, file-based, customer-owned — is where we want to be standing when that lands. Can't be scheduled; be ready for it.
