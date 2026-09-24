"""Resolve SHELLGPT_HOME for standalone skill scripts.

Skill scripts may run outside the ShellGPT process (e.g. system Python,
nix env, CI) where ``shellgpt_constants`` is not importable.  This module
provides the same ``get_shellgpt_home()`` and ``display_shellgpt_home()``
contracts as ``shellgpt_constants`` without requiring it on ``sys.path``.

When ``shellgpt_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``shellgpt_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``SHELLGPT_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from shellgpt_constants import display_shellgpt_home as display_shellgpt_home
    from shellgpt_constants import get_shellgpt_home as get_shellgpt_home
except (ModuleNotFoundError, ImportError):

    def get_shellgpt_home() -> Path:
        """Return the ShellGPT home directory (default: ~/.shellgpt).

        Mirrors ``shellgpt_constants.get_shellgpt_home()``."""
        val = os.environ.get("SHELLGPT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".shellgpt"

    def display_shellgpt_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``shellgpt_constants.display_shellgpt_home()``."""
        home = get_shellgpt_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
