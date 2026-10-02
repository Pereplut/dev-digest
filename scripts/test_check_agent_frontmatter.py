#!/usr/bin/env python3
"""Tests for scripts/check-agent-frontmatter.py.

Every rule gets a PAIRED NEGATIVE: the failing case and the same fixture with
only the offending part fixed — root `INSIGHTS.md` (2026-09-23, 2026-09-30)
records why a guard suite with no negatives can sit fully green while the hole
it exists for stays open.

The module under test has a hyphen in its filename (`check-agent-frontmatter.py`,
matching the plan's own naming), so it is loaded with `importlib.util` rather
than a plain `import` statement, which cannot name a hyphenated module.

Run: python3 -m unittest discover -s scripts -p 'test_check_agent_frontmatter.py'
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # a sibling import must not litter scripts/__pycache__

_SCRIPT = Path(__file__).resolve().parent / "check-agent-frontmatter.py"
_spec = importlib.util.spec_from_file_location("check_agent_frontmatter", _SCRIPT)
check_agent_frontmatter = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(check_agent_frontmatter)


def agent_md(name: str, model: str) -> str:
    return (
        "---\n"
        f"name: {name}\n"
        "description: >-\n"
        "  A throwaway fixture agent.\n"
        f"model: {model}\n"
        "---\n\n"
        f"# {name}\n"
    )


README = """# Agents

## Catalog

