#!/usr/bin/env node
// Merge locomo-c*.jsonl results into the headline table:
// per-system overall / answerable-only / per-category accuracy, plus cost.
// Usage: node evals/analyze.mjs [--dir evals/results] [--glob locomo-c]
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const DIR = flag("dir", "evals/results");
const PREFIX = flag("glob", "locomo-c");

const files = (await readdir(DIR)).filter((f) => f.startsWith(PREFIX) && f.endsWith(".jsonl")).sort();
if (!files.length) { console.error(`no ${PREFIX}*.jsonl in ${DIR}`); process.exit(1); }

const CATEGORIES = ["multi-hop", "temporal", "open-domain", "single-hop", "adversarial"];
const rows = [];
let ingestCost = 0;
const perFile = {};
for (const f of files) {
  const lines = (await readFile(join(DIR, f), "utf8")).split("\n").filter(Boolean);
  perFile[f] = { qa: 0, errors: 0 };
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type === "result") {
      rows.push(rec); perFile[f].qa++;
      if (rec.verdict === "error" || rec.verdict === "unparseable") perFile[f].errors++;
    } else if (rec.type === "ingest" && rec.costUsd) ingestCost += rec.costUsd;
  }
}

const systems = [...new Set(rows.map((r) => r.system))].sort();
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : "—");
const acc = (rs) => {
  const ok = rs.filter((r) => r.verdict === "correct").length;
  return { ok, n: rs.length, s: `${pct(ok, rs.length)}% (${ok}/${rs.length})` };
};

console.log(`files: ${files.join(", ")}\n`);
const anyBad = rows.filter((r) => r.verdict === "error" || r.verdict === "unparseable");
if (anyBad.length) {
  console.log(`⚠ ${anyBad.length} error/unparseable rows remain — numbers below exclude nothing:`);
  for (const [f, v] of Object.entries(perFile)) if (v.errors) console.log(`  ${f}: ${v.errors}`);
  console.log();
}

// Overall + answerable-only (answerable = gold !== NOT_IN_MEMORY)
console.log("== overall ==");
for (const sys of systems) {
  const all = rows.filter((r) => r.system === sys);
  const answerable = all.filter((r) => r.gold !== "NOT_IN_MEMORY");
  console.log(`${sys.padEnd(13)} overall ${acc(all).s.padEnd(18)} answerable-only ${acc(answerable).s}`);
}

console.log("\n== per category ==");
const cats = [...new Set(rows.map((r) => r.category))].sort(
  (a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
for (const cat of cats) {
  const line = systems.map((sys) =>
    `${sys}: ${acc(rows.filter((r) => r.system === sys && r.category === cat)).s}`).join("   ");
  console.log(`${cat.padEnd(12)} ${line}`);
}

console.log("\n== per conversation (overall accuracy) ==");
for (const f of files) {
  const lines = (await readFile(join(DIR, f), "utf8")).split("\n").filter(Boolean);
  const rs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.type === "result");
  const line = systems.map((sys) => `${sys}: ${acc(rs.filter((r) => r.system === sys)).s}`).join("   ");
  console.log(`${f.replace(/-sonnet\.jsonl$/, "").padEnd(12)} ${line}`);
}

console.log("\n== cost ==");
for (const sys of systems) {
  const all = rows.filter((r) => r.system === sys);
  const qa = all.reduce((s, r) => s + (r.qaCostUsd ?? 0), 0);
  const judge = all.reduce((s, r) => s + (r.judgeCostUsd ?? 0), 0);
  console.log(`${sys.padEnd(13)} qa $${qa.toFixed(2)} (${(qa / all.length).toFixed(3)}/q)   judge $${judge.toFixed(2)}`);
}
console.log(`ingest        $${ingestCost.toFixed(2)}`);
