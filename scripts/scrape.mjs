#!/usr/bin/env node
// Memory scraper — cold-start a pre-existing repo into the vault folder.
//
// Walks the harness-specific places where memory already lives on this machine
// (Claude Code auto-memory, CLAUDE.md files, skills/commands/agents, Codex
// AGENTS.md, Cursor rules) and writes each as a markdown memory file into the
// vault's per-project space (memory/<project>/). Skills are copied as whole
// folders to memory/<project>/skills/<name>/. Refreshes that project's
// MEMORY.md index only.
//
//   node scripts/scrape.mjs <repo-path> [options]
//
// Options:
//   --memory-dir <dir>       Vault folder (default <this repo>/memory, env MEMORY_DIR)
//   --project <name>         Project space to write into (default: repo dir name)
//   --claude-home <dir>      Claude config dir (default ~/.claude)
//   --only <a,b>             Run only these adapters (claude-memory, claude-instructions,
//                            claude-skills, codex, cursor; "skills" = "claude-skills")
//   --include-user           Also scrape user-level files (~/.claude/CLAUDE.md) — off by
//                            default because user-level memory is personal, not org memory
//   --include-user-skills    Also copy user-level skills (~/.claude/skills/*)
//   --dry-run                Print what would be written; write nothing
//
// Idempotent: names are stable — re-running refreshes (created date preserved).

import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv, booleanFlags = []) {
  const args = { positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (booleanFlags.includes(a)) args[key] = true;
      else args[key] = argv[++i];
    } else args.positional.push(a);
  }
  return args;
}

function parseFrontmatter(raw) {
  const meta = {};
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  return { meta, body: body.trim() };
}

const kebab = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

function firstProseLine(body) {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t.slice(0, 200);
  }
  return "";
}

// ── Args ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv, ["--dry-run", "--include-user", "--include-user-skills"]);
const [repoArg] = args.positional;
if (!repoArg) {
  console.error(
    "usage: node scripts/scrape.mjs <repo-path> [--memory-dir <dir>] [--project <name>] [--claude-home <dir>] [--only <adapters>] [--include-user] [--include-user-skills] [--dry-run]",
  );
  process.exit(1);
}

const repo = resolve(repoArg);
const project = kebab(args.project ?? basename(repo));
const claudeHome = resolve(args.claudeHome ?? join(homedir(), ".claude"));
const memoryDir = resolve(
  args.memoryDir ??
    process.env.MEMORY_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "memory"),
);
const projectDir = join(memoryDir, project);
const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
const runs = (adapter) => !only || only.has(adapter) || only.has(adapter.replace(/^claude-/, ""));

const exists = (p) => stat(p).then(() => true, () => false);
const listDir = (p) => readdir(p).catch(() => []);
const readIf = async (p) => ((await exists(p)) ? readFile(p, "utf8") : null);

// ── Collect candidates ────────────────────────────────────────────────────────

const found = [];
function add(adapter, origin, name, description, content) {
  if (!content?.trim()) return;
  found.push({
    name: kebab(name),
    description: description || firstProseLine(content) || name,
    content: content.trim(),
    source: `scrape:${adapter}`,
    origin,
  });
}

// Skills are copied as whole folders (SKILL.md + references/scripts/templates),
// not flattened into memory files.
const skills = [];
async function addSkillDir(dir) {
  const raw = await readIf(join(dir, "SKILL.md"));
  if (!raw) return;
  const { meta } = parseFrontmatter(raw);
  skills.push({
    name: kebab(meta.name ?? basename(dir)),
    description: (meta.description || "skill").slice(0, 200),
    dir,
  });
}