| Agent | Model | Permissions | Responsibility |
|---|---|---|---|
| [architecture-reviewer](architecture-reviewer.md) | `sonnet` | `Read` | Layering. |
| [plan-verifier](plan-verifier.md) | `sonnet` | `Read` | Completeness. |
| [other-agent](other-agent.md) | `opus` | `Read` | A third agent, so AC-11 is proven generic rather than a 2-name special case. |
"""


class Fixture:
    """A throwaway repo with `.claude/agents/*.md` and a matching README."""

    def __init__(
        self,
        agents: dict[str, str] | None = None,
        readme: str = README,
        skip: tuple[str, ...] = (),
    ):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        agents_dir = self.repo / ".claude" / "agents"
        agents_dir.mkdir(parents=True)
        files = agents or {
            "architecture-reviewer": agent_md("architecture-reviewer", "sonnet"),
            "plan-verifier": agent_md("plan-verifier", "sonnet"),
            "other-agent": agent_md("other-agent", "opus"),
        }
        for name, text in files.items():
            if name in skip:
                continue
            (agents_dir / f"{name}.md").write_text(text, encoding="utf-8")
        (agents_dir / "README.md").write_text(readme, encoding="utf-8")

    def run(self) -> list[str]:
        return check_agent_frontmatter.check(self.repo)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.dir.cleanup()


class AgentFrontmatterCheckTest(unittest.TestCase):
    def assertProblem(self, problems: list[str], needle: str):
        self.assertTrue(
            any(needle in p for p in problems),
            f"expected a problem containing {needle!r}, got {problems}",
        )

    # --- the baseline. If this ever fails, every negative below is meaningless. ---

    def test_a_well_formed_roster_passes(self):
        with Fixture() as f:
            self.assertEqual(f.run(), [])

    # --- AC-9, paired ---

    def test_architecture_reviewer_not_sonnet_fails(self):
        agents = {
            "architecture-reviewer": agent_md("architecture-reviewer", "opus"),
            "plan-verifier": agent_md("plan-verifier", "sonnet"),
            "other-agent": agent_md("other-agent", "opus"),
        }
        readme = README.replace(
            "| [architecture-reviewer](architecture-reviewer.md) | `sonnet` |",
            "| [architecture-reviewer](architecture-reviewer.md) | `opus` |",
        )
        with Fixture(agents, readme) as f:
            self.assertProblem(f.run(), "architecture-reviewer.md: frontmatter `model` is 'opus'")

    # --- AC-10, paired ---

    def test_plan_verifier_not_sonnet_fails(self):
        agents = {
            "architecture-reviewer": agent_md("architecture-reviewer", "sonnet"),
            "plan-verifier": agent_md("plan-verifier", "opus"),
            "other-agent": agent_md("other-agent", "opus"),
        }
        readme = README.replace(
            "| [plan-verifier](plan-verifier.md) | `sonnet` |",
            "| [plan-verifier](plan-verifier.md) | `opus` |",
        )
        with Fixture(agents, readme) as f:
            self.assertProblem(f.run(), "plan-verifier.md: frontmatter `model` is 'opus'")

    # --- AC-11: README vs. frontmatter agreement, paired both directions ---

    def test_readme_out_of_step_with_frontmatter_fails(self):
        """The file says sonnet; the README catalog still says opus."""
        readme = README.replace(
            "| [architecture-reviewer](architecture-reviewer.md) | `sonnet` |",
            "| [architecture-reviewer](architecture-reviewer.md) | `opus` |",
        )
        with Fixture(readme=readme) as f:
            self.assertProblem(
                f.run(),
                "catalog Model column for 'architecture-reviewer' is `opus`, but "
                ".claude/agents/architecture-reviewer.md says `model: sonnet`",
            )

    def test_over_eager_mutant_flipping_every_row_is_caught(self):
        """The exact failure mode named in the fix-loop message: flip ALL rows to
        sonnet (as a careless find/replace on 'opus' would) and the THIRD, generic
        agent — never specially-cased in this checker — is what catches it.
        """
        readme = README.replace("`opus`", "`sonnet`")
        with Fixture(readme=readme) as f:
            self.assertProblem(
                f.run(),
                "catalog Model column for 'other-agent' is `sonnet`, but "
                ".claude/agents/other-agent.md says `model: opus`",
            )

    def test_a_third_agent_is_checked_without_being_named_in_code(self):
        """AC-11 is derived, not a 2-name special case: break ONLY the third
        agent's row and the checker still catches it, with no code change.
        """
        readme = README.replace(
            "| [other-agent](other-agent.md) | `opus` |",
            "| [other-agent](other-agent.md) | `sonnet` |",
        )
        with Fixture(readme=readme) as f:
            self.assertProblem(
                f.run(),
                "catalog Model column for 'other-agent' is `sonnet`, but "
                ".claude/agents/other-agent.md says `model: opus`",
            )

    def test_an_agent_file_with_no_model_key_fails(self):
        agents = {
            "architecture-reviewer": agent_md("architecture-reviewer", "sonnet"),
            "plan-verifier": agent_md("plan-verifier", "sonnet"),
            "other-agent": "---\nname: other-agent\ndescription: >-\n  No model key.\n---\n",
        }
        with Fixture(agents) as f:
            self.assertProblem(f.run(), "other-agent.md: frontmatter has no `model:` key")

    def test_a_catalog_row_missing_for_a_known_agent_fails(self):
        readme = README.replace(
            "| [other-agent](other-agent.md) | `opus` | `Read` | A third agent, so AC-11 is "
            "proven generic rather than a 2-name special case. |\n",
            "",
        )
        with Fixture(readme=readme) as f:
            self.assertProblem(f.run(), "no catalog row found for 'other-agent'")

    # --- derivation, not hardcoding: a missing agent file is reported, not silently skipped ---

    def test_a_missing_required_agent_file_is_reported_not_silently_skipped(self):
        with Fixture(skip=("architecture-reviewer",)) as f:
            self.assertProblem(
                f.run(),
                ".claude/agents/architecture-reviewer.md not found (AC-9/AC-10 cannot be checked)",
            )


class RepoTest(unittest.TestCase):
    """The checker against the real repo, so the fixtures cannot drift from reality."""

    def test_the_real_roster_is_clean(self):
        """As of spec 0015's S14/S15, both agents run sonnet and the README agrees.

        If this ever fails against the real repo, either the model flip or the
        README update regressed — this is the live evidence, not a fixture.
        """
        repo = Path(__file__).resolve().parent.parent
        problems = check_agent_frontmatter.check(repo)
        self.assertEqual(problems, [], problems)

    def test_the_real_agent_directory_is_not_empty(self):
        """If this ever hits zero the checker is passing vacuously."""
        repo = Path(__file__).resolve().parent.parent
        agents = check_agent_frontmatter.agent_files(repo)
        self.assertGreater(len(agents), 0, "no .claude/agents/*.md files found")


if __name__ == "__main__":
    unittest.main(verbosity=2)
