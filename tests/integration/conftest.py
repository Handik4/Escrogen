"""Integration-test config: surface gltest's internal warnings to stderr so
schema-fetch / consensus failures are diagnosable."""

import logging
import sys

_h = logging.StreamHandler(sys.stderr)
_h.setFormatter(logging.Formatter("[gltest] %(levelname)s %(message)s"))
_log = logging.getLogger("gltest")
_log.setLevel(logging.WARNING)
_log.addHandler(_h)
_log.propagate = True