// claude-memory — ~/.claude/projects/<slug>/memory/*.md
const slug = repo.replace(/[/.]/g, "-");
const autoMemDir = join(claudeHome, "projects", slug, "memory");
if (runs("claude-memory")) {
  for (const file of await listDir(autoMemDir)) {
    if (!file.endsWith(".md") || file === "MEMORY.md") continue; // MEMORY.md is an index
    const raw = await readFile(join(autoMemDir, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    add("claude-memory", join(autoMemDir, file), meta.name ?? basename(file, ".md"), meta.description, body);
  }
}

// claude-instructions — CLAUDE.md variants
if (runs("claude-instructions")) {
  for (const relPath of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]) {
    const raw = await readIf(join(repo, relPath));
    if (raw) {
      add(
        "claude-instructions",
        join(repo, relPath),
        relPath === "CLAUDE.local.md" ? "claude-local-instructions" : "claude-instructions",
        `Project instructions (${relPath}) for ${project}`,
        raw,
      );
    }
  }
}

// claude-skills — .claude/{skills,commands,agents}, plus ~/.claude/skills with
// --include-user-skills (user-level skills are personal, so opt-in)
if (runs("claude-skills")) {
  for (const dir of await listDir(join(repo, ".claude", "skills"))) {
    await addSkillDir(join(repo, ".claude", "skills", dir));
  }
  if (args.includeUserSkills) {
    for (const dir of await listDir(join(claudeHome, "skills"))) {
      await addSkillDir(join(claudeHome, "skills", dir));
    }
  }
  for (const kind of ["commands", "agents"]) {
    for (const file of await listDir(join(repo, ".claude", kind))) {
      if (!file.endsWith(".md")) continue;
      const raw = await readFile(join(repo, ".claude", kind, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      add(
        "claude-skills",
        join(repo, ".claude", kind, file),
        `${kind.replace(/s$/, "")}-${meta.name ?? basename(file, ".md")}`,
        meta.description,
        body,
      );
    }
  }
}

// codex — AGENTS.md
if (runs("codex")) {
  const raw = await readIf(join(repo, "AGENTS.md"));
  if (raw) add("codex", join(repo, "AGENTS.md"), "codex-instructions", `Codex instructions (AGENTS.md) for ${project}`, raw);
}

// cursor — .cursorrules, .cursor/rules/*
if (runs("cursor")) {
  const raw = await readIf(join(repo, ".cursorrules"));
  if (raw) add("cursor", join(repo, ".cursorrules"), "cursor-rules", `Cursor rules for ${project}`, raw);
  for (const file of await listDir(join(repo, ".cursor", "rules"))) {
    const raw2 = await readFile(join(repo, ".cursor", "rules", file), "utf8");
    const { meta, body } = parseFrontmatter(raw2);
    add("cursor", join(repo, ".cursor", "rules", file), `cursor-rule-${basename(file).replace(/\.[^.]+$/, "")}`, meta.description, body);
  }
}

// claude-user (opt-in) — user-level CLAUDE.md
if (runs("claude-user") && args.includeUser) {
  const raw = await readIf(join(claudeHome, "CLAUDE.md"));
  if (raw) add("claude-user", join(claudeHome, "CLAUDE.md"), "user-claude-md", "User-level Claude instructions", raw);
}

// ── Report / write ────────────────────────────────────────────────────────────

if (!found.length && !skills.length) {
  console.log(`Nothing to scrape in ${repo} (checked ${autoMemDir}, CLAUDE.md, .claude/, AGENTS.md, .cursor*).`);
  process.exit(0);
}

if (found.length) {
  console.log(`${found.length} memories found in ${repo}:\n`);
  for (const m of found) {
    console.log(`  ${m.name}  [${m.source}]`);
    console.log(`    ${m.origin}`);
  }
}
if (skills.length) {
  console.log(`${skills.length} skill folder(s) found:\n`);
  for (const s of skills) {
    console.log(`  skills/${s.name}/`);
    console.log(`    ${s.dir}`);
  }
}

if (args.dryRun) {
  console.log("\nDry run — nothing written.");
  process.exit(0);
}

await mkdir(projectDir, { recursive: true });
const now = new Date().toISOString();
console.log("");
for (const m of found) {
  const target = join(projectDir, `${m.name}.md`);
  const prior = await readIf(target);
  const created = prior ? (parseFrontmatter(prior).meta.created ?? now) : now;
  const fm = [
    `name: ${m.name}`,
    `description: ${m.description}`,
    `source: ${m.source}`,
    `origin: ${m.origin}`,
    `created: ${created}`,
    `updated: ${now}`,
  ].join("\n");
  await writeFile(target, `---\n${fm}\n---\n\n${m.content}\n`);
  console.log(`${prior ? "↻" : "✓"} ${m.name}.md`);
}
for (const s of skills) {
  await cp(s.dir, join(projectDir, "skills", s.name), { recursive: true });
  console.log(`✓ skills/${s.name}/`);
}

// Refresh this project's MEMORY.md index from everything in its space.
const entries = [];
for (const file of (await readdir(projectDir)).sort()) {
  const full = join(projectDir, file);
  const st = await stat(full);
  if (st.isFile() && file.endsWith(".md") && file !== "MEMORY.md") {
    const { meta, body } = parseFrontmatter(await readFile(full, "utf8"));
    entries.push(`- [${meta.name ?? basename(file, ".md")}](${file}) — ${meta.description ?? firstProseLine(body)}`);
  } else if (st.isDirectory() && file === "skills") {
    for (const s of (await readdir(full)).sort()) {
      const raw = await readIf(join(full, s, "SKILL.md"));
      if (!raw) continue;
      const { meta } = parseFrontmatter(raw);
      entries.push(`- [skill-${s}](skills/${s}/SKILL.md) — ${(meta.description || "skill").slice(0, 200)}`);
    }
  }
}
await writeFile(join(projectDir, "MEMORY.md"), `# Memory index — ${project}\n\n${entries.join("\n")}\n`);

console.log(`\n${found.length} memories + ${skills.length} skill folder(s) written to ${projectDir}; MEMORY.md refreshed.`);
