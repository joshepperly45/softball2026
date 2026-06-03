import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustGameState,
  buildPlayerStats,
  createGame,
  getCurrentBatter,
  isTeamAtBat,
  recordOpponentHalf,
  recordPlay,
  substitutePlayer,
  undoLastEvent,
  updateEvent,
  validateLineup,
} from "../src/gameLogic.js";

function createRosterPlayer(id, name, gender) {
  return { id, name, gender, positions: [] };
}

function createValidTenPlayerLineup() {
  return [
    { player: createRosterPlayer("m1", "Adam", "Male"), position: "P" },
    { player: createRosterPlayer("m2", "Ben", "Male"), position: "C" },
    { player: createRosterPlayer("f1", "Cara", "Female"), position: "LF" },
    { player: createRosterPlayer("m3", "Drew", "Male"), position: "1B" },
    { player: createRosterPlayer("m4", "Eli", "Male"), position: "2B" },
    { player: createRosterPlayer("f2", "Faye", "Female"), position: "SS" },
    { player: createRosterPlayer("m5", "Gabe", "Male"), position: "3B" },
    { player: createRosterPlayer("m6", "Hank", "Male"), position: "LCF" },
    { player: createRosterPlayer("f3", "Ivy", "Female"), position: "RF" },
    { player: createRosterPlayer("m7", "Jace", "Male"), position: "RCF" },
  ];
}

test("validateLineup accepts a legal 10-player ASA lineup", () => {
  const validation = validateLineup(createValidTenPlayerLineup());

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("validateLineup rejects female players outside ASA batting slots", () => {
  const lineup = createValidTenPlayerLineup();
  lineup[0] = { ...lineup[0], player: createRosterPlayer("f4", "Kira", "Female") };

  const validation = validateLineup(lineup);

  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /only allowed in slots 3, 6, 9/i);
});

test("recordPlay counts reach on error as a hit and adds manual RBI", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "triple", rbi: 0 });
  game = recordPlay(game, { playKey: "error", rbi: 1 });

  assert.equal(game.score.team, 1);
  assert.equal(game.playerGameStats.m1.hits, 1);
  assert.equal(game.playerGameStats.m1.triples, 1);
  assert.equal(game.playerGameStats.m2.hits, 1);
  assert.equal(game.playerGameStats.m2.singles, 1);
  assert.equal(game.playerGameStats.m2.rbi, 1);
});

test("manual RBI scores a lead runner beyond the default hit advancement", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "walk", rbi: 0 });
  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = recordPlay(game, { playKey: "single", rbi: 1 });

  assert.equal(game.score.team, 1);
  assert.equal(game.bases.second?.name, "Ben");
  assert.equal(game.bases.first?.name, "Cara");
  assert.equal(game.playerGameStats.f1.rbi, 1);
});

test("home run credits RBI for every run scored including the hitter", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "walk", rbi: 0 });
  game = recordPlay(game, { playKey: "homeRun", rbi: 0 });

  assert.equal(game.score.team, 2);
  assert.equal(game.playerGameStats.m2.homeRuns, 1);
  assert.equal(game.playerGameStats.m2.rbi, 2);
});

test("manual extra outs remove baserunners without costing the batter a hit", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "walk", rbi: 0 });
  game = updateEvent(game, 0, { playKey: "walk", rbi: 0, extraOuts: 0 });
  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = updateEvent(game, 1, { playKey: "single", rbi: 0, extraOuts: 1 });

  assert.equal(game.outs, 1);
  assert.equal(game.bases.first?.name, "Ben");
  assert.equal(game.bases.second, null);
  assert.equal(game.playerGameStats.m2.hits, 1);
});

test("recordOpponentHalf tallies runs and flips the inning", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "home",
    lineup: createValidTenPlayerLineup(),
  });

  assert.equal(isTeamAtBat(game), false);

  game = recordOpponentHalf(game, { runs: 3 });

  assert.equal(game.score.opponent, 3);
  assert.equal(game.half, "bottom");
  assert.equal(game.inning, 1);
  assert.equal(game.lineup[0].players[0].defensiveInnings, 1);
});

test("substitutePlayer requires an at-bat and a defensive inning before a swap", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  assert.throws(
    () =>
      substitutePlayer(game, {
        lineupIndex: 0,
        player: createRosterPlayer("m8", "Kyle", "Male"),
      }),
    /at-bat and a defensive inning/i,
  );

  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordOpponentHalf(game, { runs: 0 });

  game = substitutePlayer(game, {
    lineupIndex: 0,
    player: createRosterPlayer("m8", "Kyle", "Male"),
  });

  assert.equal(game.lineup[0].activePlayerId, "m8");
  assert.equal(game.lineup[0].players.length, 2);
});

test("undoLastEvent and updateEvent rebuild the full game state", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = recordPlay(game, { playKey: "homeRun", rbi: 2 });

  assert.equal(game.score.team, 2);
  assert.equal(getCurrentBatter(game)?.name, "Cara");

  game = updateEvent(game, 0, { playKey: "walk" });

  assert.equal(game.playerGameStats.m1.walks, 1);
  assert.equal(game.playerGameStats.m1.hits, 0);
  assert.equal(game.score.team, 2);

  game = undoLastEvent(game);

  assert.equal(game.score.team, 0);
  assert.equal(getCurrentBatter(game)?.name, "Ben");
});

test("buildPlayerStats aggregates offensive production from saved games", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = recordPlay(game, { playKey: "homeRun", rbi: 2 });

  const stats = buildPlayerStats(
    createValidTenPlayerLineup().map((entry) => entry.player),
    [game],
  );

  assert.equal(stats[0].name, "Adam");
  assert.equal(stats[0].hits, 1);
  assert.equal(stats[1].name, "Ben");
  assert.equal(stats[1].homeRuns, 1);
  assert.equal(stats[1].rbi, 2);
});

test("adjustGameState changes the current hitter and outs", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = adjustGameState(game, { batterIndex: 4, outs: 2 });

  assert.equal(game.outs, 2);
  assert.equal(getCurrentBatter(game)?.name, "Eli");
  assert.equal(game.eventHistory.at(-1)?.type, "state-adjustment");
});

test("partner substitutions auto-rotate back after the next plate appearance", () => {
  let game = createGame({
    teamName: "SwanVegas Softball",
    opponentName: "Opponents",
    teamSide: "away",
    lineup: createValidTenPlayerLineup(),
  });

  game = recordPlay(game, { playKey: "single", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });
  game = recordOpponentHalf(game, { runs: 0 });

  game = substitutePlayer(game, {
    lineupIndex: 0,
    player: createRosterPlayer("m8", "Kyle", "Male"),
  });

  assert.equal(game.lineup[0].activePlayerId, "m8");
  assert.equal(game.lineup[0].autoRotate, true);

  game = adjustGameState(game, { batterIndex: 0, outs: 0 });
  game = recordPlay(game, { playKey: "groundOut", rbi: 0 });

  assert.equal(game.lineup[0].activePlayerId, "m1");
});
