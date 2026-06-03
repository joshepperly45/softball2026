export const FIELD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF"];
export const DEFAULT_TEAM_NAME = "SwanVegas Softball";

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
  { key: "doublePlay", label: "DP" },
];

const FEMALE_SLOTS = {
  10: [3, 6, 9],
  12: [3, 6, 9, 12],
};

const INFIELD_POSITIONS = new Set(["P", "C", "1B", "2B", "3B", "SS"]);
const OUTFIELD_POSITIONS = new Set(["LF", "LCF", "RCF", "RF"]);
const HIT_TOTALS = {
  single: 1,
  double: 2,
  triple: 3,
  homeRun: 4,
  error: 1,
};

const HIT_STAT_KEYS = {
  single: "singles",
  double: "doubles",
  triple: "triples",
  homeRun: "homeRuns",
  error: "singles",
};

function createBases() {
  return { first: null, second: null, third: null };
}

function cloneRunner(runner) {
  return runner ? { ...runner } : null;
}

function cloneBases(bases) {
  return {
    first: cloneRunner(bases.first),
    second: cloneRunner(bases.second),
    third: cloneRunner(bases.third),
  };
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

function sanitizePlayer(player) {
  return {
    id: String(player.id),
    name: String(player.name),
    gender: String(player.gender ?? ""),
    positions: Array.isArray(player.positions) ? [...player.positions] : [],
  };
}

function createGamePlayer(player, slot) {
  return {
    ...sanitizePlayer(player),
    slot,
    plateAppearances: 0,
    defensiveInnings: 0,
  };
}

function otherPartnerId(slot, currentPlayerId) {
  return slot.players.find((player) => player.id !== currentPlayerId)?.id ?? currentPlayerId;
}

function isFemale(player) {
  return player.gender === "Female";
}

function getHalfOffense(teamSide, half) {
  if (teamSide === "home") {
    return half === "top" ? "opponent" : "team";
  }
  return half === "top" ? "team" : "opponent";
}

function getCurrentBatterFromState(state) {
  if (getHalfOffense(state.teamSide, state.half) !== "team") {
    return null;
  }
  const slot = state.lineup[state.batterIndex];
  return slot.players.find((player) => player.id === slot.activePlayerId) ?? null;
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

function advanceBatter(state) {
  state.batterIndex = (state.batterIndex + 1) % state.lineup.length;
}

function ensurePlayerLine(state, playerId) {
  state.playerGameStats[playerId] ||= createPlayerGameLine();
  return state.playerGameStats[playerId];
}

function scoreRunner(state, runner, runsScored) {
  if (!runner) {
    return;
  }
  state.score.team += 1;
  runsScored.push({ ...runner });
  const line = ensurePlayerLine(state, runner.id);
  line.runs += 1;
}

function takeRunnerFromBases(state, excludedPlayerIds = new Set()) {
  for (const baseKey of ["third", "second", "first"]) {
    const runner = state.bases[baseKey];
    if (!runner || excludedPlayerIds.has(runner.id)) {
      continue;
    }
    state.bases[baseKey] = null;
    return runner;
  }
  return null;
}

function scoreAdditionalRunners(state, requestedRuns, runsScored, excludedPlayerIds = new Set()) {
  let additionalRuns = 0;
  while (additionalRuns < requestedRuns) {
    const runner = takeRunnerFromBases(state, excludedPlayerIds);
    if (!runner) {
      break;
    }
    scoreRunner(state, runner, runsScored);
    additionalRuns += 1;
  }
  return additionalRuns;
}

function applyExtraRunnerOuts(state, extraOuts, excludedPlayerIds = new Set()) {
  let outsRecorded = 0;
  while (outsRecorded < extraOuts) {
    const runner = takeRunnerFromBases(state, excludedPlayerIds);
    if (!runner) {
      break;
    }
    outsRecorded += 1;
  }
  return outsRecorded;
}

function countOccupiedBases(bases) {
  return [bases.first, bases.second, bases.third].filter(Boolean).length;
}

function isAutomaticRbiPlay(playKey) {
  return ["single", "double", "triple", "homeRun", "walk", "sacFly"].includes(playKey);
}

function applyHit(state, basesToAdvance, batter) {
  const previous = cloneBases(state.bases);
  const runsScored = [];
  const nextBases = createBases();

  if (previous.third) {
    scoreRunner(state, previous.third, runsScored);
  }
  if (basesToAdvance >= 2 && previous.second) {
    scoreRunner(state, previous.second, runsScored);
  } else if (previous.second) {
    nextBases.third = previous.second;
  }

  if (basesToAdvance >= 3 && previous.first) {
    scoreRunner(state, previous.first, runsScored);
  } else if (basesToAdvance >= 2 && previous.first) {
    nextBases.third = previous.first;
  } else if (previous.first) {
    nextBases.second = previous.first;
  }

  if (basesToAdvance === 1) {
    nextBases.first = batter;
  } else if (basesToAdvance === 2) {
    nextBases.second = batter;
  } else if (basesToAdvance === 3) {
    nextBases.third = batter;
  } else {
    scoreRunner(state, batter, runsScored);
  }

  state.bases = basesToAdvance === 4 ? createBases() : nextBases;
  return runsScored;
}

function applyWalk(state, batter) {
  const previous = cloneBases(state.bases);
  const runsScored = [];
  const nextBases = createBases();

  if (previous.first && previous.second && previous.third) {
    scoreRunner(state, previous.third, runsScored);
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

function countDefensiveInning(state) {
  for (const slot of state.lineup) {
    if (slot.position === "DH") {
      continue;
    }
    const activePlayer = slot.players.find((player) => player.id === slot.activePlayerId);
    if (activePlayer) {
      activePlayer.defensiveInnings += 1;
    }
  }
}

function summarizeEvent(state, summary) {
  state.events.push({
    ...summary,
    scoreAfterEvent: { ...state.score },
    inningAfterEvent: state.inning,
    halfAfterEvent: state.half,
    createdAt: summary.createdAt,
  });
}

function buildBaseState(setup) {
  return {
    setup: {
      teamName: setup.teamName,
      opponentName: setup.opponentName,
      teamSide: setup.teamSide,
      lineup: setup.lineup.map((entry) => ({
        player: sanitizePlayer(entry.player),
        position: entry.position,
      })),
    },
    teamName: setup.teamName,
    opponentName: setup.opponentName,
    teamSide: setup.teamSide,
    lineup: setup.lineup.map((entry, index) => ({
      slot: index + 1,
      position: entry.position,
      activePlayerId: entry.player.id,
      autoRotate: false,
      players: [createGamePlayer(entry.player, index + 1)],
    })),
    batterIndex: 0,
    inning: 1,
    half: "top",
    outs: 0,
    bases: createBases(),
    score: { team: 0, opponent: 0 },
    playerGameStats: {},
    eventHistory: [],
    events: [],
    currentBatter: null,
    currentOffense: null,
  };
}

function finalizeDerivedState(state) {
  state.currentOffense = getHalfOffense(state.teamSide, state.half);
  state.currentBatter = getCurrentBatterFromState(state);
  return state;
}

function buildPlaySummary(state, batter, event, runsScored, label, outsAfterPlay) {
  return {
    type: "play",
    label,
    playKey: event.playKey,
    batter: sanitizePlayer(batter),
    inning: state.inning,
    half: state.half,
    outsAfterPlay,
    runsScored,
    rbi: event.rbi,
    extraOuts: event.extraOuts,
    createdAt: event.createdAt,
  };
}

function maybeRotatePartner(state, lineupIndex) {
  const slot = state.lineup[lineupIndex];
  if (!slot?.autoRotate || slot.players.length < 2) {
    return;
  }
  slot.activePlayerId = otherPartnerId(slot, slot.activePlayerId);
}

function applyPlayEvent(state, event) {
  if (getHalfOffense(state.teamSide, state.half) !== "team") {
    throw new Error("Cannot record a team plate appearance during the opponent half inning.");
  }

  const batter = getCurrentBatterFromState(state);
  if (!batter) {
    throw new Error("No batter is available for the current lineup slot.");
  }

  const batterLine = ensurePlayerLine(state, batter.id);
  let runsScored = [];
  let outsAdded = 0;
  let countsAsAtBat = true;
  const requestedRbi = Math.max(0, Number(event.rbi) || 0);
  const extraOuts = Math.max(0, Number(event.extraOuts) || 0);

  switch (event.playKey) {
    case "single":
    case "double":
    case "triple":
    case "homeRun":
    case "error": {
      runsScored = applyHit(state, HIT_TOTALS[event.playKey], batter);
      batterLine.hits += 1;
      batterLine[HIT_STAT_KEYS[event.playKey]] += 1;
      break;
    }
    case "walk":
      runsScored = applyWalk(state, batter);
      countsAsAtBat = false;
      batterLine.walks += 1;
      break;
    case "strikeout":
      outsAdded = 1;
      batterLine.strikeouts += 1;
      break;
    case "groundOut":
    case "flyOut":
      outsAdded = 1;
      break;
    case "doublePlay":
      outsAdded = 2;
      break;
    case "sacFly":
      outsAdded = 1;
      countsAsAtBat = false;
      if (state.outs < 2 && state.bases.third) {
        const runner = state.bases.third;
        state.bases.third = null;
        scoreRunner(state, runner, runsScored);
      }
      batterLine.sacrificeFlies += 1;
      break;
    default:
      throw new Error(`Unsupported play: ${event.playKey}`);
  }

  if (event.playKey !== "homeRun") {
    const impliedAdditionalRuns = Math.max(0, requestedRbi - runsScored.length);
    scoreAdditionalRunners(state, impliedAdditionalRuns, runsScored, new Set([batter.id]));
  }

  outsAdded += applyExtraRunnerOuts(state, extraOuts, new Set([batter.id]));

  batter.plateAppearances += 1;
  batterLine.plateAppearances += 1;
  if (countsAsAtBat) {
    batterLine.atBats += 1;
  }

  const automaticRbi = extraOuts === 0 && isAutomaticRbiPlay(event.playKey) ? runsScored.length : 0;
  const creditedRbi = event.playKey === "homeRun" ? runsScored.length : Math.max(requestedRbi, automaticRbi);
  batterLine.rbi += creditedRbi;

  state.outs += outsAdded;
  const playSummary = buildPlaySummary(
    state,
    batter,
    { ...event, rbi: creditedRbi, extraOuts },
    runsScored.map((runner) => sanitizePlayer(runner)),
    PLAY_DEFINITIONS.find((play) => play.key === event.playKey)?.label ?? event.playKey,
    state.outs,
  );

  maybeRotatePartner(state, state.batterIndex);

  advanceBatter(state);
  if (state.outs >= 3) {
    finishHalfInning(state);
  }

  summarizeEvent(state, playSummary);
}

function applyOpponentHalfEvent(state, event) {
  const inning = state.inning;
  const half = state.half;
  if (getHalfOffense(state.teamSide, state.half) !== "opponent") {
    throw new Error("Cannot record opponent runs during your offensive half inning.");
  }

  state.score.opponent += event.runs;
  countDefensiveInning(state);
  finishHalfInning(state);
  summarizeEvent(state, {
    type: "opponent-half",
    label: "Opponent half inning",
    inning,
    half,
    runs: event.runs,
    createdAt: event.createdAt,
  });
}

function findSlotPlayer(slot, playerId) {
  return slot.players.find((player) => player.id === playerId) ?? null;
}

function playerIsUsedInOtherSlot(lineup, slotIndex, playerId) {
  return lineup.some((slot, index) => index !== slotIndex && slot.players.some((player) => player.id === playerId));
}

function canSwapOut(slot, activePlayer, injury) {
  if (injury) {
    return true;
  }
  if (activePlayer.plateAppearances < 1) {
    return false;
  }
  if (slot.position === "DH") {
    return true;
  }
  return activePlayer.defensiveInnings >= 1;
}

function applySubstitutionEvent(state, event) {
  const slot = state.lineup[event.lineupIndex];
  if (!slot) {
    throw new Error("Invalid lineup slot selected for substitution.");
  }

  const activePlayer = findSlotPlayer(slot, slot.activePlayerId);
  if (!activePlayer) {
    throw new Error("The active player for this slot could not be found.");
  }
  if (!canSwapOut(slot, activePlayer, event.injury)) {
    throw new Error("The active player must complete an at-bat and a defensive inning before swapping out.");
  }

  let incomingPlayer = findSlotPlayer(slot, event.player.id);
  if (!incomingPlayer) {
    if (slot.players.length >= 2) {
      throw new Error("Each lineup slot can only have two partner players.");
    }
    if (playerIsUsedInOtherSlot(state.lineup, event.lineupIndex, event.player.id)) {
      throw new Error("That player is already assigned to another lineup slot.");
    }
    incomingPlayer = createGamePlayer(event.player, slot.slot);
    slot.players.push(incomingPlayer);
    ensurePlayerLine(state, incomingPlayer.id);
  }

  if (incomingPlayer.id === activePlayer.id) {
    throw new Error("Choose the inactive partner for this lineup slot.");
  }

  slot.activePlayerId = incomingPlayer.id;
  slot.autoRotate = !event.injury;
  summarizeEvent(state, {
    type: "substitution",
    label: "Substitution",
    inning: state.inning,
    half: state.half,
    lineupIndex: event.lineupIndex,
    slot: slot.slot,
    fromPlayer: sanitizePlayer(activePlayer),
    toPlayer: sanitizePlayer(incomingPlayer),
    injury: Boolean(event.injury),
    createdAt: event.createdAt,
  });
}

function applyStateAdjustmentEvent(state, event) {
  if (Number.isInteger(event.outs)) {
    state.outs = Math.max(0, Math.min(2, event.outs));
  }
  if (Number.isInteger(event.batterIndex)) {
    state.batterIndex = ((event.batterIndex % state.lineup.length) + state.lineup.length) % state.lineup.length;
  }
  summarizeEvent(state, {
    type: "state-adjustment",
    label: "Manual adjustment",
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    batterIndex: state.batterIndex,
    createdAt: event.createdAt,
  });
}

function replayGame(setup, eventHistory) {
  const state = buildBaseState(setup);
  for (const slot of state.lineup) {
    ensurePlayerLine(state, slot.players[0].id);
  }

  for (const event of eventHistory) {
    if (event.type === "play") {
      applyPlayEvent(state, event);
    } else if (event.type === "opponent-half") {
      applyOpponentHalfEvent(state, event);
    } else if (event.type === "substitution") {
      applySubstitutionEvent(state, event);
    } else if (event.type === "state-adjustment") {
      applyStateAdjustmentEvent(state, event);
    } else {
      throw new Error(`Unknown event type: ${event.type}`);
    }
    state.eventHistory.push({
      ...event,
      player: event.player ? sanitizePlayer(event.player) : undefined,
    });
  }

  return finalizeDerivedState(state);
}

function buildUpdatedGame(game, nextEventHistory) {
  return replayGame(game.setup, nextEventHistory);
}

function buildEventTimestamp() {
  return new Date().toISOString();
}

export function validateLineup(lineup) {
  const errors = [];
  if (!Array.isArray(lineup) || !FEMALE_SLOTS[lineup.length]) {
    errors.push("Lineup must contain exactly 10 or 12 roster players.");
    return { valid: false, errors };
  }

  const seenPlayers = new Set();
  const positions = new Set();
  let femaleDhCount = 0;
  let maleDhCount = 0;
  let femaleInfielders = 0;
  let femaleOutfielders = 0;

  for (const [index, entry] of lineup.entries()) {
    if (!entry?.player?.id || !entry.player.name) {
      errors.push(`Lineup slot ${index + 1} is missing a roster player.`);
      continue;
    }
    if (seenPlayers.has(entry.player.id)) {
      errors.push(`Player ${entry.player.name} is duplicated in the lineup.`);
    }
    seenPlayers.add(entry.player.id);

    const shouldBeFemale = FEMALE_SLOTS[lineup.length].includes(index + 1);
    const playerIsFemale = isFemale(entry.player);
    if (shouldBeFemale && !playerIsFemale) {
      errors.push(`Lineup slot ${index + 1} must be a female player.`);
    }
    if (!shouldBeFemale && playerIsFemale) {
      errors.push(`Female players are only allowed in slots ${FEMALE_SLOTS[lineup.length].join(", ")}.`);
    }

    if (!entry.position) {
      errors.push(`Lineup slot ${index + 1} must have a defensive position.`);
      continue;
    }

    if (entry.position === "DH") {
      if (lineup.length !== 12) {
        errors.push("Designated hitters are only allowed in a 12-player lineup.");
      }
      if (playerIsFemale) {
        femaleDhCount += 1;
      } else {
        maleDhCount += 1;
      }
      continue;
    }

    if (!FIELD_POSITIONS.includes(entry.position)) {
      errors.push(`Position ${entry.position} is not supported.`);
      continue;
    }
    if (positions.has(entry.position)) {
      errors.push(`Position ${entry.position} is assigned more than once.`);
    }
    positions.add(entry.position);

    if (playerIsFemale && INFIELD_POSITIONS.has(entry.position)) {
      femaleInfielders += 1;
    }
    if (playerIsFemale && OUTFIELD_POSITIONS.has(entry.position)) {
      femaleOutfielders += 1;
    }
  }

  if (lineup.length === 10 && positions.size !== FIELD_POSITIONS.length) {
    errors.push("A 10-player lineup must fill all 10 defensive positions.");
  }

  if (lineup.length === 12) {
    if (femaleDhCount !== 1 || maleDhCount !== 1) {
      errors.push("A 12-player lineup must have exactly one female DH and one male DH.");
    }
    if (positions.size !== FIELD_POSITIONS.length) {
      errors.push("The 10 defensive positions must still be filled in a 12-player lineup.");
    }
  }

  if (femaleInfielders < 1) {
    errors.push("Defense must include at least one female infielder.");
  }
  if (femaleOutfielders < 1) {
    errors.push("Defense must include at least one female outfielder.");
  }

  return { valid: errors.length === 0, errors };
}

export function createGame({ teamName, opponentName, teamSide, lineup }) {
  const validation = validateLineup(lineup);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }
  return replayGame({ teamName: teamName || DEFAULT_TEAM_NAME, opponentName, teamSide, lineup }, []);
}

export function isTeamAtBat(game) {
  return getHalfOffense(game.teamSide, game.half) === "team";
}

export function getCurrentBatter(game) {
  return game.currentBatter ? { ...game.currentBatter, positions: [...game.currentBatter.positions] } : null;
}

export function recordPlay(game, { playKey, rbi = 0, extraOuts = 0 }) {
  const event = {
    type: "play",
    playKey,
    rbi:
      playKey === "homeRun"
        ? countOccupiedBases(game.bases) + 1
        : Math.max(0, Number(rbi) || 0),
    extraOuts: Math.max(0, Number(extraOuts) || 0),
    createdAt: buildEventTimestamp(),
  };
  return buildUpdatedGame(game, [...game.eventHistory, event]);
}

export function recordOpponentHalf(game, { runs = 0 }) {
  const event = {
    type: "opponent-half",
    runs: Math.max(0, Number(runs) || 0),
    createdAt: buildEventTimestamp(),
  };
  return buildUpdatedGame(game, [...game.eventHistory, event]);
}

export function substitutePlayer(game, { lineupIndex, player, injury = false }) {
  const event = {
    type: "substitution",
    lineupIndex,
    player: sanitizePlayer(player),
    injury: Boolean(injury),
    createdAt: buildEventTimestamp(),
  };
  return buildUpdatedGame(game, [...game.eventHistory, event]);
}

export function adjustGameState(game, { batterIndex, outs }) {
  const event = {
    type: "state-adjustment",
    batterIndex: Number.isInteger(batterIndex) ? batterIndex : undefined,
    outs: Number.isInteger(outs) ? outs : undefined,
    createdAt: buildEventTimestamp(),
  };
  return buildUpdatedGame(game, [...game.eventHistory, event]);
}

export function undoLastEvent(game) {
  return buildUpdatedGame(game, game.eventHistory.slice(0, -1));
}

export function deleteEvent(game, eventIndex) {
  return buildUpdatedGame(
    game,
    game.eventHistory.filter((_, index) => index !== eventIndex),
  );
}

export function updateEvent(game, eventIndex, updates) {
  return buildUpdatedGame(
    game,
    game.eventHistory.map((event, index) => {
      if (index !== eventIndex) {
        return event;
      }
      if (event.type === "play") {
        return {
          ...event,
          playKey: updates.playKey ?? event.playKey,
          rbi:
            (updates.playKey ?? event.playKey) === "homeRun"
              ? countOccupiedBases(replayGame(game.setup, game.eventHistory.slice(0, index)).bases) + 1
              : updates.rbi ?? event.rbi,
          extraOuts: updates.extraOuts ?? event.extraOuts ?? 0,
        };
      }
      if (event.type === "opponent-half") {
        return {
          ...event,
          runs: updates.runs ?? event.runs,
        };
      }
      if (event.type === "state-adjustment") {
        return {
          ...event,
          batterIndex: updates.batterIndex ?? event.batterIndex,
          outs: updates.outs ?? event.outs,
        };
      }
      return event;
    }),
  );
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
        gamesPlayed: 0,
        plateAppearances: 0,
        atBats: 0,
        hits: 0,
        singles: 0,
        doubles: 0,
        triples: 0,
        homeRuns: 0,
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
      if (line.plateAppearances > 0) {
        current.gamesPlayed += 1;
      }
      current.plateAppearances += line.plateAppearances;
      current.atBats += line.atBats;
      current.hits += line.hits;
      current.singles += line.singles;
      current.doubles += line.doubles;
      current.triples += line.triples;
      current.homeRuns += line.homeRuns;
      current.walks += line.walks;
      current.runs += line.runs;
      current.rbi += line.rbi;
      current.totalBases += line.singles + line.doubles * 2 + line.triples * 3 + line.homeRuns * 4;
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

export function getEventLabel(event) {
  if (event.type === "opponent-half") {
    return `${event.label} (${event.runs} run${event.runs === 1 ? "" : "s"})`;
  }
  if (event.type === "substitution") {
    return `${event.label}: ${event.fromPlayer.name} -> ${event.toPlayer.name}`;
  }
  if (event.type === "state-adjustment") {
    return `${event.label}: batter ${event.batterIndex + 1}, outs ${event.outs}`;
  }
  return event.label;
}
