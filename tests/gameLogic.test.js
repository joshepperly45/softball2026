import test from "node:test";
import assert from "node:assert/strict";

import { applyPlay, buildPlayerStats, createGame } from "../src/gameLogic.js";

function createSampleGame() {
  return createGame({
    homeTeamName: "Home",
    awayTeamName: "Away",
    homeLineup: [
      { id: "h1", name: "Harper" },
      { id: "h2", name: "Jordan" },
    ],
    awayLineup: [
      { id: "a1", name: "Alex" },
      { id: "a2", name: "Blake" },
    ],
  });
}

test("single scores runner from third and moves lineup forward", () => {
  const game = createSampleGame();
  game.bases.third = { id: "a2", name: "Blake" };

  const updated = applyPlay(game, "single");

  assert.equal(updated.score.away, 1);
  assert.equal(updated.teams.away.batterIndex, 1);
  assert.equal(updated.bases.first?.name, "Alex");
  assert.equal(updated.events[0].runsScored[0].name, "Blake");
});

test("walk forces in a run with the bases loaded", () => {
  const game = createSampleGame();
  game.bases.first = { id: "a2", name: "Blake" };
  game.bases.second = { id: "a3", name: "Casey" };
  game.bases.third = { id: "a4", name: "Devin" };

  const updated = applyPlay(game, "walk");

  assert.equal(updated.score.away, 1);
  assert.equal(updated.bases.first?.name, "Alex");
  assert.equal(updated.bases.second?.name, "Blake");
  assert.equal(updated.bases.third?.name, "Casey");
});

test("walk only moves runners who are forced", () => {
  const game = createSampleGame();
  game.bases.second = { id: "a2", name: "Blake" };
  game.bases.third = { id: "a3", name: "Casey" };

  const updated = applyPlay(game, "walk");

  assert.equal(updated.score.away, 0);
  assert.equal(updated.bases.first?.name, "Alex");
  assert.equal(updated.bases.second?.name, "Blake");
  assert.equal(updated.bases.third?.name, "Casey");
});

test("three outs flips the inning and clears the bases", () => {
  let game = createSampleGame();

  game = applyPlay(game, "strikeout");
  game = applyPlay(game, "groundOut");
  game = applyPlay(game, "flyOut");

  assert.equal(game.half, "bottom");
  assert.equal(game.inning, 1);
  assert.equal(game.outs, 0);
  assert.equal(game.bases.first, null);
});

test("player stats aggregate saved game production", () => {
  let game = createSampleGame();
  game = applyPlay(game, "single");
  game = applyPlay(game, "walk");
  game = applyPlay(game, "homeRun");

  const stats = buildPlayerStats(
    [
      { id: "a1", name: "Alex", gender: "Male", positions: [] },
      { id: "a2", name: "Blake", gender: "Male", positions: [] },
    ],
    [game],
  );

  assert.equal(stats[0].name, "Alex");
  assert.equal(stats[0].hits, 2);
  assert.equal(stats[0].singles, 1);
  assert.equal(stats[0].homeRuns, 1);
  assert.equal(stats[0].avg, "1.000");
  assert.equal(stats[1].walks, 1);
});
