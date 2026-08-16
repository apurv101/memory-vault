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

## Status

Pre-MVP. Working notes and strategy live outside this repo. See `docs/` for the architecture sketch as it firms up.
