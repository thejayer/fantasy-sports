"""Fantasy golf (PGA Tour) data plane for Strictly Jayers.

Roadmap Phase 6 — separate from ``src/ffa`` (NFL) and ESPN ``src/sj`` sync.
"""

from sg.settings import DEFAULT_GOLF_SETTINGS, GolfSettings, validate_golf_settings

__all__ = [
    "DEFAULT_GOLF_SETTINGS",
    "GolfSettings",
    "validate_golf_settings",
]
