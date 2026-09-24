"""Regression for #21454: re-running install.sh on a symlinked prior install.

Older versions of ``install.sh`` created ``$command_link_dir/shellgpt`` as a
symlink to the pip-generated entry point at ``$SHELLGPT_BIN`` (i.e.
``venv/bin/shellgpt``). When ``setup_path()`` later switched to writing a bash
shim with ``cat > "$command_link_dir/shellgpt" <<EOF``, the redirect followed
the existing symlink and overwrote the pip entry point with the shim. The
shim's ``exec "$SHELLGPT_BIN" "$@"`` then self-recursed and ``shellgpt`` hung on
every invocation.

These tests pin the fix: ``setup_path()`` must remove ``$command_link_dir/shellgpt``
before writing through the redirect, so the shim is created as a regular file
in ``command_link_dir`` and the venv entry point is left intact.
"""

from __future__ import annotations

import re
import stat
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"


def _extract_setup_path_shim_block() -> str:
    """Return the install.sh shim-write block used by setup_path()."""
    text = INSTALL_SH.read_text()
    match = re.search(
        r"(?P<block>mkdir -p \"\$command_link_dir\".*?chmod \+x \"\$command_link_dir/shellgpt\")",
        text,
        re.DOTALL,
    )
    assert match is not None, (
        "Could not locate the setup_path shim-write block in scripts/install.sh"
    )
    return match["block"]


def test_re_running_setup_path_block_preserves_pip_entry_point(tmp_path: Path) -> None:
    """Behavioral repro: simulate prior-install symlink + new-install heredoc.

    Layout mirrors a real install:

        tmp/
          venv/bin/shellgpt        <- pip entry point (the one we must preserve)
          local_bin/shellgpt       <- symlink → ../venv/bin/shellgpt  (old install)

    Then we run the exact shim-write block from setup_path() with
    ``SHELLGPT_BIN`` and ``command_link_dir`` pointed at this fixture. The fix
    requires that, after the run:

      * ``venv/bin/shellgpt`` still contains its original pip-script body
      * ``local_bin/shellgpt`` is a regular file (not a symlink) holding the shim
    """
    venv_bin = tmp_path / "venv" / "bin"
    venv_bin.mkdir(parents=True)
    pip_entry = venv_bin / "shellgpt"
    pip_marker = "#!/usr/bin/env python\n# pip-generated entry point — must not be overwritten\n"
    pip_entry.write_text(pip_marker)
    pip_entry.chmod(pip_entry.stat().st_mode | stat.S_IXUSR)

    command_link_dir = tmp_path / "local_bin"
    command_link_dir.mkdir()
    shim_path = command_link_dir / "shellgpt"
    # Reproduce the prior-install state: shim path is a symlink to the
    # pip-generated entry point.
    shim_path.symlink_to(pip_entry)
    assert shim_path.is_symlink()

    block = _extract_setup_path_shim_block()
    # Drive the block with the real env vars setup_path() sets.
    script = f'set -e\nSHELLGPT_BIN={pip_entry!s}\ncommand_link_dir={command_link_dir!s}\n{block}\n'
    result = subprocess.run(
        ["bash", "-c", script],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert result.returncode == 0, (
        f"shim-write block failed:\nstdout={result.stdout}\nstderr={result.stderr}"
    )

    # The pip entry point must still be the original pip script — not a
    # re-written self-recursing bash shim.
    assert pip_entry.read_text() == pip_marker, (
        "venv/bin/shellgpt was overwritten by setup_path() — symlink-stomp "
        "regression (#21454)."
    )

    # The shim path itself must now be a regular file holding the launcher.
    assert shim_path.exists()
    assert not shim_path.is_symlink(), (
        "command_link_dir/shellgpt must be replaced with a regular file, not "
        "left as a symlink — otherwise the next install will stomp again."
    )
    shim_text = shim_path.read_text()
    assert "unset PYTHONPATH" in shim_text
    assert "unset PYTHONHOME" in shim_text
    assert f'exec "{pip_entry}"' in shim_text
    shim_mode = shim_path.stat().st_mode
    assert shim_mode & stat.S_IXUSR, "shim must be user-executable"
