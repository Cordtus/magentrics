# Automatic Usage Refresh Design

## Goal

Reduce the normal data-refresh workflow to one command that fetches the current personal Codex usage export, validates and transforms it for the dashboard, preserves previous data, and makes the newest successful snapshot load automatically when the dashboard opens.

## Scope

- Add a single `bun run refresh` workflow for the configured personal user.
- Store raw exports in `data/raw/` and transformed browser snapshots in `data/snapshots/`.
- Keep the existing named-user manifest model so additional users can be added manually.
- Update only the configured personal user entry during an automatic refresh.
- Make direct `file://` dashboard launch continue to work without runtime directory listing or `fetch()`.
- Make share packaging consume the latest successful snapshot without a preceding generation command.
- Preserve failure safety: failed fetches, malformed exports, validation failures, and failed publication must not move the dashboard away from its previous valid snapshot.

## User workflow

After one-time dependency installation, the normal refresh command is:

```text
bun run refresh
```

The command runs the local `ccusage codex daily --json` executable, captures its JSON output, validates it, combines it with any manually configured users, writes a new raw export and transformed snapshot, updates the manifest and latest pointer, and reports the paths of the new artifacts.

The dashboard continues to launch by opening `index.html`. It loads a stable `data/latest.js` pointer, which loads the newest transformed snapshot from `data/snapshots/`. No browser-side directory discovery is required.

## Configuration and data layout

The manifest becomes the configuration contract and lives at `data/usage-sources.json`:

```json
{
  "personalUserId": "myself",
  "users": [
    {
      "id": "myself",
      "name": "Myself",
      "file": "raw/myself-20260801T020000Z.json"
    }
  ]
}
```

`personalUserId` identifies the entry refreshed by `bun run refresh`. Other users may be added or edited manually; their files are read and included but are not fetched automatically.

The generated layout is:

```text
data/
  latest.js                         # stable browser loader, replaced atomically
  usage-sources.json                # editable/generated manifest
  raw/
    myself-<UTC timestamp>.json     # immutable ccusage exports
  snapshots/
    usage-<UTC timestamp>.js        # immutable dashboard bundles
```

Timestamp filenames use a fixed UTC representation and a collision-safe suffix policy. A successful refresh creates new files; it never replaces an older raw export or transformed snapshot. Only the small manifest and latest loader are updated to point at the new result.

## Data flow and publication

1. Read and validate the manifest, including the personal user ID and all declared user entries.
2. Execute the local ccusage command and capture standard output without shell redirection.
3. Parse and validate the personal export using the existing dashboard-core validation rules.
4. Write the personal raw export into a temporary file under `data/raw/`, then atomically publish its timestamped filename.
5. Read all manifest-declared user exports, validate them, and build the existing multi-user dashboard data shape.
6. Write the transformed snapshot into a temporary file under `data/snapshots/`, then atomically publish it.
7. Atomically update the manifest’s personal-user file reference and the `data/latest.js` loader.

If any step before publication fails, no existing manifest, pointer, or published snapshot is changed. If a later publication step fails, the prior manifest and pointer remain authoritative; newly created timestamped files may remain as recoverable artifacts but must not be selected automatically.

The generator and share builder will expose injectable command/filesystem boundaries where needed so tests can use deterministic fake ccusage output without invoking a user installation or network service.

## Browser and packaging behavior

`index.html` loads `data/latest.js` instead of a root-level generated data file. The loader resolves the current snapshot relative to itself and injects it as a classic script, preserving compatibility with direct browser opening and the existing global `window.CODEX_USAGE_DATA` contract.

The share builder resolves the latest published snapshot through the same manifest/pointer contract, copies it into the package as the package’s stable `usage-data.js`, and does not run a separate data-generation step. The package remains self-contained and omits raw source exports.

## Error handling

- A non-zero ccusage exit or invalid JSON reports a refresh failure and leaves the previous latest pointer active.
- A malformed or inconsistent user export reports which configured source failed and leaves the previous published state active.
- Missing manually configured users are errors rather than silently dropping a user from the account bundle.
- No command accepts required input/output path arguments in the normal workflow. Explicit low-level function arguments may remain for isolated tests and alternate tooling.

## Testing

Behavior-level tests will cover:

- A successful refresh invokes the configured exporter, creates one raw file and one transformed snapshot, updates the personal manifest entry, and makes the dashboard loader select that snapshot.
- A second successful refresh preserves the first raw and transformed files and advances only the latest selection.
- Manually configured additional users remain in the generated account bundle while only the personal entry changes.
- Export failure, malformed JSON, validation failure, and publication failure preserve the prior manifest/pointer and prior selected data.
- The share package uses the latest published snapshot and remains offline-loadable.

The complete Node test suite remains the required verification command.

## Decisions

- Separate raw and transformed archives under `data/raw/` and `data/snapshots/`.
- Timestamped immutable artifacts plus stable pointer/config files.
- Automatic refresh is personal-user-only by default; additional users are manual configuration.
- Preserve direct `file://` launch instead of requiring a server for latest-snapshot selection.
