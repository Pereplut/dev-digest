"""Unit tests for review_scope.py (stdlib unittest; run from the repo root):

    python3 -m unittest discover -s .claude/skills/pr-self-review/scripts -p 'test_*.py'
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # an untracked __pycache__ would change the reviewed tree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review_scope as rs  # noqa: E402

CFG = rs.load_map()
GATE = os.path.join(os.path.dirname(rs.SKILL_DIR), "..", "hooks", "pr-self-review-gate.py")


def skills_for(path, content=""):
    buckets, skipped, unmapped, _ = rs.route([{"path": path, "status": "M"}], CFG, lambda _p: content)
    return {s for s, paths in buckets.items() if path in paths}, path in skipped, path in unmapped


class RoutingTest(unittest.TestCase):
    def test_ui_files_get_ui_skills_only(self):
        skills, _, _ = skills_for("client/src/app/repos/[id]/_components/PrList/PrList.tsx")
        self.assertTrue({"react-best-practices", "react-code-organization", "next-best-practices"} <= skills)
        self.assertFalse({"onion-architecture", "fastify-best-practices", "drizzle-orm-patterns"} & skills)

    def test_ui_tests_get_rtl_not_security(self):
        skills, _, _ = skills_for("client/src/app/_components/Foo/Foo.test.tsx")
        self.assertEqual(skills, {"react-testing-library"})

    def test_backend_files_get_backend_skills_only(self):
        skills, _, _ = skills_for("server/src/modules/pulls/service.ts")
        self.assertIn("onion-architecture", skills)
        self.assertFalse({"react-best-practices", "next-best-practices", "fastify-best-practices"} & skills)

    def test_routes_get_fastify(self):
        skills, _, _ = skills_for("server/src/modules/pulls/routes.ts")
        self.assertTrue({"fastify-best-practices", "onion-architecture", "security"} <= skills)

    def test_repositories_get_drizzle(self):
        for path in ("server/src/modules/agents/repository.ts",
                     "server/src/modules/pulls/repository/pull.repo.ts"):
            self.assertIn("drizzle-orm-patterns", skills_for(path)[0], path)

    def test_schema_gets_postgres_design(self):
        skills, _, _ = skills_for("server/src/db/schema/reviews.ts")
        self.assertTrue({"postgresql-table-design", "drizzle-orm-patterns"} <= skills)

    def test_contracts_get_zod(self):
        self.assertIn("zod", skills_for("server/src/vendor/shared/contracts/platform.ts")[0])
        self.assertNotIn("onion-architecture", skills_for("server/src/vendor/shared/index.ts")[0])

    def test_zod_import_adds_zod(self):
        self.assertIn("zod", skills_for("server/src/modules/x/schemas.ts", "import { z } from 'zod'")[0])
        self.assertNotIn("zod", skills_for("server/src/modules/x/schemas.ts", "export const a = 1")[0])

    def test_skipped_and_unmapped(self):
        self.assertTrue(skills_for("server/src/db/migrations/0003_x.sql")[1])
        self.assertTrue(skills_for("README.md")[1])
        skills, skipped, unmapped = skills_for(".github/workflows/server-unit.yml")
        self.assertEqual((skills, skipped, unmapped), ({"security"}, False, True))

    def test_never_routed_skills_never_appear(self):
        every = set()
        for path in ("client/src/a.tsx", "server/src/a.ts", "docs/a.md", "x.py"):
            every |= skills_for(path)[0]
        self.assertFalse(every & set(CFG["never_routed"]))

    def test_deleted_files_are_not_reviewed(self):
        buckets, _, _, deleted = rs.route([{"path": "server/src/a.ts", "status": "D"}], CFG, lambda _p: "")
        self.assertEqual((buckets, deleted), ({}, ["server/src/a.ts"]))

    def test_chunking(self):
        agents = rs.chunk_agents({"security": [f"f{i}" for i in range(7)]}, 3)
        self.assertEqual([a["id"] for a in agents], ["security#1", "security#2", "security#3"])
        self.assertEqual(sum(len(a["files"]) for a in agents), 7)

    def test_every_mapped_skill_exists(self):
        skills_dir = os.path.dirname(rs.SKILL_DIR)
        named = {s for r in CFG["routes"] + CFG["content_routes"] for s in r["skills"]} | set(CFG["unmapped_skills"])
        for skill in named:
            self.assertTrue(os.path.isfile(os.path.join(skills_dir, skill, "SKILL.md")), skill)


class GlobTest(unittest.TestCase):
    def test_globs(self):
        self.assertTrue(rs.glob_match("a/b/c.ts", "**/*.ts"))
        self.assertTrue(rs.glob_match("c.ts", "**/*.ts"))
        self.assertFalse(rs.glob_match("a/c.ts", "*.ts"))
        self.assertTrue(rs.glob_match("server/src/app.ts", "server/src/{app.ts,modules/**/routes.ts}"))
        self.assertTrue(rs.glob_match("server/src/modules/a/routes.ts", "server/src/{app.ts,modules/**/routes.ts}"))
        self.assertFalse(rs.glob_match("server/src/modules/a/service.ts", "server/src/{app.ts,modules/**/routes.ts}"))


class RepoRulesTest(unittest.TestCase):
    def rules(self, files, existing=()):
        found = rs.repo_rule_findings([{"path": p, "status": s} for p, s in files], lambda p: p in existing)
        return sorted(f["rule"] for f in found)

    def test_editing_an_existing_migration_is_critical(self):
        self.assertEqual(self.rules([("server/src/db/migrations/0003_x.sql", "M")]), ["migration-edited"])
        self.assertEqual(self.rules([("server/src/db/migrations/meta/0003_snapshot.json", "D")]),
                         ["migration-edited"])

    def test_generating_a_migration_is_fine(self):
        self.assertEqual(self.rules([("server/src/db/migrations/0015_new.sql", "A"),
                                     ("server/src/db/migrations/meta/0015_snapshot.json", "A"),
                                     ("server/src/db/migrations/meta/_journal.json", "M")]), [])

    def test_journal_edit_without_new_migration_is_critical(self):
        self.assertEqual(self.rules([("server/src/db/migrations/meta/_journal.json", "M")]), ["migration-edited"])

    def test_lockfiles(self):
        self.assertEqual(self.rules([("server/pnpm-lock.yaml", "M")]), ["lockfile-without-manifest"])
        self.assertEqual(self.rules([("server/pnpm-lock.yaml", "M"), ("server/package.json", "M")]), [])
        self.assertEqual(self.rules([("server/package-lock.json", "U")], existing={"server/pnpm-lock.yaml"}),
                         ["second-lockfile"])
        self.assertEqual(self.rules([("client/pnpm-lock.yaml", "D")]), ["lockfile-deleted"])

    def test_vendored_ui_and_skills_lock(self):
        self.assertEqual(self.rules([("client/src/vendor/ui/button.tsx", "M")]), ["vendored-ui-edited"])
        self.assertEqual(self.rules([("skills-lock.json", "M")]), ["skills-lock-without-skills"])
        self.assertEqual(self.rules([("skills-lock.json", "M"), (".claude/skills/zod/SKILL.md", "M")]), [])


class GatedCommandTest(unittest.TestCase):
    GATED = [
        "gh pr create --title x --body y",
        "gh pr merge 7 --squash",
        "gh pr ready 7",
        "git push",
        "git push -u origin feat/x",
        "git -C /repo push origin HEAD",
        "cd server && pnpm test && git push origin HEAD 2>&1",
        "FOO=1 git push",
        "git status\ngit push",
        "bash -c 'git push origin main'",
        "gh api -X POST repos/o/r/pulls -f title=x -f head=a -f base=main",
        "gh api repos/{owner}/{repo}/pulls -f title=x",
        "gh api --method PUT repos/o/r/pulls/7/merge",
        "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
        "echo $(git push)",
    ]
    NOT_GATED = [
        "git status",
        "git log --oneline | head",
        "git push --dry-run",
        "git push origin --delete old-branch",
        "gh pr view 7 --json body",
        "gh pr list",
        "gh pr edit 7 --title y",
        "gh api repos/o/r/pulls/7",
        "gh api -X PATCH repos/o/r/pulls/7 -f body=x",
        "gh api graphql -f query='query { viewer { login } }'",
        "git commit -m 'docs: explain when to git push'",
        "gh pr create --help",
        "pnpm push-notes",
        "git commit -F - <<'EOF'\nfeat: gate\n\ngit push and gh pr create are now gated\nEOF\ngit log -1",
        "cat > notes.md <<EOF\ngh pr merge 7\nEOF",
    ]

    def test_command_after_a_heredoc_is_still_seen(self):
        self.assertEqual(rs.is_gated_command("git commit -F - <<'EOF'\nmsg\nEOF\ngit push"), "git push")

    def test_gated(self):
        for cmd in self.GATED:
            self.assertIsNotNone(rs.is_gated_command(cmd), cmd)

    def test_not_gated(self):
        for cmd in self.NOT_GATED:
            self.assertIsNone(rs.is_gated_command(cmd), cmd)

    def test_unparseable_lookalike_errs_closed(self):
        self.assertIsNotNone(rs.is_gated_command("git push 'unterminated"))


class RepoFlowTest(unittest.TestCase):
    """End-to-end on a throwaway repo: plan → verdict → check, fingerprint staleness, the gate."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t")
        self.git("config", "user.name", "t")
        self.write(".gitignore", ".claude/.pr-self-review/\n")
        self.write(".claude/skills/pr-self-review/SKILL.md", "---\nname: pr-self-review\n---\n")
        self.write("server/src/app.ts", "export const a = 1\n")
        self.git("add", ".")
        self.git("commit", "-qm", "init")
        self.git("checkout", "-qb", "feat")
        self.old = os.getcwd()
        os.chdir(self.root)

    def tearDown(self):
        os.chdir(self.old)
        self.tmp.cleanup()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def write(self, path, text):
        full = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as fh:
            fh.write(text)

    def run_cli(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return rs.main(list(argv))

    def verdict(self, findings):
        with open(os.path.join(self.root, rs.STATE_REL, "plan.json")) as fh:
            plan = json.load(fh)
        # Inside the ignored state dir: an untracked file elsewhere would change the fingerprint.
        path = os.path.join(self.root, rs.STATE_REL, "findings.json")
        with open(path, "w") as fh:
            json.dump({"agents_completed": [a["id"] for a in plan["agents"]], "findings": findings}, fh)
        return self.run_cli("write-verdict", path)

    def gate(self, command):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": self.root})
        out = subprocess.run([sys.executable, GATE], input=payload, capture_output=True, text=True).stdout
        return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out.strip() else "allow"

    def test_no_changes_passes_without_a_review(self):
        self.assertEqual(rs.check(self.root)[0], 0)
        self.assertEqual(self.gate("gh pr create"), "allow")

    def test_full_flow(self):
        self.write("server/src/app.ts", "export const a = 2\n")
        self.write("server/src/new.ts", "export const b = 1\n")  # untracked counts too
        self.assertEqual(rs.check(self.root)[0], 1)
        self.assertEqual(self.gate("gh pr create"), "deny")
        self.assertEqual(self.gate("git status"), "allow")

        self.assertEqual(self.run_cli("plan", "--base", "main"), 0)
        with open(os.path.join(self.root, rs.STATE_REL, "plan.json")) as fh:
            plan = json.load(fh)
        self.assertIn("server/src/new.ts", {f["path"] for a in plan["agents"] for f in a["files"]})

        critical = {"severity": "CRITICAL", "skill": "security", "file": "server/src/app.ts", "line": 1,
                    "rule": "secret", "evidence": "x", "fix": "y"}
        self.assertEqual(self.verdict([critical]), 2)
        self.assertEqual(rs.check(self.root)[0], 2)
        self.assertEqual(self.gate("git push"), "deny")

        self.assertEqual(self.verdict([dict(critical, severity="WARNING")]), 0)
        self.assertEqual(rs.check(self.root)[0], 0)
        self.assertEqual(self.gate("gh pr create --fill"), "allow")

        self.git("add", ".")
        self.git("commit", "-qm", "work")  # committing does not change the diff vs base
        self.assertEqual(rs.check(self.root)[0], 0)

        self.write("server/src/new.ts", "export const b = 2\n")  # any edit makes it stale
        self.assertEqual(rs.check(self.root)[0], 1)
        self.assertEqual(self.gate("gh pr merge 1"), "deny")

    def test_verdict_refuses_a_partial_review_or_a_moved_tree(self):
        self.write("server/src/app.ts", "export const a = 2\n")
        self.run_cli("plan", "--base", "main")
        path = os.path.join(self.root, rs.STATE_REL, "findings.json")
        with open(path, "w") as fh:
            json.dump({"agents_completed": [], "findings": []}, fh)
        self.assertEqual(self.run_cli("write-verdict", path), 1)
        self.assertFalse(os.path.exists(os.path.join(self.root, rs.STATE_REL, "verdict.json")))
        self.write("server/src/app.ts", "export const a = 3\n")
        self.assertEqual(self.verdict([]), 1)

    def test_gate_blocks_hand_written_verdict(self):
        payload = json.dumps({"tool_name": "Write", "tool_input": {
            "file_path": os.path.join(self.root, ".claude/.pr-self-review/verdict.json"), "content": "{}"}})
        out = subprocess.run([sys.executable, GATE], input=payload, capture_output=True, text=True).stdout
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")


if __name__ == "__main__":
    unittest.main()
