from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

Level = Literal["error", "warning", "info"]


@dataclass(frozen=True)
class Finding:
    level: Level
    code: str
    message: str
    path: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass(frozen=True)
class OperationResult:
    action: str
    path: Path
    details: dict[str, object]

    def to_dict(self) -> dict[str, object]:
        return {
            "action": self.action,
            "path": str(self.path),
            "details": self.details,
        }
