#!/usr/bin/env python3
"""One-shot setup of the deployment environments for Assignment 4.

Creates (idempotently):
  * dev / staging / production  - the three deployment environments
  * ai-review                   - a non-deployment environment used only as a
                                  scoped secret store for the agent job
  * per-environment VARIABLES   - BUILD_TAG, RELEASE_NOTE (and AI_MODEL)
  * per-environment SECRETS     - DEPLOY_SIGNING_KEY, distinct per stage
  * production protection rule  - required reviewer + wait timer

Run with:  GH_TOKEN=... REPO=owner/name python3 scripts/setup_environments.py
"""

from __future__ import annotations

import json
import os
import secrets as pysecrets
import subprocess
import sys
import urllib.error
import urllib.request

try:
    from nacl import encoding, public
except ImportError:  # pragma: no cover - convenience for a fresh machine
    print("PyNaCl missing (needed to encrypt secrets); installing it now...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "pynacl"],
                   check=False)
    try:
        from nacl import encoding, public
    except ImportError:
        encoding = public = None
        print("  could not install PyNaCl. Environments, variables and the\n"
              "  protection rule will still be configured; the three signing\n"
              "  secrets will be printed for you to paste in by hand.\n")

TOKEN = os.environ["GH_TOKEN"]
REPO = os.environ["REPO"]
# Optional: when present it is stored as the ai-review environment secret.
AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()
API = "https://api.github.com"

# BUILD_TAG carries the channel; the pipeline appends the resolved number.
ENVIRONMENTS: dict[str, dict] = {
    "dev": {
        "vars": {
            "BUILD_TAG": "dev-v1.0",
            "RELEASE_NOTE": "Automated development build from main. Not for testing sign-off.",
        },
        "protection": None,
    },
    "staging": {
        "vars": {
            "BUILD_TAG": "staging-v1.0",
            "RELEASE_NOTE": "Testing pre-production release.",
        },
        "protection": None,
    },
    "production": {
        "vars": {
            "BUILD_TAG": "prod-v1.0",
            "RELEASE_NOTE": "Production release. Promoted from the staging candidate after review.",
        },
        # Filled in at runtime once we know the account id.
        "protection": "required-reviewer",
    },
    # Not a deployment target. It exists so the agent's credential is scoped to
    # the one job that needs it instead of being a repository-wide secret.
    #
    # The endpoint is configuration, not code: the first version of this
    # pipeline used GitHub Models, which was retired on 30 July 2026. Changing
    # provider is now an environment variable edit.
    "ai-review": {
        "vars": {
            "AI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai",
            "AI_MODEL": "gemini-3.8-flash",
        },
        "protection": None,
    },
}

# Each deployment stage signs its artifact with its own key, so a staging
# signature cannot be replayed as a production one.
SIGNING_KEY_ENVS = ["dev", "staging", "production"]


def call(method: str, path: str, payload: dict | None = None) -> dict:
    url = path if path.startswith("http") else f"{API}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"{method} {path} -> HTTP {err.code}: {detail}") from None


def seal(public_key_b64: str, value: str) -> str:
    """Encrypt a secret for GitHub using a libsodium sealed box."""
    key = public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(key).encrypt(value.encode())
    return encoding.Base64Encoder().encode(sealed).decode()


def put_variable(env: str, name: str, value: str) -> None:
    base = f"/repos/{REPO}/environments/{env}/variables"
    try:
        call("POST", base, {"name": name, "value": value})
        print(f"    variable {name} created")
    except RuntimeError as err:
        if "409" in str(err) or "already exists" in str(err):
            call("PATCH", f"{base}/{name}", {"name": name, "value": value})
            print(f"    variable {name} updated")
        else:
            raise


MANUAL_SECRETS: list[tuple[str, str, str]] = []


def put_secret(env: str, name: str, value: str) -> None:
    if public is None:
        MANUAL_SECRETS.append((env, name, value))
        print(f"    secret {name} NOT set - add it by hand (printed at the end)")
        return
    key = call("GET", f"/repos/{REPO}/environments/{env}/secrets/public-key")
    call("PUT", f"/repos/{REPO}/environments/{env}/secrets/{name}", {
        "encrypted_value": seal(key["key"], value),
        "key_id": key["key_id"],
    })
    print(f"    secret {name} set (encrypted client side, value never logged)")


def main() -> int:
    me = call("GET", "/user")
    print(f"authenticated as {me['login']} (id {me['id']})")
    print(f"target repository: {REPO}\n")

    for env, spec in ENVIRONMENTS.items():
        print(f"[{env}]")

        body: dict = {}
        if spec["protection"] == "required-reviewer":
            # A human must approve before this environment is deployed to.
            body = {
                "wait_timer": 1,
                "prevent_self_review": False,
                "reviewers": [{"type": "User", "id": me["id"]}],
                "deployment_branch_policy": None,
            }

        call("PUT", f"/repos/{REPO}/environments/{env}", body)
        print("    environment created/updated"
              + (" with required reviewer + 1 min wait timer" if body else ""))

        for name, value in spec["vars"].items():
            put_variable(env, name, value)

        if env in SIGNING_KEY_ENVS:
            # Generated here, never printed, never stored outside GitHub.
            put_secret(env, "DEPLOY_SIGNING_KEY", pysecrets.token_hex(32))

        # Passed in through the environment so the key never appears in this
        # file, in the repository, or in a shell history entry of its own.
        if env == "ai-review" and AI_API_KEY:
            put_secret(env, "AI_API_KEY", AI_API_KEY)
        elif env == "ai-review":
            print("    secret AI_API_KEY skipped (AI_API_KEY was not set)")
        print()

    print("verification")
    envs = call("GET", f"/repos/{REPO}/environments")
    for env in envs.get("environments", []):
        rules = [r.get("type") for r in env.get("protection_rules", [])]
        v = call("GET", f"/repos/{REPO}/environments/{env['name']}/variables")
        names = sorted(x["name"] for x in v.get("variables", []))
        print(f"  {env['name']:12} rules={str(rules or 'none'):<40} vars={names}")

    if MANUAL_SECRETS:
        print("\n" + "=" * 68)
        print("Add these by hand: Settings > Environments > <env> > Add secret")
        print("=" * 68)
        for env, name, value in MANUAL_SECRETS:
            print(f"  {env:12} {name} = {value}")
        print("\nThese are throwaway HMAC keys for the signing demo. Any random\n"
              "hex string works, as long as each environment gets a different one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
