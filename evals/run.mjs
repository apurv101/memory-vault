#!/usr/bin/env node
// Memory Vault eval harness — Stage 0+.
//
//   node evals/run.mjs [--suite micro] [--model sonnet] [--judge-model haiku]
//                      [--baselines] [--no-cache] [--keep-vault] [--bare]
//
// One run: spawn server.mjs on a temp MEMORY_DIR → ingest each conversation's
// sessions in order via headless `claude -p` with only the vault MCP tools →
// answer each question in a fresh session with vault access only → judge
// against gold → emit results JSONL + deterministic vault-health checks +
// a vault snapshot. Baselines (--baselines): closed-book and full-context
// with the same QA prompt shape, same judge.
//
// Design rules (see docs: "Memory Vault — Eval Execution Plan"):
//  - The harness prompt stays thin: the ritual under test is the server's
//    own MCP instructions, never duplicated here.
//  - Fresh context per question; the vault is the only channel.
//  - Provenance header is record #1 of every JSONL.
//  - Per-unit cache under results/.cache/<config>/ — ingest snapshots and
//    answer+verdict records — so crashed or re-judged runs resume.
//  - Subscription mode (default) still auto-loads the global ~/.claude/CLAUDE.md
//    (contamination — recorded in provenance). --bare is the clean room but
//    requires ANTHROPIC_API_KEY.
//
// Zero dependencies. Node >= 18.

