# Project Guidelines

## Overview

This is a Chrome MV3 browser extension that generates Inn-Reach paging slips from FOLIO (open-source library services platform). It detects the user's active FOLIO session and calls FOLIO APIs to fetch transactions, items, and paging slip templates.

Based on a [Python script](https://gist.github.com/btravisebsco/c708a889bd901884bfcd65fbf3222b47), ported to a browser extension with GitHub Copilot (Claude Opus 4.6).

## Architecture

- **`popup.html` / `popup.js`** — Extension popup UI and main slip generation logic. Entry point for all user interaction.
- **`lib/folio-session.js`** — Reusable FOLIO session detection library (page-context injection, cookie scanning, JWT parsing, multi-tenant config storage, API client). Loaded by popup.html before popup.js. Exposes a global `FolioSession` object.
- **`lib/folio-session-background.js`** — Background service worker. Handles HttpOnly cookie detection via `chrome.cookies` API. Registered as `service_worker` in manifest.json.

## Code Style

- Plain ES5-compatible JavaScript with `var` declarations (no ES modules, no build step, no transpiler).
- IIFEs for scope isolation — both `popup.js` and library files wrap in `(function () { "use strict"; ... })()`.
- No external dependencies — Mustache rendering is implemented inline in `popup.js`.
- Use `chrome.*` APIs directly (not `browser.*`). This is a Chrome/Edge MV3 extension.

## Conventions

- **Session detection** is always done via `FolioSession.detect()` which combines page-context injection (`chrome.scripting.executeScript`) and background cookie scanning. Never read session data directly from content scripts.
- **API calls** go through `FolioSession.folioGet()`, `folioGetAll()`, and `folioGetCQL()` — these handle cookie-based auth (`credentials: "include"`), pagination, and CQL queries.
- **Per-tenant settings** are stored via `FolioSession.saveTenantProfile()` / `loadTenantProfile()` in `chrome.storage.local`, keyed by tenant ID.
- **Permissions**: `activeTab`, `storage`, `scripting`, `cookies` with `*://*/*` host permissions. Do not add unnecessary permissions.

## FOLIO Domain Context

- **Inn-Reach** is an interlibrary loan system. Transactions have types (ITEM, PATRON) and states (ITEM_HOLD, TRANSFER, FINAL_CHECKIN, etc.).
- **Paging slips** are printed documents staff use to locate and retrieve physical items from shelves.
- **Service points** are physical library locations. Slips can be filtered by service point code prefix.
- **Central server** manages Inn-Reach connections between libraries. The paging slip Mustache template is fetched from the central server config in FOLIO.
- **Agency codes** map to participating libraries and are displayed on slips.
- Key FOLIO API endpoints used: `/service-points`, `/locations`, `/inn-reach/transactions`, `/inn-reach/central-servers`, `/inventory/items`, `/request-storage/requests`.

## Build and Test

No build step. To install:
1. Go to `chrome://extensions/`, enable Developer mode.
2. Click "Load unpacked" and select this folder.

To test changes, reload the extension from `chrome://extensions/` after editing files.

## Files to Preserve

- `lib/folio-session.js` and `lib/folio-session-background.js` are designed as a **reusable library** for any FOLIO Chrome extension. Changes should remain generic and not couple to paging-slip-specific logic.
- `generate_icons.py` is a standalone icon generator and is not part of the runtime extension.
