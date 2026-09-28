"""Fantasy golf (PGA Tour) data plane for Strictly Jayers.

Roadmap Phase 6 — separate from ``src/ffa`` (NFL) and ESPN ``src/sj`` sync.
"""

from sg.draft import run_snake_draft
from sg.settings import DEFAULT_GOLF_SETTINGS, GolfSettings, validate_golf_settings

__all__ = [
    "DEFAULT_GOLF_SETTINGS",
    "GolfSettings",
    "run_snake_draft",
    "validate_golf_settings",
]
