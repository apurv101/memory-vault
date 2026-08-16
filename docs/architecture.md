# Architecture Sketch (pre-MVP)

## Components

1. **Store**
   - Raw content + metadata: provenance (author, timestamp, source session/document), ACLs, expiry/decay, confidence.
   - Vector index derived from raw content; re-indexable on embedding-model change.

2. **MCP server**
   - Tools: `remember`, `recall`, `forget`, `review_candidates`.
   - Every recall enforces the caller's ACLs and logs to the audit trail.

3. **Ingestion**
   - Corpus connectors (docs, tickets, chat, code) for day-one usefulness.
   - Cold start: corpus is the wedge; interaction memory is the moat.

4. **Write governance** (80% of the engineering)
   - Extraction: sessions -> candidate memories.
   - Dedup and contradiction resolution.
   - Review queue with confidence scoring.
   - Poisoning defense: untrusted agents can't write unreviewed memories.

## Design rules

- Raw content is the source of truth; everything derived is rebuildable.
- No write path without provenance.
- No retrieval path without ACL enforcement.
- Every component swappable (embedding model, vector store, LLM used for extraction). The vault itself must practice the portability it preaches.

## Open questions

- Extraction quality vs. review burden.
- Contradiction policy: newest-wins vs. provenance-weighted.
- Write namespaces per role/agent.
- Re-index cadence and cost.