import { spawn, execSync } from "node:child_process";
import {
  mkdir, mkdtemp, readFile, writeFile, readdir, rm, appendFile, stat, cp,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(EVALS_DIR, "..");
const SERVER = join(REPO_DIR, "server.mjs");
const RESULTS_DIR = join(EVALS_DIR, "results");
const PROMPTS_VERSION = 2; // bump when any prompt template below changes

// ── Config ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

const cfg = {
  suite: opt("suite", "micro"),
  model: opt("model", "sonnet"),
  judgeModel: opt("judge-model", "haiku"),
  baselines: flag("baselines"),
  noCache: flag("no-cache"),
  keepVault: flag("keep-vault"),
  bare: flag("bare"),
  conv: opt("conv", null), // run a single conversation: 1-based index or id
  qaConcurrency: Number(opt("qa-concurrency", 4)),
  ingestTimeoutMs: Number(opt("ingest-timeout", 300_000)),
  qaTimeoutMs: Number(opt("qa-timeout", 180_000)),
  judgeTimeoutMs: Number(opt("judge-timeout", 120_000)),
};

const configTag = `${cfg.suite}${cfg.conv ? `-c${cfg.conv}` : ""}-${cfg.model}${cfg.bare ? "-bare" : ""}`;
const configHash = createHash("sha256")
  .update(JSON.stringify({ suite: cfg.suite, model: cfg.model, judge: cfg.judgeModel, bare: cfg.bare, PROMPTS_VERSION }))
  .digest("hex").slice(0, 12);
const CACHE_DIR = join(RESULTS_DIR, ".cache", configHash);
const RESULTS_FILE = join(RESULTS_DIR, `${configTag}.jsonl`);

// ── Suite loading ─────────────────────────────────────────────────────────────

async function loadSuite(name) {
  if (name === "micro") {
    const s = JSON.parse(await readFile(join(EVALS_DIR, "micro", "sessions.json"), "utf8"));
    const q = JSON.parse(await readFile(join(EVALS_DIR, "micro", "questions.json"), "utf8"));
    return { name, conversations: s.conversations, questions: q.questions };
  }
  if (name === "locomo") {
    const file = join(EVALS_DIR, "datasets", "locomo10.json");
    if (!existsSync(file)) {
      await mkdir(dirname(file), { recursive: true });
      const res = await fetch("https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json");
      if (!res.ok) throw new Error(`locomo download failed: HTTP ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    const data = JSON.parse(await readFile(file, "utf8"));
    const CAT = { 1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop", 5: "adversarial" };
    const conversations = [], questions = [];
    data.forEach((sample, i) => {
      const c = sample.conversation;
      const id = sample.sample_id ?? `conv-${i + 1}`;
      const sessions = [];
      for (let n = 1; c[`session_${n}`]; n++) {
        sessions.push({
          date: c[`session_${n}_date_time`],
          transcript: c[`session_${n}`].map((t) => {
            const photo = t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : "";
            return `${t.speaker}:${photo} ${t.text ?? ""}`.trimEnd();
          }),
        });
      }
      conversations.push({ id, sessions });
      sample.qa.forEach((qa, j) => questions.push({
        id: `${id}-q${j}`,
        conv: id,
        category: CAT[qa.category] ?? `cat-${qa.category}`,
        question: qa.question,
        // Category 5 is adversarial/unanswerable — the gold sentinel routes it
        // through the judge's abstention rule; the dataset's adversarial_answer
        // is the trap, not the answer.
        gold: qa.category === 5 ? "NOT_IN_MEMORY" : String(qa.answer),
      }));
    });
    return { name, conversations, questions };
  }
  throw new Error(`unknown suite: ${name}`);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function spawnServer(memoryDir) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MEMORY_DIR: memoryDir, VAULT_PORT: String(port) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/mcp`, { method: "GET" }); // any response (405 included) = up
      return { port, base, kill: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error("server did not come up");
}

// ── Headless claude runner ────────────────────────────────────────────────────

const VAULT_TOOLS = ["view", "create", "str_replace", "insert", "delete", "rename"]
  .map((t) => `mcp__vault__${t}`);

let workDir; // sterile cwd shared by all calls — no project CLAUDE.md, no .mcp.json

async function runClaude({ prompt, mcpUrl, allowedTools, model, timeoutMs, label }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", model,
    "--tools", "",              // no built-in tools; MCP tools only
    "--no-session-persistence",
  ];
  if (cfg.bare) args.push("--bare");
  const mcpFile = join(workDir, `mcp-${label.replace(/[^a-z0-9-]/gi, "_")}.json`);
  const mcpServers = mcpUrl ? { vault: { type: "http", url: mcpUrl } } : {};
  await writeFile(mcpFile, JSON.stringify({ mcpServers }));
  args.push("--mcp-config", mcpFile, "--strict-mcp-config");
  if (allowedTools?.length) args.push("--allowedTools", allowedTools.join(","));

  const started = Date.now();
  const out = await new Promise((resolvePromise, reject) => {
    const proc = spawn("claude", args, { cwd: workDir, env: process.env });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error(`${label}: timeout after ${timeoutMs}ms`)); }, timeoutMs);
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) return reject(new Error(`${label}: exit ${code}: ${stderr.slice(0, 500)}`));
      resolvePromise(stdout);
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });

  let parsed;
  try { parsed = JSON.parse(out); }
  catch { throw new Error(`${label}: unparseable claude output: ${out.slice(0, 300)}`); }
  return {
    text: parsed.result ?? "",
    isError: Boolean(parsed.is_error),
    numTurns: parsed.num_turns,
    costUsd: parsed.total_cost_usd,
    usage: parsed.usage,
    models: Object.keys(parsed.modelUsage ?? {}), // resolved model IDs, not aliases
    durationMs: Date.now() - started,
  };
}

// ── Prompts (versioned via PROMPTS_VERSION) ───────────────────────────────────

const ingestPrompt = (session) =>
  `A session is ending. Below is its complete transcript, dated ${session.date}.
Persist to your memory directory whatever your memory instructions say is worth persisting from this session. Do not answer the transcript; just do the memory work, then reply "done".

--- TRANSCRIPT (${session.date}) ---
${session.transcript.join("\n")}
--- END TRANSCRIPT ---`;

const qaVaultPrompt = (q, today) =>
  `Today is ${today}. Using only your memory directory, answer the user's question. If the answer is not in your memory, say plainly that you don't know. Answer in one or two sentences.

Question: ${q.question}`;

const qaClosedBookPrompt = (q, today) =>
  `Today is ${today}. Answer the user's question about their project in one or two sentences. If you don't know, say plainly that you don't know.

Question: ${q.question}`;

