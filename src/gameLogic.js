export const PLAY_DEFINITIONS = [
  { key: "single", label: "1B" },
  { key: "double", label: "2B" },
  { key: "triple", label: "3B" },
  { key: "homeRun", label: "HR" },
  { key: "walk", label: "BB" },
  { key: "error", label: "ROE" },
  { key: "strikeout", label: "K" },
  { key: "groundOut", label: "GO" },
  { key: "flyOut", label: "FO" },
  { key: "sacFly", label: "SF" },
];

const HIT_TOTALS = {
  single: 1,
  double: 2,
  triple: 3,
  homeRun: 4,
};

const HIT_STAT_KEYS = {
  single: "singles",
  double: "doubles",
  triple: "triples",
  homeRun: "homeRuns",
};

function createBases() {
  return { first: null, second: null, third: null };
}

function clonePlayer(player) {
  return player ? { ...player } : null;
}

function cloneBases(bases) {
  return {
    first: clonePlayer(bases.first),
    second: clonePlayer(bases.second),
    third: clonePlayer(bases.third),
  };
}

function cloneTeams(teams) {
  return {
    home: {
      ...teams.home,
      lineup: teams.home.lineup.map((player) => ({ ...player })),
    },
    away: {
      ...teams.away,
      lineup: teams.away.lineup.map((player) => ({ ...player })),
    },
  };
}

function battingTeamKey(state) {
  return state.half === "top" ? "away" : "home";
}

function fieldingTeamKey(state) {
  return battingTeamKey(state) === "home" ? "away" : "home";
}

function currentBatter(state) {
  const offense = battingTeamKey(state);
  const team = state.teams[offense];
  return { offense, batter: team.lineup[team.batterIndex] };
}

function advanceBatter(state, offense) {
  const team = state.teams[offense];
  team.batterIndex = (team.batterIndex + 1) % team.lineup.length;
}

function scoreRunner(state, runner, creditedPlayerId, creditedTeam, runsScored, creditedRbi) {
  if (!runner) {
    return;
  }
  state.score[creditedTeam] += 1;
  runsScored.push(runner);
  if (runner.id) {
    state.playerGameStats[runner.id] ||= createPlayerGameLine();
    state.playerGameStats[runner.id].runs += 1;
  }
  if (creditedPlayerId) {
    state.playerGameStats[creditedPlayerId] ||= createPlayerGameLine();
    state.playerGameStats[creditedPlayerId].rbi += creditedRbi;
  }
}

function createPlayerGameLine() {
  return {
    plateAppearances: 0,
    atBats: 0,
    hits: 0,
    singles: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    walks: 0,
    strikeouts: 0,
    sacrificeFlies: 0,
    runs: 0,
    rbi: 0,
  };
}

function applyHit(state, basesToAdvance, batter, offense) {
  const previous = cloneBases(state.bases);
  const runsScored = [];

  if (previous.third) {
    scoreRunner(state, previous.third, batter.id, offense, runsScored, 1);
  }
  if (basesToAdvance >= 2 && previous.second) {
    scoreRunner(state, previous.second, batter.id, offense, runsScored, 1);
  } else if (previous.second) {
    state.bases.third = previous.second;
  } else {
    state.bases.third = null;
  }

  if (basesToAdvance >= 3 && previous.first) {
    scoreRunner(state, previous.first, batter.id, offense, runsScored, 1);
  } else if (basesToAdvance >= 2 && previous.first) {
    state.bases.third = previous.first;
  } else if (previous.first) {
    state.bases.second = previous.first;
  } else {
    state.bases.second = state.bases.second ?? null;
  }

  if (basesToAdvance === 1) {
    state.bases.second = previous.first;
    state.bases.first = batter;
  } else if (basesToAdvance === 2) {
    state.bases.first = null;
    state.bases.second = batter;
  } else if (basesToAdvance === 3) {
    state.bases.first = null;
    state.bases.second = null;
    state.bases.third = batter;
  } else {
    state.bases = createBases();
    scoreRunner(state, batter, batter.id, offense, runsScored, 1);
  }

  return runsScored;
}

function applyWalk(state, batter, offense, isError = false) {
  const previous = cloneBases(state.bases);
  const runsScored = [];
  const nextBases = createBases();

  if (previous.first && previous.second && previous.third) {
    scoreRunner(state, previous.third, isError ? null : batter.id, offense, runsScored, isError ? 0 : 1);
  }

  if (previous.first) {
    nextBases.second = previous.first;
    if (previous.second) {
      nextBases.third = previous.second;
    } else {
      nextBases.third = previous.third;
    }
  } else {
    nextBases.second = previous.second;
    nextBases.third = previous.third;
  }

  nextBases.first = batter;
  state.bases = nextBases;
  return runsScored;
}

function finishHalfInning(state) {
  state.outs = 0;
  state.bases = createBases();
  if (state.half === "top") {
    state.half = "bottom";
  } else {
    state.half = "top";
    state.inning += 1;
  }
}

function describePlay(playKey) {
  return PLAY_DEFINITIONS.find((play) => play.key === playKey)?.label ?? playKey;
}

