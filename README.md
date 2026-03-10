# FOLIO Inn-Reach Paging Slips — Browser Extension

A Chrome/Edge browser extension that generates paging slips for Inn-Reach transactions directly from the FOLIO UI. No command line, no credentials to enter — it uses your existing browser session.

<p align="center">
  <img src="icons/icon128.png" alt="Extension icon — orange rounded square with white chevron" width="128">
</p>

## Installation (Developer / Unpacked)

1. Open **Chrome** (or Edge) and navigate to `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `print_ir_paging_slips/` folder (the one containing `manifest.json`).
4. The extension icon appears in the toolbar. Pin it for easy access.

## Usage

### Generating All Slips

1. Log into FOLIO in your browser.
2. Click the extension icon in the toolbar.
3. The extension auto-detects your FOLIO session (URL, tenant, and authentication).
4. Choose to generate slips for **all** service points or filter by a code prefix (default: `m`).
5. Click **Generate All Slips**.
6. The slips open in a new tab, ready to print (`Ctrl/Cmd + P`).

### Single Slip Lookup

1. Enter a **tracking ID** or **item barcode** in the "Single Slip Lookup" field.
2. Click **Print Single Slip** (or press Enter).
3. The slip opens in a new tab.

### Multi-Tenant Support

If your browser has active sessions on multiple FOLIO tenants, a tenant switcher dropdown appears at the top of the popup. Select a tenant to switch — settings are saved and restored per tenant.

## Settings

Click **⚙ Settings** in the popup to configure:

- **FOLIO / Okapi URL** — auto-detected from the page; can be overridden manually.
- **Tenant** — auto-detected; can be overridden manually.
- **Central Server** — dropdown auto-populated from the `/inn-reach/central-servers` API. Select the server to use for fetching paging slip templates.
- **Agency Code Mappings** — JSON map of agency codes to display names (e.g. `{"ab123": "My University"}`). On first run, detected agency codes are pre-populated with empty values for you to fill in.

Settings are saved per tenant in the extension's local storage and persist across sessions.

## How It Works

- **Session detection**: On popup open, the library (`lib/folio-session.js`) injects a script into the active tab via `chrome.scripting.executeScript` to read localStorage, cookies, DOM meta tags, Stripes globals, and JWT tokens. The background service worker (`lib/folio-session-background.js`) supplements this with HttpOnly cookie scanning. If the token is in an HttpOnly cookie (modern FOLIO with RTR), `fetch` with `credentials: "include"` sends it automatically.
- **API calls**: The popup script (`popup.js`) makes direct `fetch()` calls to the FOLIO/Okapi APIs using the detected session.
- **Template rendering**: The paging slip Mustache template is fetched from the central server and rendered with a built-in Mustache engine — no external dependencies.
- **Output**: Slips are assembled into an HTML document and opened in a new tab with page-break styles for printing.

## Files

```
print_ir_paging_slips/
├── manifest.json              # Chrome Extension Manifest V3
├── popup.html                 # Extension popup UI
├── popup.js                   # Main generation logic
├── AGENTS.md                  # AI coding assistant guidelines
├── LICENSE                    # MIT license
├── generate_icons.py          # Script to regenerate icons (not part of the extension)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── lib/
│   ├── folio-session.js       # Reusable FOLIO session detection & API client
│   └── folio-session-background.js  # Background service worker for cookie detection
└── README.md                  # This file
```

## Compatibility

- Chrome 88+ / Edge 88+ (Manifest V3)
- Firefox: not directly compatible (uses `chrome.tabs` API); would need minor adaptations for `browser.*` APIs and Manifest V2.

## Distributing to Staff

For internal distribution without the Chrome Web Store:

1. Zip the `print_ir_paging_slips/` folder.
2. Share the zip with staff.
3. They unzip it, then load it as an unpacked extension (see Installation above).

Alternatively, use Chrome Enterprise policies to force-install the extension from a local `.crx` file or a self-hosted update URL.

## Acknowledgments

This extension is based on a [Python script](https://gist.github.com/btravisebsco/c708a889bd901884bfcd65fbf3222b47) and was generated primarily with GitHub Copilot using Claude Opus 4.6.

## License

MIT — see [LICENSE](LICENSE).
