#!/usr/bin/env python3
"""Deterministic half of the pr-self-review skill (the LLM half is SKILL.md).

    review_scope.py plan [--base REF]    collect every local change vs the merge-base, route each
                                         file to the skills that review it, run the repo rules,
                                         write .claude/.pr-self-review/plan.json, print a summary
    review_scope.py show AGENT_ID        print one reviewer's assignment (skill, files, lines, diff cmd)
    review_scope.py show ID --since REF  the same, narrowed to what changed since REF, diff inline
    review_scope.py write-verdict FILE   record the review's findings against the planned tree;
                                         exit 0 = pass, 2 = block (CRITICAL found)
    review_scope.py check                exit 0 = passing verdict for exactly this tree (or nothing
                                         to review), 1 = no verdict / stale, 2 = verdict blocks

"Local changes" = branch commits since the merge-base + staged + unstaged + untracked files.
The fingerprint hashes all of that, so any edit after a review makes its verdict stale.

Also the library behind .claude/hooks/pr-self-review-gate.py (`is_gated_command`, `check`).
Python 3 stdlib only: hooks run where `jq` is missing and `node` may not be on PATH
(root INSIGHTS.md, 2026-09-15).
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_PATH = os.path.join(SKILL_DIR, "skill-map.json")
STATE_REL = os.path.join(".claude", ".pr-self-review")
DEFAULT_BASES = ("origin/main", "main")
SEVERITIES = ("CRITICAL", "WARNING", "SUGGESTION")

MIGRATIONS_DIR = "server/src/db/migrations/"
VENDOR_UI_DIR = "client/src/vendor/ui/"
# The one vendored file the app is allowed to change: the sidebar nav registry
# (AGENTS.md "Do not touch", spec 0006). Everything else in the kit stays frozen.
VENDOR_UI_ALLOWED = ("client/src/vendor/ui/nav.ts",)
LOCKFILES = ("pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb")


# ------------------------------------------------------------------ git

def git(root, *args, text=True):
    out = subprocess.run(
        ["git", "-c", "core.quotePath=false", *args],
        cwd=root, capture_output=True, check=True,
    ).stdout
    return out.decode("utf-8", "replace") if text else out


def repo_root(cwd=None):
    return git(cwd or os.getcwd(), "rev-parse", "--show-toplevel").strip()


def resolve_base(root, ref=None):
    """(ref, merge-base sha) for the first usable base ref."""
    candidates = [ref] if ref else [os.environ.get("PR_SELF_REVIEW_BASE"), *DEFAULT_BASES]
    for candidate in filter(None, candidates):
        try:
            return candidate, git(root, "merge-base", "HEAD", candidate).strip()
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError(f"no merge-base with any of {', '.join(filter(None, candidates))}")


def untracked(root):
    out = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    return sorted(p for p in out.split("\0") if p)


def changed_files(root, base):
    """[{path, status}] — status A/M/D/T from git, U for untracked. Renames are split into D + A
    on purpose, so renaming a migration is seen as deleting one."""
    out = git(root, "diff", "--name-status", "--no-renames", "-z", base)
    parts = [p for p in out.split("\0") if p]
    files = {parts[i + 1]: parts[i][0] for i in range(0, len(parts) - 1, 2)}
    for path in untracked(root):
        files.setdefault(path, "U")
    return [{"path": p, "status": s} for p, s in sorted(files.items())]


def changed_lines(root, base, files):
    """{path: [[start, end], ...]} of new-side line ranges touched vs base."""
    ranges = {}
    current = None
    diff = git(root, "diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", base)
    for line in diff.splitlines():
        if line.startswith("+++ "):
            target = line[4:]
            current = target[2:] if target.startswith("b/") else None
            if current:
                ranges.setdefault(current, [])
        elif line.startswith("@@") and current:
            m = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))? @@", line)
            if m:
                start, count = int(m.group(1)), int(m.group(2) or 1)
                if count:
                    ranges[current].append([start, start + count - 1])
    for f in files:
        if f["status"] == "U":
            ranges[f["path"]] = [[1, max(1, _line_count(os.path.join(root, f["path"])))]]
    return ranges


def _line_count(path):
    try:
        with open(path, "rb") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return 0


def fingerprint(root, base, files=None):
    """Hash of the base plus the current content of every changed path. Deliberately blind to
    git state (untracked / staged / committed): committing reviewed work must not make the
    review stale, while any content edit must."""
    h = hashlib.sha256(base.encode())
    for f in files if files is not None else changed_files(root, base):
        full = os.path.join(root, f["path"])
        h.update(b"\0" + f["path"].encode() + b"\0")
        if os.path.islink(full):
            h.update(b"link:" + os.readlink(full).encode())
        elif os.path.isfile(full):
            h.update(b"x" if os.stat(full).st_mode & 0o111 else b"-")
            with open(full, "rb") as fh:
                h.update(hashlib.sha256(fh.read()).digest())
        else:
            h.update(b"<absent>")
    return h.hexdigest()


# ------------------------------------------------------------------ globs + routing

def _expand_braces(pattern):
    m = re.search(r"\{([^{}]*)\}", pattern)
    if not m:
        return [pattern]
    out = []
    for alt in m.group(1).split(","):
        out.extend(_expand_braces(pattern[:m.start()] + alt + pattern[m.end():]))
    return out


def _glob_regex(glob):
    out, i = [], 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out))


_GLOB_CACHE = {}


def glob_match(path, globs):
    if isinstance(globs, str):
        globs = [globs]
    for glob in globs:
        if glob not in _GLOB_CACHE:
            _GLOB_CACHE[glob] = [_glob_regex(g) for g in _expand_braces(glob)]
        if any(rx.fullmatch(path) for rx in _GLOB_CACHE[glob]):
            return True
    return False


def load_map(path=MAP_PATH):
    with open(path) as fh:
        return json.load(fh)


def route(files, cfg, read_text):
    """Route changed files to skills. `read_text(path)` feeds the content routes.
    Returns (skill -> sorted paths, skipped, unmapped, deleted)."""
    never = set(cfg.get("never_routed", []))
    buckets, skipped, unmapped, deleted = {}, [], [], []
    for f in files:
        path = f["path"]
        if f["status"] == "D":
            deleted.append(path)
            continue
        if glob_match(path, cfg.get("skip", [])):
            skipped.append(path)
            continue
        skills = set()
        for r in cfg.get("routes", []):
            if glob_match(path, r["glob"]) and not glob_match(path, r.get("exclude", [])):
                skills.update(r["skills"])
        for r in cfg.get("content_routes", []):
            if glob_match(path, r["glob"]) and not glob_match(path, r.get("exclude", [])):
                if re.search(r["pattern"], read_text(path)):
                    skills.update(r["skills"])
        skills -= never
        if not skills:
            unmapped.append(path)
            skills = set(cfg.get("unmapped_skills", [])) - never
        for skill in skills:
            buckets.setdefault(skill, []).append(path)
    return {k: sorted(v) for k, v in sorted(buckets.items())}, skipped, unmapped, deleted


def chunk_agents(buckets, size):
    agents = []
    for skill, paths in buckets.items():
        for n, i in enumerate(range(0, len(paths), size), start=1):
            agents.append({"id": f"{skill}#{n}", "skill": skill, "files": paths[i:i + size]})
    return agents


# ------------------------------------------------------------------ repo rules (AGENTS.md "Do not touch")

def _rule(path, rule, evidence, fix):
    return {"severity": "CRITICAL", "skill": "repo-rules", "file": path, "line": None,
            "rule": rule, "evidence": evidence, "fix": fix, "source": "rule"}


def repo_rule_findings(files, exists):
    """Deterministic CRITICALs. `exists(path)` tells whether a repo-relative path exists now."""
    status = {f["path"]: f["status"] for f in files}
    verb = {"M": "modified", "D": "deleted or renamed", "T": "changed type"}
    added_sql = any(p.startswith(MIGRATIONS_DIR) and p.endswith(".sql") and s in "AU"
                    for p, s in status.items())
    out = []
    for path, st in status.items():
        name = os.path.basename(path)
        folder = os.path.dirname(path)

        if path.startswith(MIGRATIONS_DIR) and st not in "AU":
            journal = path == MIGRATIONS_DIR + "meta/_journal.json"
            if not (journal and st == "M" and added_sql):
                out.append(_rule(
                    path, "migration-edited",
                    f"existing migration file {verb.get(st, st)}"
                    + (" with no new migration generated" if journal else ""),
                    "Revert it. Change server/src/db/schema/ and run `pnpm db:generate` for a NEW migration."))

        if path.startswith(VENDOR_UI_DIR) and path not in VENDOR_UI_ALLOWED:
            out.append(_rule(path, "vendored-ui-edited", "client/src/vendor/ui is a ported UI kit",
                             "Revert; wrap or extend the component outside src/vendor/ui."))

        if name in LOCKFILES:
            if st in "AU":
                others = [n for n in LOCKFILES if n != name and exists(os.path.join(folder, n))]
                if others:
                    out.append(_rule(path, "second-lockfile",
                                     f"new {name} next to existing {', '.join(others)}",
                                     "Delete it; use the package's own manager (pnpm vs npm)."))
            elif st == "D":
                out.append(_rule(path, "lockfile-deleted", "lockfile deleted",
                                 "Restore it: `git checkout <base> -- " + path + "`."))
            elif os.path.join(folder, "package.json") not in status:
                out.append(_rule(path, "lockfile-without-manifest",
                                 "lockfile changed but its package.json did not",
                                 "Revert it; lockfiles change only via `pnpm add` / `npm i` with a dependency change."))

        if path == "skills-lock.json" and st != "A" and not any(p.startswith(".claude/skills/") for p in status):
            out.append(_rule(path, "skills-lock-without-skills",
                             "skills-lock.json changed but no skill under .claude/skills did",
                             "Revert; the lockfile changes only via the skills manager."))
    return out


# ------------------------------------------------------------------ plan / show

def state_dir(root):
    return os.path.join(root, STATE_REL)


def build_plan(root, base_ref=None):
    ref, base = resolve_base(root, base_ref)
    cfg = load_map()
    files = changed_files(root, base)

    def read_text(path):
        try:
            with open(os.path.join(root, path), encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except OSError:
            return ""

    buckets, skipped, unmapped, deleted = route(files, cfg, read_text)
    lines = changed_lines(root, base, files)
    status = {f["path"]: f["status"] for f in files}
    agents = chunk_agents(buckets, int(cfg.get("chunk_files", 30)))
    for agent in agents:
        agent["files"] = [{"path": p, "status": status[p], "lines": lines.get(p, [])} for p in agent["files"]]
    return {
        "base_ref": ref,
        "base": base,
        "head": git(root, "rev-parse", "HEAD").strip(),
        "fingerprint": fingerprint(root, base, files),
        "created_at": _now(),
        "changed": len(files),
        "agents": agents,
        "skipped": skipped,
        "unmapped": unmapped,
        "deleted": deleted,
        "rule_findings": repo_rule_findings(files, lambda p: os.path.exists(os.path.join(root, p))),
    }


def cmd_plan(args):
    root = repo_root()
    plan = build_plan(root, args.base)
    os.makedirs(state_dir(root), exist_ok=True)
    path = os.path.join(state_dir(root), "plan.json")
    with open(path, "w") as fh:
        json.dump(plan, fh, indent=2)
    print(f"base      {plan['base_ref']} @ {plan['base'][:12]}   head {plan['head'][:12]}")
    print(f"changed   {plan['changed']} files  (skipped {len(plan['skipped'])}, "
          f"deleted {len(plan['deleted'])}, unmapped {len(plan['unmapped'])})")
    print(f"plan      {os.path.relpath(path, root)}")
    if not plan["changed"]:
        print("\nNothing to review: no local changes vs the base.")
        return 0
    print(f"\nreviewers ({len(plan['agents'])}):")
    for agent in plan["agents"]:
        print(f"  {agent['id']:<34} {len(agent['files']):>3} files")
    if plan["unmapped"]:
        print("\nunmapped (security only): " + ", ".join(plan["unmapped"]))
    print(f"\nrepo-rule CRITICALs: {len(plan['rule_findings'])}")
    for f in plan["rule_findings"]:
        print(f"  {f['file']}: {f['rule']} — {f['evidence']}")
    return 0


def _load_plan(root):
    path = os.path.join(state_dir(root), "plan.json")
    if not os.path.exists(path):
        raise SystemExit("no plan.json — run `review_scope.py plan` first")
    with open(path) as fh:
        return json.load(fh)


def touched_since(root, ref, paths):
    """Which of `paths` differ between `ref` and the working tree right now.

    Untracked files count as touched: `git diff` cannot see them, and a reviewer that has
    never been shown one has not reviewed it.
    """
    if not paths:
        return set()
    try:
        out = git(root, "diff", "--name-only", ref, "--", *paths)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"--since {ref}: {exc.stderr.decode('utf-8', 'replace').strip()}")
    return {p for p in out.split("\n") if p} | (set(paths) & set(untracked(root)))


# How much inline diff `show --since` prints before handing back the command instead. A
# re-review is meant to be cheap; a shard that blows this budget is not a delta any more,
# and pasting it into a subagent defeats the point.
MAX_INLINE_DIFF_LINES = 400


def cmd_show(args):
    root = repo_root()
    plan = _load_plan(root)
    agent = next((a for a in plan["agents"] if a["id"] == args.agent_id), None)
    if not agent:
        raise SystemExit(f"no agent {args.agent_id!r} in plan.json")
    skill_md = os.path.join(".claude", "skills", agent["skill"], "SKILL.md")
    files, unchanged = agent["files"], []

    if args.since:
        touched = touched_since(root, args.since, [f["path"] for f in files])
        unchanged = [f for f in files if f["path"] not in touched]
        files = [f for f in files if f["path"] in touched]

    print(f"skill: {agent['skill']}  ({skill_md})")
    print(f"base:  {plan['base']}")
    if args.since:
        print(f"since: {args.since}  (delta re-review)")
    if not files:
        print("\nNothing in this shard changed since that point. Your previous findings on it "
              "still describe the current code; re-report them as they were.")
        return 0

    print("files (changed new-side line ranges; status U = untracked, A = added):")
    for f in files:
        spans = ", ".join(f"{a}-{b}" if a != b else str(a) for a, b in f["lines"]) or "no added lines"
        print(f"  [{f['status']}] {f['path']}  :: {spans}")

    if unchanged:
        print(f"\nunchanged since {args.since} — your previous findings on these still stand, "
              "and nothing on them needs re-deriving:")
        for f in unchanged:
            print(f"  {f['path']}")

    tracked = [f["path"] for f in files if f["status"] != "U"]
    if args.since and tracked:
        # Hand over the hunks instead of a command, so the reviewer neither runs git nor
        # pastes its output into its own context. Diffed from `--since`, not the plan base:
        # what moved since it last looked is the whole point.
        body = git(root, "diff", "--no-color", "--no-ext-diff", args.since, "--", *tracked)
        if len(body.split("\n")) <= MAX_INLINE_DIFF_LINES:
            print(f"\ndiff since {args.since} (inline — do not re-run git for it):\n")
            print(body.rstrip("\n"))
        else:
            print(f"\ndiff is {len(body.split(chr(10)))} lines, over the {MAX_INLINE_DIFF_LINES}-line "
                  f"inline budget — run it yourself:\n  git diff {args.since} -- "
                  f"{' '.join(shlex.quote(p) for p in tracked)}")
    elif tracked:
        print(f"\ndiff: git diff {plan['base']} -- "
              f"{' '.join(shlex.quote(p) for p in tracked)}")

    if any(f["status"] == "U" for f in files):
        print("untracked files are new in full — read them directly.")
    return 0


# ------------------------------------------------------------------ verdict

def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def validate_findings(items):
    required = ("severity", "skill", "file", "rule", "evidence")
    for i, f in enumerate(items):
        missing = [k for k in required if not f.get(k)]
        if missing:
            raise ValueError(f"finding #{i} is missing {', '.join(missing)}: {f}")
        if f["severity"] not in SEVERITIES:
            raise ValueError(f"finding #{i} has severity {f['severity']!r}; use one of {SEVERITIES}")
        if f.get("line") is not None and not isinstance(f["line"], int):
            raise ValueError(f"finding #{i} line must be an integer or null")


def merge_findings(findings):
    """Dedupe by (file, line, rule), keeping the most severe; most severe first."""
    best = {}
    for f in findings:
        key = (f["file"], f.get("line"), f["rule"])
        if key not in best or SEVERITIES.index(f["severity"]) < SEVERITIES.index(best[key]["severity"]):
            best[key] = f
    return sorted(best.values(), key=lambda f: (SEVERITIES.index(f["severity"]), f["file"], f.get("line") or 0))


def render_report(verdict):
    counts = {s: sum(1 for f in verdict["findings"] if f["severity"] == s) for s in SEVERITIES}
    lines = [
        "# PR self-review",
        "",
        f"**Status: {verdict['status'].upper()}**"
        + (" — CRITICAL findings block opening, pushing and merging this PR." if verdict["status"] == "block" else ""),
        "",
        f"- base: `{verdict['base_ref']}` @ `{verdict['base'][:12]}` · head `{verdict['head'][:12]}`",
        f"- fingerprint: `{verdict['fingerprint'][:16]}` · {verdict['created_at']}",
        f"- reviewers: {len(verdict['agents_completed'])}",
        "",
        "| CRITICAL | WARNING | SUGGESTION |",
        "|---|---|---|",
        f"| {counts['CRITICAL']} | {counts['WARNING']} | {counts['SUGGESTION']} |",
    ]
    for sev in SEVERITIES:
        items = [f for f in verdict["findings"] if f["severity"] == sev]
        if not items:
            continue
        lines += ["", f"## {sev}", "", "| Where | Skill | Rule | Evidence | Fix |", "|---|---|---|---|---|"]
        for f in items:
            where = f"`{f['file']}" + (f":{f['line']}`" if f.get("line") else "`")
            note = f" _(was {f['downgraded_from']}: {f.get('verification', '')})_" if f.get("downgraded_from") else ""
            cells = [where, f["skill"], f["rule"], f["evidence"] + note, f.get("fix", "")]
            lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    return "\n".join(lines) + "\n"


def cmd_write_verdict(args):
    root = repo_root()
    plan = _load_plan(root)
    current = fingerprint(root, plan["base"])
    if current != plan["fingerprint"]:
        print("REFUSED: the tree changed since `plan` ran, so the review does not cover it. "
              "Re-run the whole review.", file=sys.stderr)
        return 1
    with open(args.findings) as fh:
        payload = json.load(fh)
    completed = set(payload.get("agents_completed", []))
    missing = [a["id"] for a in plan["agents"] if a["id"] not in completed]
    if missing:
        print("REFUSED: these planned reviewers did not report: " + ", ".join(missing), file=sys.stderr)
        return 1
    reviewed = payload.get("findings", [])
    validate_findings(reviewed)
    findings = merge_findings(plan["rule_findings"] + reviewed)
    critical = [f for f in findings if f["severity"] == "CRITICAL"]
    verdict = {
        "status": "block" if critical else "pass",
        "base_ref": plan["base_ref"],
        "base": plan["base"],
        "head": plan["head"],
        "fingerprint": plan["fingerprint"],
        "created_at": _now(),
        "agents_completed": sorted(completed),
        "critical": critical,
        "findings": findings,
    }
    with open(os.path.join(state_dir(root), "verdict.json"), "w") as fh:
        json.dump(verdict, fh, indent=2)
    report = os.path.join(state_dir(root), "report.md")
    with open(report, "w") as fh:
        fh.write(render_report(verdict))
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in SEVERITIES}
    print(f"{verdict['status'].upper()}: {counts['CRITICAL']} critical, {counts['WARNING']} warning, "
          f"{counts['SUGGESTION']} suggestion — {os.path.relpath(report, root)}")
    return 2 if critical else 0


def check(root):
    """(exit code, message) — see module docstring."""
    path = os.path.join(state_dir(root), "verdict.json")
    verdict = None
    if os.path.exists(path):
        with open(path) as fh:
            verdict = json.load(fh)
    ref, base = resolve_base(root, verdict and verdict.get("base_ref"))
    files = changed_files(root, base)
    if not files:
        return 0, f"pr-self-review: no local changes vs {ref}; nothing to review."
    if verdict is None:
        return 1, "pr-self-review: no review has been run for these changes. Run /pr-self-review first."
    if verdict.get("base") != base or verdict.get("fingerprint") != fingerprint(root, base, files):
        return 1, ("pr-self-review: the last review is stale — the diff changed after it ran "
                   f"({verdict.get('created_at')}). Run /pr-self-review again.")
    if verdict.get("status") != "pass":
        rows = "\n".join(f"  - {f['file']}{':' + str(f['line']) if f.get('line') else ''} "
                         f"[{f['skill']}] {f['rule']}: {f['evidence']}" for f in verdict.get("critical", []))
        return 2, (f"pr-self-review: {len(verdict.get('critical', []))} CRITICAL finding(s) block this PR "
                   f"(.claude/.pr-self-review/report.md):\n{rows}\n"
                   "Fix them and run /pr-self-review again.")
    return 0, "pr-self-review: passing review for the current diff."


def cmd_check(_args):
    code, message = check(repo_root())
    print(message, file=sys.stderr if code else sys.stdout)
    return code


# ------------------------------------------------------------------ gated commands (used by the hook)

# `gh api` flags that consume the next argument.
_GH_API_VALUE_FLAGS = {"-X", "--method", "-f", "--raw-field", "-F", "--field", "--input",
                       "-H", "--header", "-q", "--jq", "-t", "--template", "--hostname",
                       "-p", "--preview", "--cache"}
_PR_MUTATIONS = re.compile(r"\b(createPullRequest|mergePullRequest|markPullRequestReadyForReview"
                           r"|enablePullRequestAutoMerge)\b")
_CONSERVATIVE = re.compile(r"\bgit\s+push\b|\bgh\s+pr\s+(create|merge|ready)\b|\bgh\s+api\b")
_WRAPPERS = {"env", "command", "exec", "time", "nohup", "sudo", "xargs"}


def _gated_api(args):
    method, has_body, endpoint, queries = None, False, None, []
    k = 0
    while k < len(args):
        arg = args[k]
        if arg.startswith("--") and "=" in arg:
            (name, value), step = arg.split("=", 1), 1
        elif arg.startswith("-X") and len(arg) > 2:
            name, value, step = "-X", arg[2:], 1
        elif arg in _GH_API_VALUE_FLAGS:
            name, value, step = arg, (args[k + 1] if k + 1 < len(args) else ""), 2
        elif arg.startswith("-"):
            name, value, step = arg, "", 1
        else:
            endpoint = endpoint or arg
            k += 1
            continue
        if name in ("-X", "--method"):
            method = value.upper()
        elif name in ("-f", "--raw-field", "-F", "--field"):
            has_body = True
            if value.startswith("query="):
                queries.append(value)
        elif name == "--input":
            has_body = True
        k += step
    method = method or ("POST" if has_body else "GET")
    endpoint = (endpoint or "").lstrip("/").split("?")[0].rstrip("/")
    if endpoint == "graphql":
        return "gh api graphql (pull request mutation)" if _PR_MUTATIONS.search(" ".join(queries)) else None
    if method == "POST" and re.fullmatch(r"repos/[^/]+/[^/]+/(pulls|merges)", endpoint):
        return f"gh api {method} {endpoint}"
    if method in ("PUT", "POST") and re.fullmatch(r"repos/[^/]+/[^/]+/pulls/\d+/merge", endpoint):
        return f"gh api {method} {endpoint}"
    return None


def _gated_segment(tokens):
    i = 0
    while i < len(tokens) and (tokens[i] in _WRAPPERS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[i])):
        i += 1
    t = tokens[i:]
    if not t:
        return None
    prog = os.path.basename(t[0])
    if prog in ("bash", "sh", "zsh") and "-c" in t[1:-1]:
        return is_gated_command(t[t.index("-c", 1) + 1])
    if prog == "git":
        j = 1
        while j < len(t) and t[j].startswith("-"):
            j += 2 if t[j] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") else 1
        if j < len(t) and t[j] == "push":
            rest = t[j + 1:]
            if any(a in ("--dry-run", "-n", "--help", "-h", "--delete", "-d") for a in rest):
                return None
            return "git push"
        return None
    if prog == "gh":
        args = t[1:]
        if len(args) >= 2 and args[0] == "pr" and args[1] in ("create", "merge", "ready"):
            if "--help" in args or "-h" in args:
                return None
            return f"gh pr {args[1]}"
        if args and args[0] == "api":
            return _gated_api(args[1:])
    return None


_HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def _strip_heredocs(command):
    """Drop heredoc bodies: they are data (commit messages, PR bodies), not commands. A
    commit message line such as "git push is now gated" must not read as a push."""
    out, lines, i = [], command.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        i += 1
        for m in _HEREDOC.finditer(line):
            while i < len(lines) and lines[i].strip() != m.group(2):
                i += 1
            i += 1  # the terminator line
    return "\n".join(out)


def is_gated_command(command):
    """Label of the PR-publishing action in a shell command (e.g. 'gh pr create'), or None.
    Unparseable commands that merely look like one are treated as gated — the gate errs closed."""
    command = _strip_heredocs(command)
    lexer = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        m = _CONSERVATIVE.search(command)
        return m.group(0) if m else None
    segment = []
    for tok in tokens + [";"]:
        if tok and set(tok) <= set("();<>|&"):
            label = _gated_segment(segment)
            if label:
                return label
            segment = []
        elif tok != "$":
            segment.append(tok)
    return None


# ------------------------------------------------------------------ main

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--base", help="base ref (default: $PR_SELF_REVIEW_BASE, origin/main, main)")
    p.set_defaults(fn=cmd_plan)
    p = sub.add_parser("show")
    p.add_argument("agent_id")
    p.add_argument("--since", metavar="REF",
                   help="only the files this reviewer's shard has changed since REF (a sha from "
                        "its last round), with the diff inline; the rest are listed as unchanged")
    p.set_defaults(fn=cmd_show)
    p = sub.add_parser("write-verdict")
    p.add_argument("findings", help='JSON: {"agents_completed": [ids], "findings": [...]}')
    p.set_defaults(fn=cmd_write_verdict)
    p = sub.add_parser("check")
    p.set_defaults(fn=cmd_check)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
