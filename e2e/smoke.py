"""Browser smoke test: drive the terminal through every workspace and function.

Fails on any console error, page error or unexpected HTTP error. Needs the dev servers
running (`make dev`) and Google Chrome installed. Run with `make e2e`.
Usage: python e2e/smoke.py [base_url] [screenshot_dir]
"""

import re
import sys
from pathlib import Path

from playwright.sync_api import ConsoleMessage, Page, Response, expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5180"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None

# Expected errors: SEC answers 503 without SEC_USER_AGENT; a bank's DCF is refused with 422.
ALLOWED = ("/api/securities/filings", "/api/valuation/dcf/inputs?symbol=ISP.MI")


def shot(page: Page, name: str) -> None:
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=SHOTS / f"{name}.png")


def command(page: Page, text: str, *, new_pane: bool = False) -> None:
    print(f"→ {text}", flush=True)  # progress, so a stall shows where it happened
    box = page.get_by_label("Command")
    box.click()
    box.fill(text)
    box.press("Shift+Enter" if new_pane else "Enter")


def settle(page: Page) -> None:
    """Wait until no skeleton loaders remain (all panes have data or an error)."""
    expect(page.locator(".skeleton")).to_have_count(0, timeout=30_000)
    page.wait_for_timeout(400)


def main() -> int:
    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1600, "height": 1000})

        def on_console(message: ConsoleMessage) -> None:
            # HTTP failures are checked (with their URL) in on_response.
            if message.type == "error" and not message.text.startswith("Failed to load resource"):
                problems.append(f"console: {message.text}")

        def on_response(response: Response) -> None:
            if response.status >= 400 and not any(a in response.url for a in ALLOWED):
                problems.append(f"HTTP {response.status} {response.url}")

        page.on("console", on_console)
        page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
        page.on("response", on_response)

        page.goto(BASE)
        page.evaluate("localStorage.clear()")
        page.reload()
        expect(page.get_by_text("API connected")).to_be_visible(timeout=15_000)

        # Each default workspace loads without errors.
        workspaces = [
            "Markets",
            "Equity · RACE",
            "Rates & Macro",
            "Watchlist",
            "Valuation · RACE",
            "Options · SPY",
            "Portfolio",
        ]
        for i, name in enumerate(workspaces):
            page.get_by_role("navigation", name="Workspaces").get_by_text(name).click()
            settle(page)
            shot(page, f"{i + 1}-{name.split(' ')[0].lower()}")

        # Linked panes follow a security typed into one of them.
        page.get_by_role("navigation", name="Workspaces").get_by_text("Equity · RACE").click()
        settle(page)
        command(page, "ASML")
        expect(
            page.locator("header", has_text="DES").get_by_text("ASML", exact=True)
        ).to_be_visible()
        expect(
            page.locator("header", has_text="GP").get_by_text("ASML", exact=True)
        ).to_be_visible()
        settle(page)

        # Every remaining function opens in a new pane of a fresh workspace.
        page.get_by_title("New workspace").click()
        for cmd in [
            "AAPL HP",
            "AAPL FA RATIOS",
            "AAPL FIL",
            "AAPL DVD",
            "NVDA ERN",
            "MOST LOSERS",
            "MSFT DCF",
            "AAPL OMON",
            "AAPL IVOL",
            "BOND 4.25 2036-08-15 P 95.5",
            "HELP",
        ]:
            command(page, cmd)
            settle(page)
            shot(page, "fn-" + cmd.replace(" ", "-").lower())
        command(page, "ECO US.CPI")
        settle(page)
        shot(page, "fn-eco-series")

        # BOND: switching the quote to yield keeps the analysis consistent; YC shows zero curves.
        command(page, "BOND 4.25 2036-08-15 P 95.5")
        settle(page)
        page.get_by_role("button", name="Yield", exact=True).click()
        expect(page.get_by_label("Yield to maturity")).to_have_value(re.compile(r"^4\.8\d+$"))
        command(page, "YC US")
        page.get_by_role("button", name="Zero & fwd").click()
        settle(page)

        # EQS straight from the command line, with the blueprint's grammar.
        command(page, "FIND EQUITIES WHERE COUNTRY = IT AND ROE > 15% LIMIT 10")
        settle(page)
        expect(page.get_by_text(re.compile(r"[\d,]+ matches · showing \d+"))).to_be_visible()
        shot(page, "fn-eqs")

        # CSV export downloads the visible table.
        with page.expect_download() as dl:
            page.get_by_title("Export tables as CSV").first.click()
        assert dl.value.suggested_filename.startswith("EQS"), dl.value.suggested_filename

        # An alert below the current price triggers on the next quote check.
        command(page, "ALRT ADD AAPL > 1")
        expect(page.get_by_text("AAPL rose above 1.000")).to_be_visible(timeout=20_000)
        expect(page.get_by_text("Triggered", exact=False).first).to_be_visible()

        # Pop-out: the pane opens alone in its own window.
        with page.context.expect_page() as popup_info:
            page.get_by_title("Pop out into its own window (for a second monitor)").first.click()
        popup = popup_info.value
        expect(popup.get_by_text("Pop-out window")).to_be_visible(timeout=15_000)
        popup.close()

        # Share links: a ?ws= URL adds the encoded workspace as a new tab.
        link = page.evaluate(
            """() => {
              const ws = {name: 'Shared test', panes: [{fn: 'DES', security: 'MSFT', params: {}, link: null}]}
              const bytes = new TextEncoder().encode(JSON.stringify(ws))
              let bin = ''; for (const b of bytes) bin += String.fromCharCode(b)
              return location.pathname + '?ws=' + btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
            }"""
        )
        page.goto(BASE + link)
        expect(
            page.get_by_role("navigation", name="Workspaces").get_by_text("Shared test")
        ).to_be_visible()
        settle(page)

        # PORT: editing the holdings re-runs the analysis on the new portfolio.
        command(page, "PORT RISK")
        settle(page)
        page.get_by_role("button", name="Edit", exact=True).click()
        page.get_by_label("Holdings").fill("AAPL 10\nMSFT 10\nGLD 5")
        page.get_by_role("button", name="Apply (3)").click()
        expect(page.get_by_text("3 holdings")).to_be_visible()
        settle(page)
        expect(page.get_by_text("monte carlo", exact=True)).to_be_visible()  # CSS capitalises it

        # OMON: switching to the Greeks view shows delta columns.
        command(page, "SPY OMON")
        settle(page)
        page.get_by_role("button", name="Greeks").click()
        expect(
            page.get_by_title("Delta: option value change per 1 unit of the underlying").first
        ).to_be_visible()

        # DCF: editing an assumption recomputes the valuation; banks are refused with a reason.
        command(page, "RACE DCF")
        settle(page)
        value = page.locator("text=Intrinsic value / share").locator("..").inner_text()
        box = page.get_by_label("Terminal growth")
        box.fill("3.5")
        box.press("Enter")
        expect(page.locator("text=Intrinsic value / share").locator("..")).not_to_have_text(
            value, timeout=15_000
        )
        shot(page, "fn-race-dcf-edited")
        command(page, "ISP.MI DCF")
        expect(page.get_by_text("Not applicable")).to_be_visible(timeout=20_000)

        # Name search resolves to a ticker; errors are shown inline.
        command(page, "ferrari")
        expect(page.locator("header").get_by_text("RACE", exact=True).first).to_be_visible(
            timeout=15_000
        )
        command(page, "RACE YC")
        expect(page.get_by_text("YC does not take a security")).to_be_visible()

        # Keyboard: maximise and restore.
        page.keyboard.press("Escape")
        page.locator("body").click(position={"x": 5, "y": 5})
        page.keyboard.press("Alt+KeyM")
        expect(page.get_by_title("Restore (Alt M)")).to_be_visible()
        page.keyboard.press("Alt+KeyM")

        browser.close()

    for problem in problems:
        print("FAIL", problem)
    print("smoke test", "failed" if problems else "passed")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