export function createGame({
  homeTeamName,
  awayTeamName,
  homeLineup,
  awayLineup,
}) {
  return {
    homeTeamName,
    awayTeamName,
    inning: 1,
    half: "top",
    outs: 0,
    bases: createBases(),
    score: { home: 0, away: 0 },
    teams: {
      home: { lineup: homeLineup.map((player) => ({ ...player })), batterIndex: 0 },
      away: { lineup: awayLineup.map((player) => ({ ...player })), batterIndex: 0 },
    },
    events: [],
    playerGameStats: {},
  };
}

export function applyPlay(game, playKey) {
  const state = {
    ...game,
    score: { ...game.score },
    bases: cloneBases(game.bases),
    teams: cloneTeams(game.teams),
    events: [...game.events],
    playerGameStats: Object.fromEntries(
      Object.entries(game.playerGameStats).map(([id, line]) => [id, { ...line }]),
    ),
  };

  const { offense, batter } = currentBatter(state);
  const defense = fieldingTeamKey(state);
  const batterLine = batter.id ? (state.playerGameStats[batter.id] ||= createPlayerGameLine()) : null;
  let runsScored = [];
  let outsAdded = 0;
  let creditAtBat = true;
  let plateAppearance = true;

  switch (playKey) {
    case "single":
    case "double":
    case "triple":
    case "homeRun":
      runsScored = applyHit(state, HIT_TOTALS[playKey], batter, offense);
      if (batterLine) {
        batterLine.hits += 1;
        batterLine[HIT_STAT_KEYS[playKey]] += 1;
      }
      break;
    case "walk":
      runsScored = applyWalk(state, batter, offense);
      creditAtBat = false;
      if (batterLine) {
        batterLine.walks += 1;
      }
      break;
    case "error":
      runsScored = applyWalk(state, batter, offense, true);
      break;
    case "strikeout":
      outsAdded = 1;
      if (batterLine) {
        batterLine.strikeouts += 1;
      }
      break;
    case "groundOut":
    case "flyOut":
      outsAdded = 1;
      break;
    case "sacFly":
      outsAdded = 1;
      creditAtBat = false;
      if (state.outs < 2 && state.bases.third) {
        const runner = state.bases.third;
        state.bases.third = null;
        scoreRunner(state, runner, batter.id, offense, runsScored, 1);
      }
      if (batterLine) {
        batterLine.sacrificeFlies += 1;
      }
      break;
    default:
      plateAppearance = false;
      break;
  }

  state.outs += outsAdded;

  if (plateAppearance && batterLine) {
    batterLine.plateAppearances += 1;
    if (creditAtBat) {
      batterLine.atBats += 1;
    }
  }

  state.events.unshift({
    id: `event-${state.events.length + 1}`,
    offense,
    defense,
    inning: state.inning,
    half: state.half,
    batter: { ...batter },
    playKey,
    label: describePlay(playKey),
    outsAfterPlay: state.outs,
    runsScored: runsScored.map((runner) => ({ ...runner })),
    scoreAfterPlay: { ...state.score },
    createdAt: new Date().toISOString(),
  });

  advanceBatter(state, offense);

  if (state.outs >= 3) {
    finishHalfInning(state);
  }

  return state;
}

export function substitutePlayer(game, { team, lineupIndex, player }) {
  const state = {
    ...game,
    teams: cloneTeams(game.teams),
  };
  state.teams[team].lineup[lineupIndex] = { ...player };
  return state;
}

function rate(value) {
  return Number.isFinite(value) ? value.toFixed(3).replace(/^0/, "") : ".000";
}

export function buildPlayerStats(roster, games) {
  const lines = new Map(
    roster.map((player) => [
      player.id,
      {
        id: player.id,
        name: player.name,
        gender: player.gender,
        positions: player.positions,
        plateAppearances: 0,
        atBats: 0,
        hits: 0,
        walks: 0,
        runs: 0,
        rbi: 0,
        totalBases: 0,
      },
    ]),
  );

  for (const game of games) {
    for (const [playerId, line] of Object.entries(game.playerGameStats || {})) {
      const current = lines.get(playerId);
      if (!current) {
        continue;
      }
      current.plateAppearances += line.plateAppearances;
      current.atBats += line.atBats;
      current.hits += line.hits;
      current.walks += line.walks;
      current.runs += line.runs;
      current.rbi += line.rbi;
      current.totalBases +=
        line.singles +
        line.doubles * 2 +
        line.triples * 3 +
        line.homeRuns * 4;
    }
  }

  return [...lines.values()]
    .map((line) => {
      const avg = line.atBats ? line.hits / line.atBats : 0;
      const obp = line.plateAppearances ? (line.hits + line.walks) / line.plateAppearances : 0;
      const slg = line.atBats ? line.totalBases / line.atBats : 0;
      return {
        ...line,
        avg: rate(avg),
        obp: rate(obp),
        slg: rate(slg),
        ops: rate(obp + slg),
      };
    })
    .sort((left, right) => right.hits - left.hits || left.name.localeCompare(right.name));
}