const qaFullContextPrompt = (q, today, conv) =>
  `Today is ${today}. Below are the complete transcripts of your past sessions with the user. Using them, answer the question in one or two sentences. If the transcripts don't contain the answer, say plainly that you don't know.

${conv.sessions.map((s) => `--- SESSION (${s.date}) ---\n${s.transcript.join("\n")}`).join("\n\n")}

Question: ${q.question}`;

const judgePrompt = (q, answer) =>
  `You are grading a candidate answer against a gold answer. Be strict but fair: the candidate is correct if it states the same essential fact(s) as the gold answer; extra detail is fine, contradicting or missing the essential fact is not.

Special rule: if the gold answer is "NOT_IN_MEMORY", the candidate is correct only if it declines to answer / says it doesn't know. Any invented substantive answer is incorrect.

Question: ${q.question}
Gold answer: ${q.gold}
Candidate answer: ${answer}

Reply with ONLY this JSON, nothing else: {"verdict":"correct"|"incorrect","reason":"<one sentence>"}`;

// ── Cache ─────────────────────────────────────────────────────────────────────

async function cached(unitId, compute) {
  const file = join(CACHE_DIR, `${unitId}.json`);
  if (!cfg.noCache && existsSync(file)) return { ...JSON.parse(await readFile(file, "utf8")), fromCache: true };
  const value = await compute();
  await writeFile(file, JSON.stringify(value));
  return value;
}

// ── Vault health checks (deterministic, no judge) ─────────────────────────────

async function walkMd(dir, base = dir) {
  let files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files = files.concat(await walkMd(p, base));
    else if (e.name.endsWith(".md")) files.push(p.slice(base.length + 1));
  }
  return files;
}

