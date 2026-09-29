"""Seat-scoped harness runtime; secrets remain in the launcher environment."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from musubi_harness.plugin_runtime import PluginRuntime, RuntimeConfig, RuntimeConfigError
from musubi_harness.tokens import token_presence_problems


class OpenCodeRuntime(PluginRuntime):
    def __init__(self) -> None:
        super().__init__(
            "musubi-opencode",
            default_data_root=Path.home() / ".local" / "state" / "musubi-opencode",
        )

    def plugin_config(self) -> dict[str, str]:
        # OpenCode's background service can host several identities under one
        # OS account. A shared config file must never select the seat.
        return {}

    def runtime_config(self) -> RuntimeConfig:
        config = super().runtime_config()
        if (
            config.actor != os.environ.get("MUSUBI_ACTOR")
            or config.presence != os.environ.get("MUSUBI_PRESENCE")
            or config.zone != os.environ.get("MUSUBI_ZONE")
        ):
            raise RuntimeConfigError("seat_identity_mismatch")
        self._connection()
        return config

    @staticmethod
    def _connection() -> tuple[str, str] | None:
        url = os.environ.get("MUSUBI_API_URL", "")
        token = os.environ.get("MUSUBI_TOKEN", "")
        if bool(url) != bool(token):
            raise RuntimeConfigError("connection_config_incomplete")
        return (url, token) if url else None

    @staticmethod
    def _sibling(name: str) -> str:
        sibling = Path(sys.executable).with_name(name)
        if sibling.is_file():
            return str(sibling)
        raise RuntimeConfigError(f"{name.replace('-', '_')}_unavailable")

    def harness_bin(self, config: RuntimeConfig | None = None) -> str:
        return self._sibling("musubi-harness")

    def memory_data_bin(self, config: RuntimeConfig | None = None) -> str:
        return self._sibling("musubi-memory-data")

    def _tool_environment(self, config: RuntimeConfig) -> dict[str, str]:
        env = super().tool_environment(config)
        connection = self._connection()
        if connection is not None:
            if token_presence_problems(connection[1], config.presence):
                raise RuntimeConfigError("token_presence_mismatch")
            env["MUSUBI_API_URL"], env["MUSUBI_TOKEN"] = connection
        return env

    @staticmethod
    def tool_environment(config: RuntimeConfig) -> dict[str, str]:
        return runtime._tool_environment(config)

    def local_tool_environment(self, config: RuntimeConfig) -> dict[str, str]:
        env = super().local_tool_environment(config)
        env.pop("MUSUBI_HARNESS_BIN", None)
        env.pop("MUSUBI_MEMORY_DATA_BIN", None)
        return env


runtime = OpenCodeRuntime()
