"""Capture the README screenshots from a running app (`make dev`), into docs/screenshots/.

Usage: python e2e/readme_shots.py [base_url]   (or `make readme-shots`)
Screens show live data, so they change from day to day; re-run after UI changes.
"""

import sys
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5180"
OUT = Path(__file__).resolve().parents[1] / "docs" / "screenshots"


def settle(page: Page) -> None:
    expect(page.locator(".skeleton")).to_have_count(0, timeout=60_000)
    page.wait_for_timeout(1200)  # charts finish drawing


def shot(page: Page, name: str) -> None:
    page.mouse.move(1599, 999)  # no hover highlights or crosshairs
    page.screenshot(path=OUT / f"{name}.jpg", type="jpeg", quality=82)
    print("saved", name, flush=True)


def tab(page: Page, name: str) -> None:
    page.get_by_role("navigation", name="Workspaces").get_by_text(name).click()
    settle(page)


def command(page: Page, text: str) -> None:
    box = page.get_by_label("Command")
    box.click()
    box.fill(text)
    box.press("Enter")
    settle(page)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
        page.goto(BASE)
        page.evaluate("localStorage.clear()")
        page.reload()
        expect(page.get_by_text("API connected")).to_be_visible(timeout=20_000)

        for name, file in [
            ("Markets", "markets"),
            ("Equity · RACE", "equity"),
            ("Valuation · RACE", "valuation"),
            ("Options · SPY", "options"),
            ("Rates & Macro", "rates-macro"),
        ]:
            tab(page, name)
            shot(page, file)

        # Single functions, maximised in a fresh workspace.
        page.get_by_title("New workspace").click()
        for cmd, file, extra in [
            ("PORT RISK", "portfolio-risk", None),
            ("BOND 4.25 2036-08-15 P 95.5", "bond", None),
            (
                "FIND EQUITIES WHERE COUNTRY = IT AND ROE > 15% LIMIT 20",
                "screener",
                None,
            ),
            ("RACE DCF", "dcf", None),
        ]:
            command(page, cmd)
            if extra:
                page.get_by_role("button", name=extra).click()
                settle(page)
            shot(page, file)

        # The command line with suggestions open.
        box = page.get_by_label("Command")
        box.click()
        box.fill("ferr")
        page.wait_for_timeout(1500)
        page.screenshot(
            path=OUT / "command-line.jpg",
            type="jpeg",
            quality=82,
            clip={"x": 0, "y": 0, "width": 1000, "height": 260},
        )
        print("saved command-line")
        browser.close()


if __name__ == "__main__":
    main()
