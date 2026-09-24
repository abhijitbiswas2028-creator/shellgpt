from pathlib import Path
from types import SimpleNamespace

from shellgpt_cli import uninstall


def test_dry_run_prints_plan_without_mutating(monkeypatch, tmp_path, capsys):
    project_root = tmp_path / "shellgpt-agent"
    shellgpt_home = tmp_path / ".shellgpt"
    project_root.mkdir()
    shellgpt_home.mkdir()
    (shellgpt_home / "config.yaml").write_text("model: {}\n")

    called = False

    def _fail_if_called(**kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(uninstall, "get_project_root", lambda: project_root)
    monkeypatch.setattr(uninstall, "get_shellgpt_home", lambda: shellgpt_home)
    monkeypatch.setattr(uninstall, "_is_default_shellgpt_home", lambda home: False)
    monkeypatch.setattr(uninstall, "_discover_named_profiles", lambda: [])
    monkeypatch.setattr(uninstall, "_perform_uninstall", _fail_if_called)

    uninstall.run_uninstall(SimpleNamespace(dry_run=True, yes=True, full=True))

    output = capsys.readouterr().out
    assert called is False
    assert "Dry run" in output
    assert str(project_root) in output
    assert str(shellgpt_home) in output
    assert project_root.exists()
    assert shellgpt_home.exists()


def test_build_uninstall_parser_accepts_dry_run():
    import argparse
    from shellgpt_cli.subcommands.uninstall import build_uninstall_parser

    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    build_uninstall_parser(subparsers, cmd_uninstall=lambda args: args)

    args = parser.parse_args(["uninstall", "--dry-run", "--full"])

    assert args.dry_run is True
    assert args.full is True
