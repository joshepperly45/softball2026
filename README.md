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
4. Under `Build and deployment`, choose `GitHub Actions` as the source.
5. Push to `main`.
6. Wait for the `Deploy GitHub Pages` workflow to finish.
7. Open the Pages URL GitHub shows you, usually `https://joshepperly45.github.io/softball2026/`.

Notes:

- Because the app uses browser local storage, saved games and roster data stay in the browser/device you use on the Pages site.
- If you switch devices, use the app's per-game JSON files or full backup export/import to move data.
- Once Pages is enabled, you do not need to run `npm run serve` from your PC to use the site.

## Tests

```bash
npm test
```
