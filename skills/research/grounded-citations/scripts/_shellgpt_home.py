"""Resolve SHELLGPT_HOME for standalone skill scripts.

Skill scripts may run outside the ShellGPT process (system Python, nix env,
CI) where ``shellgpt_constants`` is not importable.  This module provides the
same ``get_shellgpt_home()`` contract without requiring it on ``sys.path``.

When ``shellgpt_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from shellgpt_constants import get_shellgpt_home as get_shellgpt_home
except (ModuleNotFoundError, ImportError):

    def get_shellgpt_home() -> Path:
        """Return the ShellGPT home directory (default: ``~/.shellgpt``)."""
        val = os.environ.get("SHELLGPT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".shellgpt"
