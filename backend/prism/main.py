"""FastAPI application.

Endpoints (all stateless — nothing is stored between requests):

* GET  /api/health   service status, limits, live-mode availability
* GET  /api/samples  bundled sample transcripts
* POST /api/parse    parsing + deterministic participation metrics
* POST /api/analyze  re-parse, model analysis (live) or fixture (demo), evidence validation

Run with:  uvicorn prism.main:app --reload --port 8000   (from the backend/ folder)
"""

from __future__ import annotations

import logging
import time
import traceback
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .analysis import run_live_analysis
from .config import BACKEND_DIR, FRONTEND_DIST, SAMPLES_DIR, Settings, load_settings
from .errors import PrismError
from .parsing import GRAMMAR_VERSION, canonicalize, check_transcript_input, parse_transcript
from .prompts import load_prompt
from .provider import AnalysisProvider, AnthropicProvider
from .samples import SampleCatalog
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    HealthResponse,
    Limits,
    LiveStatus,
    ParseRequest,
    ParseResult,
    SampleInfo,
)
from .validation import validate_analysis

logger = logging.getLogger("prism")


def _error_response(code: str, message: str, status: int, retry_after: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "retry_after_seconds": retry_after}},
        headers=headers,
    )


class BodySizeLimitMiddleware:
    """Reject request bodies above a fixed size before FastAPI parses them.

    The body is read here (it is small by design) so an oversized upload, with or
    without a Content-Length header, gets a clean 413 instead of a parsing error.
    """

    def __init__(self, app, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        too_large = _error_response("request_too_large", "The request body is larger than the server accepts.", 413)
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await too_large(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await too_large(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def _build_provider(settings: Settings) -> AnalysisProvider | None:
    if not settings.live_available:
        return None
    return AnthropicProvider(
        api_key=settings.anthropic_api_key or "",
        model=settings.anthropic_model or "",
        effort=settings.anthropic_effort,
        timeout_seconds=settings.model_timeout_seconds,
        max_output_tokens=settings.max_output_tokens,
    )


def create_app(
    settings: Settings | None = None,
    provider: AnalysisProvider | None = None,
    catalog: SampleCatalog | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    provider = provider if provider is not None else _build_provider(settings)
    catalog = catalog or SampleCatalog.load(SAMPLES_DIR)
    prompt = load_prompt()

    app = FastAPI(
        title="PRISM API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)

    # ---- error handling ---------------------------------------------------- #

    @app.exception_handler(PrismError)
    async def handle_prism_error(_request: Request, exc: PrismError) -> JSONResponse:
        return _error_response(exc.code, exc.message, exc.status, exc.retry_after)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Report field locations only; the default handler would echo the request body back.
        fields = sorted({".".join(str(part) for part in err.get("loc", ()) if part != "body") for err in exc.errors()})
        return _error_response("invalid_request", f"The request was not valid ({', '.join(fields) or 'body'}).", 422)

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        # Log the exception type and stack frames only — never messages, which could contain content.
        logger.error("unhandled %s\n%s", type(exc).__name__, "".join(traceback.format_tb(exc.__traceback__)))
        return _error_response("internal_error", "Unexpected server error. Your transcript was not stored.", 500)

    # ---- routes ------------------------------------------------------------ #

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            app_version=__version__,
            prompt_version=prompt.version,
            grammar_version=GRAMMAR_VERSION,
            live=LiveStatus(
                available=provider is not None,
                model=settings.anthropic_model if provider is not None else None,
                effort=settings.anthropic_effort if provider is not None else None,
                missing=settings.missing_live_settings if provider is None else [],
            ),
            limits=Limits(max_transcript_chars=settings.max_transcript_chars, max_upload_bytes=settings.max_upload_bytes),
            request_timeout_seconds=settings.client_timeout_seconds,
        )

    @app.get("/api/samples", response_model=list[SampleInfo])
    def samples() -> list[SampleInfo]:
        return catalog.list()

    @app.post("/api/parse", response_model=ParseResult)
    def parse(body: ParseRequest) -> ParseResult:
        canonical = canonicalize(body.transcript)
        check_transcript_input(canonical, settings)
        return parse_transcript(canonical)

    @app.post("/api/analyze", response_model=AnalyzeResponse)
    def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
        started = time.monotonic()
        canonical = canonicalize(body.transcript)
        check_transcript_input(canonical, settings)
        parsed = parse_transcript(canonical)
        if not parsed.ok:
            raise PrismError(
                "parse_failed",
                "The transcript has formatting errors. Fix the problems listed in the preview, then analyze again.",
                status=422,
            )

        if body.mode == "demo":
            sample, output = catalog.demo_output(body.sample_id, canonical)
            sample_id, model_name, attempts = sample.sample_id, None, 0
        else:
            if provider is None:
                missing = " and ".join(settings.missing_live_settings) or "provider settings"
                raise PrismError(
                    "live_not_configured",
                    f"Live analysis is not configured: set {missing} in backend/.env and restart the backend. "
                    "Sample demo works without a key.",
                    status=503,
                )
            live = run_live_analysis(parsed, provider, timeout_seconds=settings.model_timeout_seconds)
            output, attempts = live.output, live.attempts
            sample_id, model_name = None, provider.model

        content, notices = validate_analysis(output, parsed)
        logger.info(
            "analyze mode=%s turns=%d chars=%d attempts=%d findings_returned=%d findings_verified=%d notices=%d duration_ms=%d",
            body.mode,
            parsed.total_turns,
            parsed.char_count,
            attempts,
            len(output.findings),
            len(content.findings),
            len(notices),
            int((time.monotonic() - started) * 1000),
        )
        return AnalyzeResponse(
            analysis_id=body.analysis_id,
            mode=body.mode,
            sample_id=sample_id,
            model=model_name,
            prompt_version=prompt.version,
            generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            transcript_hash=parsed.transcript_hash,
            attempts=attempts,
            findings_returned=len(output.findings),
            parse=parsed,
            analysis=content,
            notices=notices,
        )

    # ---- built frontend (optional single-port mode) ------------------------- #
    if settings.serve_frontend and (FRONTEND_DIST / "index.html").exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


load_dotenv(BACKEND_DIR / ".env", override=False)
_configure_logging()
app = create_app()
