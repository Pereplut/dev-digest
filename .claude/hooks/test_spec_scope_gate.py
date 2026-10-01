#!/usr/bin/env python3
"""Tests for spec-scope-gate.py.

The corpus is built from CAPABILITY, not from spelling: every way a write can LAND outside the spec
directories gets a case, whether or not it looks like the others. Root INSIGHTS.md records the
failure this avoids — a suite where every case spelled the flag literally stayed green while two
live bypasses worked, because it asserted what the implementation did instead of testing it.

Run: python3 .claude/hooks/test_spec_scope_gate.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "spec-scope-gate.py")
REPO = os.path.realpath(os.path.join(HERE, "..", ".."))
AGENT_FILE = os.path.join(REPO, ".claude", "agents", "spec-creator.md")
SETTINGS = os.path.join(REPO, ".claude", "settings.json")

sys.path.insert(0, HERE)
import importlib.util

_spec = importlib.util.spec_from_file_location("spec_scope_gate", HOOK)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def payload(path, agent="spec-creator", tool="Write", cwd=REPO):
    data = {
        "hook_event_name": "PreToolUse",
        "tool_name": tool,
        "tool_input": {"file_path": path},
        "cwd": cwd,
    }
    if agent is not None:
        data["agent_type"] = agent
    return data


def run_hook(data):
    """Drive the REAL hook as a subprocess. Returns the permissionDecision, or None."""
    proc = subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(data),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise AssertionError(f"hook exited {proc.returncode}: {proc.stderr}")
    out = proc.stdout.strip()
    if not out:
        return None
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"]


# Paths the agent MUST be able to write. Its whole job is these.
ALLOWED = [
    "specs/0013-spec-creator.md",
    "specs/README.md",
    "server/specs/0002-something.md",
    "client/specs/README.md",
    "reviewer-core/specs/0001-x.md",
    "e2e/specs/0001-y.md",
    "mcp/specs/README.md",            # the directory does not exist yet; it must still be allowed
    "specs/nested/deeper/thing.md",
    os.path.join(REPO, "specs", "0014-absolute-but-inside.md"),
]

# Every way a write can LAND outside the spec directories.
DENIED = [
    # ordinary code and repo files
    "server/src/index.ts",
    "client/src/app/page.tsx",
    "INSIGHTS.md",
    "server/INSIGHTS.md",
    "AGENTS.md",
    "README.md",
    "docs/skills.md",
    # its own machinery — the agent must not be able to widen its own boundary
    ".claude/agents/spec-creator.md",
    ".claude/settings.json",
    ".claude/hooks/spec-scope-gate.py",
    ".claude/specs/sneaky.md",        # a dotted top-level dir is not a package
    # right directory, wrong kind of file
    "specs/notes.txt",
    "specs/diagram.png",
    "specs/script.py",
    "server/specs/data.json",
    # the directory itself, and an empty target
    "specs",
    "specs/",
    "",
    # traversal out of an allowed directory
    "specs/../server/src/x.ts",
    "specs/../../outside.md",
    "server/specs/../../server/src/x.ts",
    "specs/sub/../../INSIGHTS.md",
    "./specs/./../AGENTS.md",
    # absolute paths that leave the repo
    "/etc/passwd",
    "/tmp/anything.md",
    os.path.expanduser("~/.ssh/authorized_keys"),
    os.path.join(os.path.dirname(REPO), "sibling-repo", "specs", "x.md"),
    # two levels down is not a package specs dir
    "server/src/specs/x.md",
]


class SpecPathTest(unittest.TestCase):
    def test_allowed_paths_are_allowed(self):
        for path in ALLOWED:
            with self.subTest(path=path):
                self.assertTrue(gate.is_spec_path(REPO, path), f"{path} should be writable")

    def test_denied_paths_are_denied(self):
        for path in DENIED:
            with self.subTest(path=path):
                self.assertFalse(gate.is_spec_path(REPO, path), f"{path} should be refused")

    def test_a_symlinked_specs_dir_is_judged_by_where_it_lands(self):
        """The check must resolve, not match the string: `specs/` pointing outside is not `specs/`."""
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "repo")
            outside = os.path.join(tmp, "outside")
            os.makedirs(os.path.join(root, ".git"))
            os.makedirs(outside)
            os.symlink(outside, os.path.join(root, "specs"))
            self.assertFalse(gate.is_spec_path(root, "specs/escaped.md"))

    def test_a_real_specs_dir_in_the_same_shape_is_allowed(self):
        """The negative above must fail for the symlink, not for the temp-dir setup."""
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "repo")
            os.makedirs(os.path.join(root, ".git"))
            os.makedirs(os.path.join(root, "specs"))
            self.assertTrue(gate.is_spec_path(root, "specs/fine.md"))


class HookEndToEndTest(unittest.TestCase):
    """Drives the real hook process, so the wiring is tested and not just the helper."""

    def test_the_hook_denies_every_path_outside_the_spec_dirs(self):
        for path in DENIED:
            with self.subTest(path=path):
                self.assertEqual(run_hook(payload(path)), "deny", f"{path} was not denied")

    def test_the_hook_allows_the_spec_dirs(self):
        for path in ALLOWED:
            with self.subTest(path=path):
                self.assertIsNone(run_hook(payload(path)), f"{path} was blocked")

    def test_every_write_tool_is_covered(self):
        for tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
            with self.subTest(tool=tool):
                self.assertEqual(run_hook(payload("server/src/x.ts", tool=tool)), "deny")

    def test_the_main_session_is_untouched(self):
        """agent_type absent = the main session. It must be able to write anything."""
        for path in DENIED:
            with self.subTest(path=path):
                self.assertIsNone(run_hook(payload(path, agent=None)))

    def test_other_agents_are_untouched(self):
        for agent in ("doc-writer", "implementer", "test-writer", "general-purpose"):
            with self.subTest(agent=agent):
                self.assertIsNone(run_hook(payload("server/src/x.ts", agent=agent)))

    def test_a_malformed_payload_does_not_block_the_main_session(self):
        proc = subprocess.run([sys.executable, HOOK], input="not json",
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")

    def test_a_spec_creator_payload_with_no_path_is_denied(self):
        data = payload("x")
        data["tool_input"] = {}
        self.assertEqual(run_hook(data), "deny")


class AgentContractTest(unittest.TestCase):
    """The hook's guarantee holds only while spec-creator has no other way to write a file.

    It cannot read the agent's frontmatter at run time, so the tool list is pinned here instead.
    If one of these fails, the boundary is gone — not merely untidy.
    """

    # An ALLOWLIST, deliberately — the inverse of this set was a denylist of
    # write-capable tool names, and it let anything nobody had thought of through
    # silently. `Artifact` alone (its `read_file`/`read_asset` actions save to disk)
    # would have passed. Root INSIGHTS.md, 2026-09-23: "seven rounds of blacklisting
    # flags lost; narrowing the allowlist was the fix" — the same shape, applied to
    # tool names. A newly granted tool FAILS this test until someone assesses it,
    # which is the only direction that is safe to get wrong.
    #
    # ADMISSION TEST — what "assessed" means, so this does not decay back into a
    # denylist by people adding whatever the test just rejected:
    #   A tool may be admitted ONLY IF it cannot reach the filesystem at all, OR
    #   every path by which it can reach the filesystem is routed through `Write`
    #   or `Edit`, and therefore through this hook.
    #
    # Two members are conditional and are NOT safe in the absolute sense the name
    # suggests — read it as "assessed", not "harmless":
    #   Write, Edit — admitted ONLY because this hook bounds them. They are the
    #     two tools the whole control exists for. If this hook stops running, they
    #     are the hole.
    #   Skill — admitted on a measurement, not an assumption (2026-10-01): loading
    #     a skill adds instructions to context, never tools. Probed twice from a
    #     fresh `claude -p --agent spec-creator`, per root INSIGHTS.md:178-184:
    #     (1) `drizzle-orm-patterns`, whose frontmatter declares
    #         `allowed-tools: Read, Write, Edit, Bash, Grep, Glob`, did not
    #         materialise `Bash` -> BASH_NOT_IN_MY_TOOLSET;
    #     (2) `spec-authoring`, which loaded cleanly, left the toolset identical
    #         -> SKILL_LOADED_TOOLSET_UNCHANGED.
    #     So `allowed-tools` grants permission for tools already in the roster; it
    #     does not add one. Residual, deliberately unclosed: probe (1)'s skill
    #     returned an error rather than loading, and probe (2)'s skill declares no
    #     `allowed-tools`, so a successfully-loading skill that DOES declare them
    #     has not been observed. Re-measure before widening this reasoning.
    KNOWN_SAFE = {"Read", "Grep", "Glob", "Write", "Edit", "Skill", "TodoWrite"}

    def _tools(self):
        with open(AGENT_FILE, encoding="utf-8") as fh:
            text = fh.read()
        match = re.search(r"^tools:\s*(.+)$", text, re.MULTILINE)
        self.assertIsNotNone(match, "spec-creator.md must declare an explicit `tools:` allowlist")
        return {t.strip() for t in match.group(1).split(",") if t.strip()}

    def test_the_agent_declares_a_tool_allowlist(self):
        self.assertTrue(self._tools())

    def test_the_agent_holds_no_tool_that_writes_by_another_route(self):
        unassessed = self._tools() - self.KNOWN_SAFE
        self.assertFalse(
            unassessed,
            f"spec-creator was granted {sorted(unassessed)}, which nobody has assessed against this "
            "boundary. spec-scope-gate.py bounds Write/Edit only; a tool that reaches the filesystem "
            "by another route (Bash, Agent/Task, NotebookEdit, Artifact's file-saving actions) "
            "removes the boundary without touching this hook. Assess the tool, then either add it to "
            "KNOWN_SAFE with a reason or stop claiming the boundary in .claude/agents/README.md.",
        )

    def test_the_hook_is_registered_in_settings(self):
        with open(SETTINGS, encoding="utf-8") as fh:
            settings = json.load(fh)
        commands = [
            hook.get("command", "")
            for entry in settings["hooks"]["PreToolUse"]
            for hook in entry.get("hooks", [])
        ]
        self.assertTrue(
            any("spec-scope-gate.py" in c for c in commands),
            "spec-scope-gate.py is not registered under PreToolUse in .claude/settings.json",
        )

    def test_the_registered_matcher_covers_the_write_tools(self):
        with open(SETTINGS, encoding="utf-8") as fh:
            settings = json.load(fh)
        matchers = [
            entry.get("matcher", "")
            for entry in settings["hooks"]["PreToolUse"]
            if any("spec-scope-gate.py" in h.get("command", "") for h in entry.get("hooks", []))
        ]
        self.assertTrue(matchers, "no matcher found for spec-scope-gate.py")
        for tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
            with self.subTest(tool=tool):
                self.assertTrue(
                    any(re.search(m, tool) for m in matchers),
                    f"the matcher does not select {tool}, so the hook never sees it",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
