"""Unit tests for scripts/compute_version.py.

This script decides what every release in the pipeline is called. If it is
wrong, a release either collides with an existing tag or skips a number, and
both are the kind of mistake nobody notices until they are trying to work out
which build a customer is running.

The tag-walking test builds a real throwaway git repository rather than
mocking `git`, because the thing worth testing is the interaction with git's
actual tag output, not our idea of it.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import compute_version as cv

# ───────────────────────── channel parsing ─────────────────────────

@pytest.mark.parametrize(
    ("build_tag", "expected"),
    [
        ("dev-v1.0", "dev"),
        ("staging-v1.0", "staging"),
        ("prod-v1.0", "prod"),
        ("prod", "prod"),
        ("STAGING-v2.3", "staging"),      # case is normalised
        ("  dev-v1.0  ", "dev"),          # surrounding whitespace is ignored
    ],
)
def test_channel_is_read_from_the_build_tag(build_tag, expected):
    assert cv.channel_from_build_tag(build_tag) == expected


@pytest.mark.parametrize("build_tag", ["", "   ", "qa-v1.0", "nonsense"])
def test_unknown_channel_falls_back_to_dev(build_tag):
    """An unset or unrecognised BUILD_TAG must not resolve to a release channel.

    Defaulting to "prod" here would mean a misconfigured environment variable
    silently produced a production tag.
    """
    assert cv.channel_from_build_tag(build_tag) == "dev"


# ───────────────────────── base version ─────────────────────────

def _write_package_json(tmp_path: Path, version) -> None:
    payload = {"name": "fixture"}
    if version is not None:
        payload["version"] = version
    (tmp_path / "package.json").write_text(json.dumps(payload), encoding="utf-8")


def test_base_version_comes_from_package_json(tmp_path, monkeypatch):
    _write_package_json(tmp_path, "2.7.4")
    monkeypatch.chdir(tmp_path)
    assert cv.base_version() == (2, 7)


@pytest.mark.parametrize(
    "version",
    [None, "", "not-a-version", "1.0", "v1.0.0", "1.0.0-rc1"],
)
def test_unusable_version_falls_back_to_one_zero(tmp_path, monkeypatch, version):
    _write_package_json(tmp_path, version)
    monkeypatch.chdir(tmp_path)
    assert cv.base_version() == (1, 0)


def test_missing_package_json_falls_back_to_one_zero(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cv.base_version() == (1, 0)


def test_malformed_package_json_does_not_raise(tmp_path, monkeypatch):
    (tmp_path / "package.json").write_text("{ this is not json", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert cv.base_version() == (1, 0)


# ───────────────────────── patch resolution ─────────────────────────

def _git_repo_with_tags(tmp_path: Path, tags) -> Path:
    """A real git repository carrying the given tags."""
    run = lambda *a: subprocess.run(  # noqa: E731
        ["git", *a], cwd=tmp_path, check=True,
        capture_output=True, text=True,
    )
    run("init", "-q", "-b", "main")
    run("config", "user.email", "test@example.com")
    run("config", "user.name", "Test")
    (tmp_path / "README.md").write_text("fixture\n", encoding="utf-8")
    run("add", "-A")
    run("commit", "-q", "-m", "initial")
    for tag in tags:
        run("tag", tag)
    return tmp_path


def test_first_release_on_a_channel_starts_at_zero(tmp_path, monkeypatch):
    _git_repo_with_tags(tmp_path, [])
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 0) == 0


def test_patch_is_one_above_the_highest_existing_tag(tmp_path, monkeypatch):
    _git_repo_with_tags(tmp_path, ["prod-v1.0.0", "prod-v1.0.1", "prod-v1.0.2"])
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 0) == 3


def test_patch_numbers_are_compared_numerically_not_as_text(tmp_path, monkeypatch):
    """`prod-v1.0.10` must beat `prod-v1.0.9`, which string sorting gets wrong."""
    _git_repo_with_tags(tmp_path, ["prod-v1.0.9", "prod-v1.0.10"])
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 0) == 11


def test_channels_do_not_borrow_each_others_numbers(tmp_path, monkeypatch):
    _git_repo_with_tags(
        tmp_path, ["prod-v1.0.5", "staging-v1.0.9", "dev-v1.0.42"]
    )
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 0) == 6
    assert cv.next_patch("staging", 1, 0) == 10


def test_a_different_minor_line_starts_its_own_count(tmp_path, monkeypatch):
    """Bumping package.json to 1.1 must not inherit 1.0's patch numbers."""
    _git_repo_with_tags(tmp_path, ["prod-v1.0.7"])
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 1) == 0


def test_unrelated_tags_are_ignored(tmp_path, monkeypatch):
    _git_repo_with_tags(
        tmp_path, ["prod-v1.0.1", "v2.0.0", "release-99", "prod-v1.0.x"]
    )
    monkeypatch.chdir(tmp_path)
    assert cv.next_patch("prod", 1, 0) == 2


# ───────────────────────── end to end ─────────────────────────

def test_main_writes_the_resolved_tag_to_github_output(tmp_path, monkeypatch, capsys):
    """The workflow reads these four keys; renaming one breaks the pipeline."""
    _git_repo_with_tags(tmp_path, ["prod-v1.0.1"])
    _write_package_json(tmp_path, "1.0.0")
    monkeypatch.chdir(tmp_path)

    output = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("BUILD_TAG", "prod-v1.0")

    assert cv.main() == 0

    written = dict(
        line.split("=", 1)
        for line in output.read_text(encoding="utf-8").splitlines()
        if "=" in line
    )
    assert written["channel"] == "prod"
    assert written["version"] == "1.0.2"
    assert written["tag"] == "prod-v1.0.2"
    assert "describe" in written


def test_main_is_silent_about_github_output_when_not_in_actions(tmp_path, monkeypatch):
    """Running the script by hand must not crash just because the var is unset."""
    _git_repo_with_tags(tmp_path, [])
    _write_package_json(tmp_path, "1.0.0")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    monkeypatch.setenv("BUILD_TAG", "dev-v1.0")

    assert cv.main() == 0


def test_script_runs_as_a_subprocess_on_this_interpreter(tmp_path):
    """Guards the shebang/syntax path the workflow actually uses."""
    _git_repo_with_tags(tmp_path, [])
    _write_package_json(tmp_path, "1.0.0")
    script = Path(cv.__file__)

    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=tmp_path,
        env={**os.environ, "BUILD_TAG": "staging-v1.0", "GITHUB_OUTPUT": ""},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "staging-v1.0.0" in result.stdout
