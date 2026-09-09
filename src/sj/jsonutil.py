"""Strict JSON writers for Strictly Jayers snapshot files.

Python's ``json.dumps`` emits the non-standard tokens ``Infinity``,
``-Infinity``, and ``NaN`` unless ``allow_nan=False``. Those tokens are not
valid JSON and crash the hub (``CorruptSnapshotError``) — production digest
700373770 was ``free_agents.json`` with ``"ERA": Infinity`` from a 0-IP
pitcher rate. Convert non-finite floats to ``null`` before writing.
"""

from __future__ import annotations

import json
import math
from typing import Any


def is_nonfinite_number(value: Any) -> bool:
    """True when ``value`` parses as NaN or ±Infinity."""
    if isinstance(value, bool) or value is None:
        return False
    try:
        num = float(value)
    except (TypeError, ValueError):
        return False
    return math.isnan(num) or math.isinf(num)


def sanitize_nonfinite(value: Any) -> Any:
    """Replace non-finite floats with ``None``; recurse into dicts/lists."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {key: sanitize_nonfinite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_nonfinite(item) for item in value]
    return value


def dumps_snapshot(payload: Any) -> str:
    """Serialize a snapshot document as standard JSON.

    Formatting matches the historical store/fixture writers: ``indent=2``,
    ``sort_keys=True``, trailing newline. ``allow_nan=False`` fails closed if
    a non-finite float slips past :func:`sanitize_nonfinite`.
    """
    return (
        json.dumps(
            sanitize_nonfinite(payload),
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    )
