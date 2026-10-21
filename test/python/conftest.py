"""Make the pipeline's helper scripts importable as modules.

The scripts in scripts/ are executables, not a package, so the test run puts
that directory on sys.path rather than turning the repository into one. This
keeps the scripts runnable exactly as the workflows run them.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
