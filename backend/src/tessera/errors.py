class TesseraError(Exception):
    """Base class for errors the API turns into clean HTTP responses."""


class NotFoundError(TesseraError):
    """The provider has no data for this identifier (unknown ticker, unsupported series…)."""


class UpstreamError(TesseraError):
    """The provider could not be reached or returned something we could not parse."""


class ConfigurationError(TesseraError):
    """A provider needs configuration (e.g. a contact User-Agent) that is missing."""
