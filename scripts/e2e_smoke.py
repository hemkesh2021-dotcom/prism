"""End-to-end smoke test for PRISM (sample demo, no API key needed).

Starts the backend in single-port mode (it serves frontend/dist), drives the
real UI in Chromium, and checks the acceptance workflow: preview, demo analysis,
evidence highlighting, reviewer feedback, report download, clear session, phone
layout (chart and table fit), an unreachable backend, reduced motion, missing
WebGL, and keyboard access.

Prerequisites (once):
    cd frontend && npm run build
    pip install playwright && python -m playwright install chromium

Run from the repository root:
    python scripts/e2e_smoke.py            (uses backend/.venv if present)
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
DIST = ROOT / "frontend" / "dist" / "index.html"
SHOTS = Path(os.environ.get("PRISM_E2E_SHOTS", tempfile.mkdtemp(prefix="prism-e2e-")))
# Headless browsers render in software and CI machines can be slow; allow generous time.
expect.set_options(timeout=30_000)

AGE_QUOTE = "you are too young to understand this architecture"
CUSTOM = "Notes from Monday\nPriya: Let's start.\nTomás: Ready when you are."


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def backend_server():
    if not DIST.exists():
        sys.exit("frontend/dist is missing: run `npm run build` in frontend/ first.")
    port = free_port()
    python = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    env = {**os.environ, "PRISM_SERVE_FRONTEND": "true", "ANTHROPIC_API_KEY": "", "ANTHROPIC_MODEL": ""}
    proc = subprocess.Popen(
        [str(python if python.exists() else sys.executable), "-m", "uvicorn", "prism.main:app", "--port", str(port)],
        cwd=BACKEND,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{url}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError("backend did not start")
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)


class Checks:
    def __init__(self) -> None:
        self.passed: list[str] = []

    def ok(self, name: str) -> None:
        self.passed.append(name)
        print(f"  PASS  {name}")


def no_horizontal_overflow(page: Page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def load_sample(page: Page, title: str) -> None:
    page.get_by_role("button", name="Load sample").click()
    page.get_by_role("menuitem", name=title).click()
    expect(page.get_by_role("heading", name="Preview")).to_be_visible()


def run_lens_3d(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    expect(page.locator("canvas")).to_have_count(1, timeout=20000)
    pause = page.get_by_role("button", name="Pause lens animation")
    pause.click()
    expect(page.get_by_role("button", name="Play lens animation")).to_have_attribute("aria-pressed", "true")
    page.screenshot(path=SHOTS / "desktop-lens.png")
    checks.ok("3D Conversation Lens renders in a WebGL canvas beside the editor and can be paused")


def run_desktop_flow(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    expect(page.get_by_label("Transcript text")).to_be_visible()
    checks.ok("first screen shows headline and the transcript editor without scrolling")

    # Live mode is not configured in this run: custom text cannot be analyzed, and the UI says how to enable it.
    page.get_by_label("Transcript text").fill(CUSTOM)
    page.get_by_role("button", name="Preview transcript").click()
    expect(page.get_by_text("Line 1 has text before the first speaker label")).to_be_visible()
    expect(page.get_by_role("button", name="Analyze meeting")).to_be_disabled()
    expect(page.get_by_text("Live analysis isn't set up on this server")).to_be_visible()
    checks.ok("parse error is shown in the preview and blocks analysis; live setup steps shown")

    # Upload a .txt file.
    upload = Path(tempfile.mkdtemp()) / "standup.txt"
    upload.write_text("Priya: Status?\nTomás: Endpoint is on staging: v2 ready.\nIt passed the smoke tests.\n", encoding="utf-8")
    page.locator('input[type="file"]').set_input_files(str(upload))
    expect(page.get_by_role("textbox", name="Meeting title")).to_have_value("standup")
    expect(page.get_by_text("1 line without a speaker label was added to the previous turn (line 3).")).to_be_visible()
    checks.ok("upload fills the editor, previews automatically and reports continuation lines")

    load_sample(page, "Potential age-based dismissal")
    preview = page.locator("section", has=page.get_by_role("heading", name="Preview"))
    expect(preview.get_by_text("17", exact=True)).to_be_visible()
    expect(preview.get_by_text("33.1%")).to_be_visible()
    expect(page.get_by_role("radio", name="Sample demo")).to_have_attribute("aria-checked", "true")
    checks.ok("sample preview shows 17 turns and exact word shares; demo mode selected")
    page.screenshot(path=SHOTS / "desktop-preview.png", full_page=True)

    page.get_by_role("button", name="Analyze meeting").click()
    expect(page.get_by_role("heading", name="Potential age-based dismissal", level=1)).to_be_visible()
    expect(page.get_by_text("Sample demo")).to_be_visible()
    expect(page.get_by_text("1 finding was omitted because the quotation was not found word-for-word")).to_be_visible()
    checks.ok("demo analysis completes; invalid fixture quote reported as a validation notice")

    page.get_by_role("tab", name="Language review").click()
    page.get_by_role("button", name="Potential age-based dismissal").first.click()
    mark = page.locator('[data-turn-id="T3"] mark')
    expect(mark).to_have_text(AGE_QUOTE)
    expect(page.locator('[data-turn-id="T3"]')).to_contain_text("Arun")
    checks.ok("selected finding highlights the exact quotation in Arun's turn T3")

    review = page.get_by_role("radiogroup", name="Review for F1")
    review.get_by_role("radio", name="Helpful").click()
    expect(review.get_by_role("radio", name="Helpful")).to_have_attribute("aria-checked", "true")
    review.get_by_role("radio", name="Helpful").click()
    expect(review.get_by_role("radio", name="Helpful")).to_have_attribute("aria-checked", "false")
    review.get_by_role("radio", name="Incorrect").click()
    page.get_by_label("Note (optional)").fill("Arun later states a real ledger concern")
    checks.ok("review verdicts are selectable and reversible, with a note")
    page.screenshot(path=SHOTS / "desktop-language.png", full_page=True)

    page.get_by_role("tab", name="Summary & actions").click()
    expect(page.get_by_text("Not specified").first).to_be_visible()
    page.get_by_role("button", name="Source T15, Meera").click()
    dialog = page.get_by_role("dialog")
    expect(dialog.locator("mark")).to_have_text("I'll write up the ledger check by Wednesday.")
    page.keyboard.press("Escape")
    checks.ok("summary shows 'Not specified' owners; source chips open the turn with the quote highlighted")

    page.get_by_role("button", name="Download report").click()
    with page.expect_download() as info:
        page.get_by_role("button", name="Download Markdown").click()
    report = Path(info.value.path()).read_text(encoding="utf-8")
    assert "Reviewer annotation:** Incorrect. Note: Arun later states a real ledger concern" in report, "review missing from report"
    assert "Sample demo" in report and "| Sofia | 81 | 33.1% | 5 |" in report
    assert "Appendix: full transcript" not in report
    expect(page.get_by_text("Report saved as")).to_be_visible()
    checks.ok("downloaded Markdown report matches the dashboard, keeps the review annotation, and is confirmed")

    page.get_by_role("button", name="Clear session").click()
    page.get_by_role("dialog").get_by_role("button", name="Clear session").click()
    expect(page.get_by_label("Transcript text")).to_have_value("")
    checks.ok("clear session empties the workspace")


def run_phone_flow(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    page.wait_for_timeout(800)
    assert page.locator("canvas").count() == 0, "phones should get the SVG lens, not WebGL"
    load_sample(page, "Potential age-based dismissal")
    assert no_horizontal_overflow(page), "horizontal overflow on phone input"
    page.get_by_role("button", name="Analyze meeting").click()
    expect(page.get_by_role("heading", name="Potential age-based dismissal", level=1)).to_be_visible()
    page.wait_for_timeout(1200)  # chart animation
    # The chart keeps readable bars on a phone, and the table fits without sideways scrolling.
    widths = page.evaluate(
        """() => [...document.querySelectorAll('section[aria-labelledby="participation-heading"] .recharts-bar-rectangle path')]
              .map(el => el.getBoundingClientRect().width)"""
    )
    assert len(widths) == 4 and max(widths) > 200, f"participation bars too narrow on a phone: {widths}"
    table = page.locator('section[aria-labelledby="participation-heading"] table').locator("xpath=..")
    assert table.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), "participation table scrolls sideways on a phone"
    page.get_by_role("tab", name="Language review").click()
    page.get_by_role("button", name="Potential age-based dismissal").first.click()
    page.get_by_role("button", name="View quotation in context").click()
    expect(page.locator('[data-turn-id="T3"]')).to_be_focused()
    assert no_horizontal_overflow(page), "horizontal overflow on phone results"
    page.screenshot(path=SHOTS / "phone-language.png", full_page=True)
    checks.ok("phone (390 px): readable chart bars, table fits, no overflow; 'View quotation in context' focuses the turn")


def run_backend_down(page: Page, url: str, checks: Checks) -> None:
    page.route("**/api/health", lambda route, request=None: route.abort())
    page.goto(url)
    callout = page.get_by_role("alert").filter(has_text="Can't reach the PRISM backend")
    expect(callout).to_be_in_viewport()
    expect(callout.get_by_role("button", name="Try again")).to_be_visible()
    checks.ok("backend unreachable: explained above the fold with a retry button")


def run_reduced_motion(page: Page, url: str, checks: Checks) -> None:
    page.emulate_media(reduced_motion="reduce")
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    page.wait_for_timeout(500)
    assert page.locator("canvas").count() == 0, "reduced motion must not render the 3D scene"
    assert page.evaluate("document.documentElement.dataset.motion") == "reduced"
    assert page.get_by_role("button", name="Pause lens animation").count() == 0
    checks.ok("reduced motion: static SVG lens, no animation controls needed")


def run_without_webgl(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    page.wait_for_timeout(800)
    assert page.locator("canvas").count() == 0, "fallback expected without WebGL"
    load_sample(page, "Technical disagreement")
    page.get_by_role("button", name="Analyze meeting").click()
    page.get_by_role("tab", name="Language review").click()
    expect(page.locator("main").get_by_text("No potential concerns were identified in this transcript.")).to_be_visible()
    checks.ok("no WebGL: SVG fallback, full workflow works; empty result does not certify the meeting")


def run_software_renderer(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    page.wait_for_timeout(800)
    assert page.locator("canvas").count() == 0, "software WebGL should get the SVG lens"
    checks.ok("software-only WebGL (major performance caveat): SVG lens instead of a slow 3D scene")


def run_keyboard(page: Page, url: str, checks: Checks) -> None:
    page.goto(url)
    # Wait for the app's first render; a Tab pressed before it would land on an empty page.
    expect(page.get_by_role("heading", name="See the conversation clearly.")).to_be_visible()
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Skip to content")).to_be_focused()
    seen = []
    for _ in range(12):
        page.keyboard.press("Tab")
        seen.append(page.evaluate("document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim()"))
    assert any("Load sample" in (s or "") for s in seen), seen
    page.get_by_role("button", name="Load sample").focus()
    page.keyboard.press("Enter")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="Preview")).to_be_visible()
    page.get_by_role("button", name="Analyze meeting").focus()
    page.keyboard.press("Enter")
    tab = page.get_by_role("tab", name="Overview")
    expect(tab).to_be_visible()
    tab.focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("tab", name="Language review")).to_be_focused()
    outline = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
    assert outline != "none", "focused tab needs a visible outline"
    checks.ok("keyboard: skip link, sample menu, analyze and tab arrow-key navigation with visible focus")


def guarded(flow, page: Page, url: str, checks: Checks, name: str) -> None:
    """Run one flow; on failure save a screenshot next to the others, then re-raise."""
    try:
        flow(page, url, checks)
    except Exception:
        page.screenshot(path=SHOTS / f"FAILED-{name}.png", full_page=True)
        print(f"  FAIL  {name} (screenshot: {SHOTS / f'FAILED-{name}.png'})")
        raise


def main() -> None:
    checks = Checks()
    SHOTS.mkdir(parents=True, exist_ok=True)
    with backend_server() as url, sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
        print("Desktop 1440×900")
        # Headless Chromium renders WebGL in software, which PRISM normally declines (SVG lens instead).
        # Force the 3D path for one check so the scene itself is exercised; software rendering is slow,
        # so the rest of the workflow runs with the default (fallback) behaviour.
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script("window.__PRISM_FORCE_WEBGL__ = true")
        guarded(run_lens_3d, context.new_page(), url, checks, "lens-3d")
        context.close()

        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        guarded(run_desktop_flow, context.new_page(), url, checks, "desktop")
        context.close()

        print("Phone 390×844")
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        guarded(run_phone_flow, context.new_page(), url, checks, "phone")
        context.close()

        print("Backend unreachable")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        guarded(run_backend_down, context.new_page(), url, checks, "backend-down")
        context.close()

        print("Reduced motion")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        guarded(run_reduced_motion, context.new_page(), url, checks, "reduced-motion")
        context.close()

        print("Software renderer")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        guarded(run_software_renderer, context.new_page(), url, checks, "software-renderer")
        context.close()

        print("Keyboard")
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        guarded(run_keyboard, context.new_page(), url, checks, "keyboard")
        context.close()
        browser.close()

        print("Without WebGL")
        no_gl = p.chromium.launch(args=["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
        context = no_gl.new_context(viewport={"width": 1440, "height": 900})
        guarded(run_without_webgl, context.new_page(), url, checks, "no-webgl")
        no_gl.close()

    print(f"\n{len(checks.passed)} checks passed. Screenshots: {SHOTS}")


if __name__ == "__main__":
    main()
