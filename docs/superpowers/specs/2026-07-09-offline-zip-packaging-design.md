# Offline ZIP Packaging Design

## Context

The dashboard currently works when `index.html` is opened directly, shows the generated snapshot of the owner's Codex usage, and accepts another ccusage JSON file through selection or drag-and-drop. Its charts still load Chart.js and the date adapter from jsDelivr, so the current folder is not fully offline.

The intended recipient is comfortable with Node.js and Bun. A multi-file archive is therefore preferable to a generated single HTML file: it preserves the modular source shape, is easy to inspect, and remains simple to launch.

The KDE icon-theme warnings printed by `xdg-open` are desktop-environment warnings rather than dashboard failures. Packaging does not need to work around them.

## Goals

- Produce one ZIP archive that can be sent directly to another person.
- Make the extracted dashboard fully functional without internet access.
- Show the owner's current usage snapshot by default.
- Preserve file selection and drag-and-drop so the recipient can inspect their own ccusage Codex daily JSON.
- Keep the repository's normal dashboard modular rather than generating a monolithic HTML source file.
- Make repeated package builds safe, explicit, and verifiable.

## Non-goals

- Publish the dashboard to a public URL.
- Build an Electron, Tauri, or other desktop executable.
- Add a framework, package manager dependency, or live-update service.
- Persist a recipient's selected JSON after reload.
- Include project tests, Codex/Serena settings, design documents, or the raw `codex-usage.json` in the recipient archive.

## Runtime dependency changes

Pinned browser distributions will be stored locally:

- `vendor/chart.umd.min.js` for Chart.js 4.4.7.
- `vendor/chartjs-adapter-date-fns.bundle.min.js` for chartjs-adapter-date-fns 3.0.0.
- `vendor/THIRD_PARTY_LICENSES.md` containing dependency names, versions, upstream locations, and license notices.

The main `index.html` will reference these local files instead of CDN URLs. The repository dashboard and the shared copy will therefore use the same offline runtime path.

The shared copy will also use the repository dashboard's concise interface text. Detailed explanations of token accounting, sparse dates, and source-data limitations belong in documentation rather than repeated helper paragraphs in the UI.

## Package contents

The generated folder and ZIP will contain exactly this runtime payload:

```text
codex-usage-dashboard/
  README.md
  index.html
  dashboard.js
  dashboard-core.js
  usage-data.js
  serve.mjs
  vendor/
    chart.umd.min.js
    chartjs-adapter-date-fns.bundle.min.js
    THIRD_PARTY_LICENSES.md
```

`usage-data.js` contains the same usage metrics and model information as the owner's raw JSON in a browser-loadable form. Omitting `codex-usage.json` reduces duplicate files; it does not anonymize the shared snapshot. The recipient README will state this explicitly.

## Recipient workflow

The primary workflow is:

1. Extract `codex-usage-dashboard.zip`.
2. Open `codex-usage-dashboard/index.html`.
3. View the owner's snapshot immediately.
4. Use **Load JSON** or drag in another `ccusage codex daily -j` export.
5. Reload the page to return to the owner's snapshot.

If a browser or local policy restricts `file://`, the recipient can run:

```bash
node serve.mjs
```

The included server prints its loopback URL. It has no external dependencies, serves only the extracted package directory, supports `GET` and `HEAD`, rejects traversal, and binds to `127.0.0.1` rather than the LAN.

## Build command and outputs

`scripts/build-share.mjs` will produce:

```text
dist/codex-usage-dashboard/
dist/codex-usage-dashboard.zip
```

The build flow is:

1. Validate `codex-usage.json` with `dashboard-core.js`.
2. Regenerate `usage-data.js` through the existing snapshot generator.
3. Verify every required source and vendored dependency exists.
4. Build a temporary staging folder containing only the declared runtime payload.
5. Write the recipient README and copy the runtime files.
6. Replace the generated folder only after staging succeeds.
7. Create a temporary ZIP with the system `zip` command and atomically replace the final archive.
8. Print the folder path, ZIP path, archive size, and SHA-256 digest.

The builder will fail clearly if `zip` is unavailable, source data is invalid, a required file is missing, an external script reference remains, or archive creation fails. A failed build must not replace the last successful ZIP.

## Server behavior

`serve.mjs` will:

- default to port 8765 and accept an optional numeric port argument;
- allow port `0` for test-selected ephemeral ports;
- print the exact `http://127.0.0.1:<port>/` URL after listening;
- map `/` to `index.html`;
- serve only files below its own directory;
- return appropriate content types for HTML, JavaScript, Markdown, and common static assets;
- support `GET` and `HEAD` only;
- return 404 for missing files and 405 for unsupported methods; and
- shut down normally on process termination.

It will not open a browser, expose a LAN listener, list directories, or read files outside the extracted package.

## Documentation

The repository `README.md` will add:

- the offline local-runtime behavior;
- the package build command;
- output paths;
- the exact recipient workflow;
- the privacy note about the embedded snapshot;
- the optional `node serve.mjs` fallback; and
- how to refresh the owner's snapshot before rebuilding.

The archive's shorter `README.md` will focus only on opening the dashboard, loading another JSON file, using the optional local server, returning to the bundled snapshot, offline behavior, and the embedded-data privacy note.

## Testing strategy

The test basis is this packaging contract and the existing dashboard behavior.

### Build integration tests

Using temporary output paths where practical, verify:

- invalid source data cannot replace an existing package;
- missing runtime or vendor files produce diagnostic failures;
- the generated folder contains the exact payload and no project-only files;
- the ZIP contains one top-level `codex-usage-dashboard/` directory with the exact payload;
- `usage-data.js` in the package matches `codex-usage.json` semantically;
- packaged `index.html` has no external script URLs; and
- a failed ZIP command preserves the previous archive.

### Server integration tests

Start the real packaged `serve.mjs` on port `0` and verify:

- `/` serves the dashboard;
- JavaScript and vendor assets are served with usable content types;
- `HEAD` returns headers without a body;
- traversal and missing paths cannot escape the package;
- unsupported methods return 405; and
- the process exits cleanly.

### Browser verification

Against the extracted package, verify:

- direct `file://` startup with network access blocked;
- all three charts render from local vendor files;
- the bundled snapshot matches the owner's current totals;
- the picker and drag-and-drop load a replacement JSON;
- invalid JSON preserves the last valid display;
- reload restores the bundled snapshot;
- the Node server path renders the same dashboard; and
- representative desktop and mobile layouts remain intact.

## Acceptance criteria

- `node scripts/build-share.mjs` produces the folder and ZIP under `dist/`.
- The ZIP extracts to one self-contained `codex-usage-dashboard/` directory.
- Opening the extracted `index.html` offline shows the owner's snapshot and all charts.
- Loading a valid recipient JSON replaces the displayed data for that page session.
- Reloading restores the owner's bundled snapshot.
- No packaged runtime file requires a network request.
- The optional loopback server works with installed Node.js and no dependency installation.
- Build, server, dashboard, archive, and browser checks pass.
