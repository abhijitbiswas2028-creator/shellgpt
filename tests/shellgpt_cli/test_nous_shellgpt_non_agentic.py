"""Tests for the Nous-ShellGPT-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"shellgpt"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``shellgpt-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "shellgpt" tag namespace.

``is_nous_shellgpt_non_agentic`` should only match the actual Nous Research
ShellGPT-3 / ShellGPT-4 chat family.
"""

from __future__ import annotations

import pytest

from shellgpt_cli.model_switch import (
    _SHELLGPT_MODEL_WARNING,
    _check_shellgpt_model_warning,
    is_nous_shellgpt_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/ShellGPT-3-Llama-3.1-70B",
        "NousResearch/ShellGPT-3-Llama-3.1-405B",
        "shellgpt-3",
        "ShellGPT-3",
        "shellgpt-4",
        "shellgpt-4-405b",
        "shellgpt_4_70b",
        "openrouter/shellgpt3:70b",
        "openrouter/nousresearch/shellgpt-4-405b",
        "NousResearch/ShellGPT3",
        "shellgpt-3.1",
    ],
)
def test_matches_real_nous_shellgpt_chat_models(model_name: str) -> None:
    assert is_nous_shellgpt_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous ShellGPT 3/4"
    )
    assert _check_shellgpt_model_warning(model_name) == _SHELLGPT_MODEL_WARNING


