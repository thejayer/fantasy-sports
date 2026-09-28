"""Hockey intelligence layer for the Strictly Jayers hub (HOCKEY-PORT.md).

Ported from Rinkside. Separate from ``ffa`` (NFL only). Everything that talks
to the NHL runs at sync time and writes JSON sidecars under
``{league}/{season}/nhl/``; the hub never calls the NHL from a request.

Stdlib + pyyaml only so the slim ``sj-sync`` / ``sj-hub`` images can import it.
"""