async function healthCheck(scopeDir, questions) {
  const issues = [];
  const files = existsSync(scopeDir) ? await walkMd(scopeDir) : [];
  const memories = files.filter((f) => f !== "MEMORY.md");
  let indexLinks = [];
  if (!files.includes("MEMORY.md")) issues.push("no MEMORY.md index");
  else {
    const idx = await readFile(join(scopeDir, "MEMORY.md"), "utf8");
    indexLinks = [...idx.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    for (const f of memories) if (!indexLinks.includes(f)) issues.push(`unindexed file: ${f}`);
    for (const l of indexLinks) if (!memories.includes(l)) issues.push(`dangling index line: ${l}`);
  }
  const names = new Map();
  const bodies = {};
  for (const f of memories) {
    const text = await readFile(join(scopeDir, f), "utf8");
    bodies[f] = text;
    if (!/^---\n[\s\S]*?\bname:/m.test(text)) issues.push(`missing name: frontmatter: ${f}`);
    if (!/\bdescription:/.test(text)) issues.push(`missing description: frontmatter: ${f}`);
    const name = text.match(/\bname:\s*(\S+)/)?.[1];
    if (name) {
      if (names.has(name)) issues.push(`duplicate name slug "${name}": ${names.get(name)} and ${f}`);
      names.set(name, f);
    }
  }
  // Stale-fact survival: a file that mentions the old value in context but never
  // the new value is presenting superseded knowledge as current.
  let staleFacts = 0;
  for (const q of questions) {
    if (!q.staleCheck) continue;
    const { context, old: oldV, new: newV } = q.staleCheck;
    for (const [f, text] of Object.entries(bodies)) {
      const t = text.toLowerCase();
      if (t.includes(context) && t.includes(oldV) && !t.includes(newV)) {
        staleFacts++;
        issues.push(`stale fact (${q.id}): ${f} mentions "${oldV}" (${context}) without "${newV}"`);
      }
    }
  }
  const bytes = (await Promise.all(memories.map((f) => stat(join(scopeDir, f))))).reduce((a, s) => a + s.size, 0);
  return { files: memories.length, bytes, staleFacts, issues };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const out = [];
const emit = async (rec) => { out.push(rec); await appendFile(RESULTS_FILE, JSON.stringify(rec) + "\n"); };

const git = (cmd) => { try { return execSync(cmd, { cwd: REPO_DIR }).toString().trim(); } catch { return "unknown"; } };

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  await rm(RESULTS_FILE, { force: true }); // one file per config; rerun replaces it
  workDir = await mkdtemp(join(tmpdir(), "vault-eval-work-"));

  const suite = await loadSuite(cfg.suite);
  if (cfg.conv) {
    suite.conversations = suite.conversations.filter((c, i) => String(i + 1) === cfg.conv || c.id === cfg.conv);
    if (!suite.conversations.length) throw new Error(`--conv ${cfg.conv} matched nothing`);
    const ids = new Set(suite.conversations.map((c) => c.id));
    suite.questions = suite.questions.filter((q) => ids.has(q.conv));
  }
  const today = new Date().toISOString().slice(0, 10);

  await emit({
    type: "provenance",
    suite: cfg.suite,
    configHash,
    promptsVersion: PROMPTS_VERSION,
    model: cfg.model,
    judgeModel: cfg.judgeModel,
    bare: cfg.bare,
    contamination: cfg.bare ? "none (bare mode)" : "subscription mode: global ~/.claude/CLAUDE.md auto-loads into eval agents",
    harnessGitSha: git("git rev-parse HEAD"),
    serverDirty: git("git status --porcelain server.mjs") !== "" ? "server.mjs has uncommitted changes" : "clean",
    claudeVersion: (() => { try { return execSync("claude --version").toString().trim(); } catch { return "unknown"; } })(),
    node: process.version,
    date: new Date().toISOString(),
  });

  const memoryDir = await mkdtemp(join(tmpdir(), "vault-eval-mem-"));
  const server = await spawnServer(memoryDir);
  console.log(`server on :${server.port}, vault at ${memoryDir}`);

  try {
    // ── Ingest (resumable per session: snapshot the vault after each one) ──
    for (const conv of suite.conversations) {
      const scopeDir = join(memoryDir, conv.id);
      const snapAt = (n) => join(CACHE_DIR, `vault-${conv.id}-s${n}.tgz`);
      let start = 0;
      if (!cfg.noCache)
        for (let n = conv.sessions.length; n >= 1; n--)
          if (existsSync(snapAt(n))) { start = n; break; }
      await mkdir(scopeDir, { recursive: true });
      if (start > 0) {
        execSync(`tar -xzf "${snapAt(start)}" -C "${scopeDir}"`);
        console.log(`[ingest] ${conv.id}: restored cache through session ${start}/${conv.sessions.length}`);
        await emit({ type: "ingest", conv: conv.id, fromCache: true, throughSession: start });
      } else {
        await writeFile(join(scopeDir, "MEMORY.md"), `# Memory index — ${conv.id}\n\n`);
      }
      for (let i = start; i < conv.sessions.length; i++) {
        const session = conv.sessions[i];
        const r = await runClaude({
          prompt: ingestPrompt(session),
          mcpUrl: `${server.base}/mcp/${conv.id}`,
          allowedTools: VAULT_TOOLS,
          model: cfg.model,
          timeoutMs: cfg.ingestTimeoutMs,
          label: `ingest-${conv.id}-${i}`,
        });
        execSync(`tar -czf "${snapAt(i + 1)}" -C "${scopeDir}" .`);
        console.log(`[ingest] ${conv.id} session ${i + 1}/${conv.sessions.length} (${session.date}): ${r.numTurns} turns, $${r.costUsd?.toFixed(4)}`);
        await emit({ type: "ingest", conv: conv.id, session: i, date: session.date, turns: r.numTurns, costUsd: r.costUsd, usage: r.usage, models: r.models, durationMs: r.durationMs, isError: r.isError });
      }
      // Health + snapshot into results/
      const health = await healthCheck(scopeDir, suite.questions.filter((q) => q.conv === conv.id));
      console.log(`[health] ${conv.id}: ${health.files} files, ${health.bytes}B, ${health.staleFacts} stale, ${health.issues.length} issues`);
      await emit({ type: "health", conv: conv.id, ...health });
      execSync(`tar -czf "${join(RESULTS_DIR, `${configTag}-${conv.id}.vault.tgz`)}" -C "${scopeDir}" .`);
    }

    // ── QA + judge (worker pool; per-unit errors don't kill the run) ──
    const systems = ["vault", ...(cfg.baselines ? ["closed_book", "full_context"] : [])];
    const units = suite.questions.flatMap((q) => systems.map((system) => ({ q, system })));
    const tally = {};
    let next = 0, done = 0;
    const worker = async () => {
      while (next < units.length) {
        const { q, system } = units[next++];
        const conv = suite.conversations.find((c) => c.id === q.conv);
        let rec;
        try {
          rec = await cached(`${q.id}-${system}`, async () => {
            const prompt =
              system === "vault" ? qaVaultPrompt(q, today) :
              system === "closed_book" ? qaClosedBookPrompt(q, today) :
              qaFullContextPrompt(q, today, conv);
            const a = await runClaude({
              prompt,
              mcpUrl: system === "vault" ? `${server.base}/mcp/${q.conv}` : null,
              allowedTools: system === "vault" ? ["mcp__vault__view"] : [], // QA is read-only
              model: cfg.model,
              timeoutMs: cfg.qaTimeoutMs,
              label: `qa-${q.id}-${system}`,
            });
            // Rate-limit/API/spend-limit failures come back as exit-0 "answers" —
            // treat as errors (thrown = not cached) so they're retried, never judged.
            const apiFail = /^API Error|spend limit|usage limit/i;
            if (a.isError || apiFail.test(a.text ?? ""))
              throw new Error(`qa call failed: ${String(a.text).slice(0, 150)}`);
            const j = await runClaude({
              prompt: judgePrompt(q, a.text),
              mcpUrl: null, allowedTools: [],
              model: cfg.judgeModel,
              timeoutMs: cfg.judgeTimeoutMs,
              label: `judge-${q.id}-${system}`,
            });
            if (j.isError || apiFail.test(j.text ?? ""))
              throw new Error(`judge call failed: ${String(j.text).slice(0, 150)}`);
            let verdict = { verdict: "unparseable", reason: j.text.slice(0, 200) };
            const m = j.text.match(/\{[\s\S]*\}/);
            if (m) { try { verdict = JSON.parse(m[0]); } catch {} }
            return {
              id: q.id, system, category: q.category, question: q.question, gold: q.gold,
              answer: a.text, verdict: verdict.verdict, reason: verdict.reason,
              qaTurns: a.numTurns, qaCostUsd: a.costUsd, qaUsage: a.usage, qaModels: a.models, qaDurationMs: a.durationMs,
              judgeCostUsd: j.costUsd, judgeModels: j.models,
            };
          });
        } catch (e) {
          rec = { id: q.id, system, category: q.category, question: q.question, gold: q.gold, answer: null, verdict: "error", reason: String(e).slice(0, 300) };
        }
        await emit({ type: "result", ...rec });
        tally[system] ??= { correct: 0, total: 0, errors: 0 };
        tally[system].total++;
        if (rec.verdict === "correct") tally[system].correct++;
        if (rec.verdict === "error") tally[system].errors++;
        done++;
        console.log(`[qa ${done}/${units.length}] ${q.id} ${system}: ${rec.verdict}${rec.fromCache ? " (cached)" : ""} — ${String(rec.answer).slice(0, 80).replace(/\n/g, " ")}`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, cfg.qaConcurrency) }, worker));

    await emit({ type: "summary", tally, date: new Date().toISOString() });
    console.log("\n== summary ==");
    for (const [system, t] of Object.entries(tally)) console.log(`${system}: ${t.correct}/${t.total}`);
    console.log(`results: ${RESULTS_FILE}`);
  } finally {
    server.kill();
    if (cfg.keepVault) console.log(`vault kept at ${memoryDir}`);
    else await rm(memoryDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
