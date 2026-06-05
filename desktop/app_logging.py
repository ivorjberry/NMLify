"""Centralized logging setup for CrateHacker.

The app uses module-level loggers (``logging.getLogger(__name__)``) so logs
identify their source. End users can opt into verbose logs without rebuilding
by setting ``CRATEHACKER_LOG_LEVEL=DEBUG`` (or any standard level name) in
their environment or ``.env`` file.

`configure_logging()` is idempotent — calling it more than once is a no-op,
so importing this module from tests or scripts won't double-attach handlers.
"""
import logging
import os

_DEFAULT_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_DEFAULT_DATEFMT = "%H:%M:%S"
_CONFIGURED = False


def configure_logging(level=None):
    """Attach a stream handler to the root logger once.

    Args:
        level: Optional explicit log level (``int`` or level name). When None,
            reads ``CRATEHACKER_LOG_LEVEL`` from the environment, falling back
            to ``INFO``.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    if level is None:
        level = os.getenv("CRATEHACKER_LOG_LEVEL", "INFO").upper()
    if isinstance(level, str):
        level = logging.getLevelName(level)
        if not isinstance(level, int):
            level = logging.INFO

    logging.basicConfig(level=level, format=_DEFAULT_FORMAT, datefmt=_DEFAULT_DATEFMT)
    _CONFIGURED = True


def get_logger(name):
    """Return a module logger. Convenience wrapper around ``logging.getLogger``."""
    return logging.getLogger(name)
