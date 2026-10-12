#!/usr/bin/env python3
"""Work out the tag for this run.

The environment supplies the *channel* through the BUILD_TAG environment
variable (dev / staging / prod). The pipeline supplies the *number*, so a
release never depends on somebody remembering to edit a variable by hand.

Precedence:
  1. package.json "version" is the source of truth for major.minor.
  2. The highest existing tag on this channel decides the patch number:
     the next release is that patch + 1.
  3. If nothing exists yet, start at .0

Writes channel, version and tag to $GITHUB_OUTPUT.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

CHANNEL_RE = re.compile(r"^(dev|staging|prod)")
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True,
                          check=False).stdout.strip()


def channel_from_build_tag(build_tag: str) -> str:
    """'staging-v1.0' -> 'staging'. Falls back to 'dev'."""
    match = CHANNEL_RE.match(build_tag.strip().lower())
    return match.group(1) if match else "dev"


def base_version() -> tuple[int, int]:
    """major.minor from package.json, defaulting to 1.0."""
    path = pathlib.Path("package.json")
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8")).get("version", "")
            match = SEMVER_RE.match(str(raw).strip())
            if match:
                return int(match.group(1)), int(match.group(2))
        except (json.JSONDecodeError, OSError):
            pass
    return 1, 0


def next_patch(channel: str, major: int, minor: int) -> int:
    """Highest patch already released on this channel, plus one."""
    git("fetch", "--tags", "--force", "--quiet")
    pattern = re.compile(rf"^{re.escape(channel)}-v{major}\.{minor}\.(\d+)$")
    highest = -1
    for tag in git("tag", "--list", f"{channel}-v*").splitlines():
        match = pattern.match(tag.strip())
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def main() -> int:
    build_tag = os.environ.get("BUILD_TAG", "")
    channel = channel_from_build_tag(build_tag)
    major, minor = base_version()
    patch = next_patch(channel, major, minor)

    version = f"{major}.{minor}.{patch}"
    tag = f"{channel}-v{version}"
    describe = git("describe", "--tags", "--always", "--dirty") or "unknown"

    print(f"BUILD_TAG variable : {build_tag or '(unset)'}")
    print(f"channel            : {channel}")
    print(f"package.json base  : {major}.{minor}")
    print(f"next patch         : {patch}")
    print(f"resolved tag       : {tag}")
    print(f"git describe       : {describe}")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as handle:
            handle.write(f"channel={channel}\n")
            handle.write(f"version={version}\n")
            handle.write(f"tag={tag}\n")
            handle.write(f"describe={describe}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
