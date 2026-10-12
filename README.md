# Freight Returns BOL Portal (portfolio edition)

An internal web app that turns a customer freight return into print-ready shipping documents in about two minutes. A customer-support rep types an RMA number. The portal pulls the order from the ERP, suggests the pallets, gets a live LTL rate quote, creates the carrier BOL, schedules the pickup, and saves the tracking numbers back to the ERP.

> **Portfolio edition.** I built this for a fitness-equipment company's support team. The company name, addresses, logo, products and internal hosting details are replaced here with generic placeholders ("Acme Fitness", example.com). All ERP and carrier data runs in **mock mode**, so the app works end to end with no credentials.

## The problem
Support reps created freight-return paperwork in a legacy shipping tool. It allowed one user at a time, needed lots of manual entry, and intimidated new hires. Pickups were then booked separately on the carrier's website. Freight returns are infrequent, so reps never built muscle memory, and errors on BOLs and quotes were common.

## What it does
- **RMA lookup:** customer, address, residential flag, sales order and returning items, all prefilled.
- **Smart pallet guess:** item names map to the usual container (crate, 73" or 96" pallet), with a "why this size" note. Optionally, drop the *original* BOL or packing list PDF; it's parsed for exact sizes and which items were on each container.
- **Freight class from density:** NMFC sub and class are suggested from a density table. A **live to-scale 3D view** (three.js) of the pallets inside a 53′ trailer makes typos like 480″ instead of 48″ obvious.
- **Live carrier quote:** the amount to deduct from the refund is shown prominently. Any change after quoting forces a new quote, so the BOL always matches the charge.
- **Guardrails:** business rules for pickup dates (2 business days' notice, weekdays, a fixed 1–5 PM window, 1–3 customer dates), required-field checks, and a review checklist.
- **No duplicates, ever:** idempotency keys plus an atomic per-RMA lock. A double-click, retry or second rep can't create a second BOL or pickup. If the carrier times out (state unknown), retry is blocked instead of guessed.
- **Step-by-step recovery:** BOL, then pickup, then ERP write-back. If a later step fails, the BOL is kept and only that step is retried.
- **Documents:** BOL, packing list, and 4x6 or letter labels with scannable Code 39 barcodes, plus a one-click bundle.
- **History:** search, reprint, and **Duplicate & edit** (voids the original, cancels the pickup via API, and reopens the form prefilled).
- **UX:** name-first welcome screen, a sticky "road" progress rail with a truck that drives to the current step, dark mode, reduced-motion support, and mobile layouts.

## Tech
- **Frontend:** React and Vite. three.js is lazy-loaded (only when the pallet step opens), with an SVG fallback.
- **Backend:** a small Node 22 HTTP server; API handlers are plain `(Request) => Response` functions.
- **Storage:** SQLite (built-in `node:sqlite`). Atomic `INSERT OR IGNORE` locks make duplicate prevention hold across reps.
- **Integrations:**
  - carrier REST API: rate quote, BOL, pickup and cancel, mapped from the carrier's Swagger;
  - ERP REST and SuiteQL with OAuth 1.0a token auth;
  - both behind adapters with full mock modes.
- **PDFs:** pdf-lib for documents, bwip-js for barcodes, and pdf.js for reading uploaded PDFs (eval disabled; untrusted input).
- **Ops:** a single Docker container (non-root, health check, SQLite volume), designed to sit behind an internal SSO hub (trusted-user header, `frame-ancestors` CSP). Secrets only come from the environment.
- **Tests:** 36 automated scenarios with Node's test runner, including the double-click race, carrier timeouts, write-back failures, voids, barcode decoding and the PDF parser.

## Run it
```bash
npm install
npm test
npm run local          # http://localhost:8080
```
Or with Docker:
```bash
cp .env.example .env
docker compose up -d --build
```
Try RMAs `RMA100001`–`RMA100004`, or `RMA999999` to see the not-found message.

## Layout
- `src/`: UI (React).
- `api/`: endpoints.
- `server/`: HTTP server.
- `lib/`: business logic, carrier and ERP adapters, storage, PDF generation and parsing.
- `tests/`: the test scenarios.
