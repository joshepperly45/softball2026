# SwanVegas Softball Tracker

A hostable coed ASA softball roster and scorekeeping site built as a lightweight static web app.

## Features

- Save a reusable roster with names, gender, and preferred positions
- Build a daily lineup from the saved roster with ASA batting-slot and fielding validation
- Track a game batter by batter with softball/baseball scoring shortcuts, automatic RBI support, and extra baserunner outs
- Record partner substitutions, current hitter and outs adjustments, and opponent half innings
- Save each finished game both to browser storage and as its own local JSON file
- Review saved player stats such as GP, AVG, OBP, SLG, OPS, RBI, and runs scored
- Reopen completed games in a saved-game viewer for score and event-log review
- Import old single-game JSON files into the stats view when they are not already loaded on this device
- Export and import a full JSON backup of roster data, saved game logs, and derived stats snapshots

## Running locally

Start the built-in static server:

```bash
npm run serve
```

Then browse to `http://localhost:4173`.

If that port is busy, the built-in server automatically tries the next available ports.

You can also use any other static web server, for example:

```bash
python3 -m http.server 4173
```

Then browse to `http://localhost:4173`.

## Hosting on GitHub Pages

This app is a plain static site, so GitHub Pages is the easiest way to host it.

1. Merge this branch to `main`, or copy the workflow in `.github/workflows/deploy-pages.yml` onto whatever branch deploys to `main`.
2. In GitHub, open the repository settings.
3. Go to `Settings > Pages`.
4. Enable GitHub Pages for the repository if it is not already enabled.
5. Under `Build and deployment`, choose `GitHub Actions` as the source.
6. Push to `main`.
7. Wait for the `Deploy GitHub Pages` workflow to finish.
8. Open the Pages URL GitHub shows you, usually `https://joshepperly45.github.io/softball2026/`.

Notes:

- The workflow can deploy the site, but GitHub may require the Pages feature itself to be turned on once manually in repo settings first.
- Because the app uses browser local storage, saved games and roster data stay in the browser/device you use on the Pages site.
- If you switch devices, use the app's per-game JSON files or full backup export/import to move data.
- Once Pages is enabled, you do not need to run `npm run serve` from your PC to use the site.

## Supabase cloud sync

This app can now sync roster data, lineup drafts, saved games, and the active game to Supabase while still keeping a browser-local backup.

### How auth works

- The browser uses your Supabase project URL plus the public anon key from `src/supabaseConfig.js`.
- No person has to manually log in. The app talks directly to one shared `app_state` row using the public anon key.
- The database is intentionally shared across all visitors to the site, so every browser reads and writes the same roster, lineup, and game data.
- Row Level Security limits writes to the shared `bucket = 'shared'` row used by this app.
- The Supabase service role key is not used here and should never be shipped to the browser. That key is only for trusted server code.

### Setup

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql` in the Supabase SQL editor.
3. If you previously set up the anonymous-per-user version, run `supabase/migrate-to-shared.sql` instead so the table is rebuilt for shared access.
4. Copy `src/supabaseConfig.js` and fill in your project URL and anon key.
5. Start the app with `npm run serve` or deploy it as a static site.

Notes:

- This is a public-write design. Anyone who can load the site can change the shared data.
- Because the app also keeps browser-local state, your current device can repopulate the shared row after you run the shared migration.
- Browser storage remains in place as an offline fallback and backup cache.

## Tests

```bash
npm test
```
