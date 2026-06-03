import {
  PLAY_DEFINITIONS,
  applyPlay,
  buildPlayerStats,
  createGame,
  substitutePlayer,
} from "./gameLogic.js";

const STORAGE_KEYS = {
  roster: "softball2026-roster",
  savedGames: "softball2026-saved-games",
  currentGame: "softball2026-current-game",
};

const state = {
  roster: readStorage(STORAGE_KEYS.roster, []),
  lineup: [],
  savedGames: readStorage(STORAGE_KEYS.savedGames, []),
  currentGame: readStorage(STORAGE_KEYS.currentGame, null),
};

const tabButtons = [...document.querySelectorAll(".tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const rosterForm = document.querySelector("#roster-form");
const rosterTable = document.querySelector("#roster-table");
const lineupPool = document.querySelector("#lineup-pool");
const dailyLineup = document.querySelector("#daily-lineup");
const setupForm = document.querySelector("#setup-form");
const setupMessage = document.querySelector("#setup-message");
const trackerEmpty = document.querySelector("#tracker-empty");
const trackerContent = document.querySelector("#tracker-content");
const scoreboard = document.querySelector("#scoreboard");
const atBatCard = document.querySelector("#at-bat-card");
const playButtons = document.querySelector("#play-buttons");
const eventLog = document.querySelector("#event-log");
const finishGameButton = document.querySelector("#finish-game");
const subForm = document.querySelector("#sub-form");
const subTeamSelect = subForm.elements.team;
const subLineupIndex = document.querySelector("#sub-lineup-index");
const statsTable = document.querySelector("#stats-table");
const statsSummary = document.querySelector("#stats-summary");

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((tab) => tab.classList.toggle("active", tab === button));
    tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${button.dataset.tab}`));
  });
});

rosterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(rosterForm);
  const player = {
    id: crypto.randomUUID(),
    name: String(formData.get("name")).trim(),
    gender: String(formData.get("gender")),
    positions: String(formData.get("positions"))
      .split(",")
      .map((position) => position.trim())
      .filter(Boolean),
  };

  if (!player.name) {
    return;
  }

  state.roster.push(player);
  persistState();
  rosterForm.reset();
  rosterForm.elements.gender.value = "Female";
  render();
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(setupForm);
  const minPlayers = Number(formData.get("minPlayers"));
  const minFemales = Number(formData.get("minFemales"));

  const femaleCount = state.lineup.filter((player) => player.gender === "Female").length;
  if (state.lineup.length < minPlayers) {
    setupMessage.textContent = `Add at least ${minPlayers} players to the lineup.`;
    return;
  }
  if (femaleCount < minFemales) {
    setupMessage.textContent = `Daily lineup needs at least ${minFemales} female players.`;
    return;
  }

  const teamSide = String(formData.get("teamSide"));
  const opponentEntries = String(formData.get("opponentLineup"))
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
  const opponentLineup = opponentEntries.length
    ? opponentEntries.map((name, index) => ({ id: null, name, slot: index + 1 }))
    : Array.from({ length: state.lineup.length }, (_, index) => ({
        id: null,
        name: `Opponent ${index + 1}`,
        slot: index + 1,
      }));

  const yourTeamLineup = state.lineup.map((player, index) => ({ ...player, slot: index + 1 }));
  state.currentGame =
    teamSide === "home"
      ? createGame({
          homeTeamName: String(formData.get("teamName")).trim(),
          awayTeamName: String(formData.get("opponentName")).trim(),
          homeLineup: yourTeamLineup,
          awayLineup: opponentLineup,
        })
      : createGame({
          homeTeamName: String(formData.get("opponentName")).trim(),
          awayTeamName: String(formData.get("teamName")).trim(),
          homeLineup: opponentLineup,
          awayLineup: yourTeamLineup,
        });

  persistState();
  setupMessage.textContent = "Game started. Head to the tracker tab to score the game.";
  render();
});

subForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.currentGame) {
    return;
  }
  const formData = new FormData(subForm);
  const team = String(formData.get("team"));
  const lineupIndex = Number(formData.get("lineupIndex"));
  const playerName = String(formData.get("playerName")).trim();

  if (!playerName) {
    return;
  }

  const rosterPlayer = state.roster.find((player) => player.name.toLowerCase() === playerName.toLowerCase());
  const replacement = rosterPlayer
    ? { ...rosterPlayer, slot: lineupIndex + 1 }
    : { id: null, name: playerName, gender: "Custom", positions: [], slot: lineupIndex + 1 };

  state.currentGame = substitutePlayer(state.currentGame, { team, lineupIndex, player: replacement });
  persistState();
  subForm.reset();
  render();
});

subTeamSelect.addEventListener("change", () => {
  renderSubstitutionOptions();
});

finishGameButton.addEventListener("click", () => {
  if (!state.currentGame) {
    return;
  }
  state.savedGames.unshift(state.currentGame);
  state.currentGame = null;
  persistState();
  render();
});

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEYS.roster, JSON.stringify(state.roster));
  localStorage.setItem(STORAGE_KEYS.savedGames, JSON.stringify(state.savedGames));
  if (state.currentGame) {
    localStorage.setItem(STORAGE_KEYS.currentGame, JSON.stringify(state.currentGame));
  } else {
    localStorage.removeItem(STORAGE_KEYS.currentGame);
  }
}

function removePlayer(playerId) {
  state.roster = state.roster.filter((player) => player.id !== playerId);
  state.lineup = state.lineup.filter((player) => player.id !== playerId);
  persistState();
  render();
}

function addLineupPlayer(playerId) {
  const player = state.roster.find((entry) => entry.id === playerId);
  if (!player || state.lineup.some((entry) => entry.id === playerId)) {
    return;
  }
  state.lineup.push(player);
  render();
}

function moveLineupPlayer(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= state.lineup.length) {
    return;
  }
  const [player] = state.lineup.splice(index, 1);
  state.lineup.splice(nextIndex, 0, player);
  render();
}

function removeLineupPlayer(playerId) {
  state.lineup = state.lineup.filter((player) => player.id !== playerId);
  render();
}

function renderRoster() {
  rosterTable.innerHTML = state.roster.length
    ? state.roster
        .map(
          (player) => `
            <tr>
              <td>${escapeHtml(player.name)}</td>
              <td>${escapeHtml(player.gender)}</td>
              <td>${escapeHtml(player.positions.join(", ") || "—")}</td>
              <td><button class="danger" data-remove-player="${player.id}">Remove</button></td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No players saved yet.</td></tr>`;

  rosterTable.querySelectorAll("[data-remove-player]").forEach((button) => {
    button.addEventListener("click", () => removePlayer(button.dataset.removePlayer));
  });
}

function renderLineupBuilder() {
  lineupPool.innerHTML = state.roster.length
    ? state.roster
        .map((player) => {
          const disabled = state.lineup.some((entry) => entry.id === player.id) ? "disabled" : "";
          return `<button ${disabled} data-add-lineup="${player.id}">${escapeHtml(player.name)}</button>`;
        })
        .join("")
    : `<p class="muted">Add roster players first.</p>`;

  lineupPool.querySelectorAll("[data-add-lineup]").forEach((button) => {
    button.addEventListener("click", () => addLineupPlayer(button.dataset.addLineup));
  });

  dailyLineup.innerHTML = state.lineup.length
    ? state.lineup
        .map(
          (player, index) => `
            <li>
              <div class="lineup-row">
                <strong>${index + 1}. ${escapeHtml(player.name)}</strong>
                <span class="muted">${escapeHtml(player.positions.join(", ") || "No positions saved")}</span>
                <button data-move-up="${index}">↑</button>
                <button data-move-down="${index}">↓</button>
                <button class="danger" data-remove-lineup="${player.id}">Remove</button>
              </div>
            </li>
          `,
        )
        .join("")
    : `<li class="muted">No lineup selected yet.</li>`;

  dailyLineup.querySelectorAll("[data-move-up]").forEach((button) => {
    button.addEventListener("click", () => moveLineupPlayer(Number(button.dataset.moveUp), -1));
  });
  dailyLineup.querySelectorAll("[data-move-down]").forEach((button) => {
    button.addEventListener("click", () => moveLineupPlayer(Number(button.dataset.moveDown), 1));
  });
  dailyLineup.querySelectorAll("[data-remove-lineup]").forEach((button) => {
    button.addEventListener("click", () => removeLineupPlayer(button.dataset.removeLineup));
  });
}

function renderTracker() {
  const game = state.currentGame;
  trackerEmpty.classList.toggle("hidden", Boolean(game));
  trackerContent.classList.toggle("hidden", !game);

  if (!game) {
    return;
  }

  const offense = game.half === "top" ? "away" : "home";
  const offenseTeam = game.teams[offense];
  const batter = offenseTeam.lineup[offenseTeam.batterIndex];

  scoreboard.innerHTML = `
    <div class="score-box">
      <span>${escapeHtml(game.awayTeamName)}</span>
      <strong>${game.score.away}</strong>
    </div>
    <div class="score-box">
      <span>${escapeHtml(game.homeTeamName)}</span>
      <strong>${game.score.home}</strong>
    </div>
    <div class="score-box">
      <span>Inning</span>
      <strong>${game.half === "top" ? "Top" : "Bottom"} ${game.inning}</strong>
      <div class="muted">Outs: ${game.outs}</div>
      <div class="bases">
        ${renderBase("1B", game.bases.first)}
        ${renderBase("2B", game.bases.second)}
        ${renderBase("3B", game.bases.third)}
      </div>
    </div>
  `;

  atBatCard.innerHTML = `
    <h3>Current batter</h3>
    <p><strong>${escapeHtml(batter.name)}</strong> batting for ${escapeHtml(offense === "home" ? game.homeTeamName : game.awayTeamName)}</p>
    <p class="muted">Lineup spot ${offenseTeam.batterIndex + 1}</p>
  `;

  playButtons.innerHTML = PLAY_DEFINITIONS.map(
    (play) => `<button data-play="${play.key}">${play.label}</button>`,
  ).join("");
  playButtons.querySelectorAll("[data-play]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentGame = applyPlay(state.currentGame, button.dataset.play);
      persistState();
      render();
    });
  });

  eventLog.innerHTML = game.events.length
    ? game.events
        .map(
          (event) => `
            <li>
              <strong>${escapeHtml(event.half === "top" ? "Top" : "Bottom")} ${event.inning} · ${escapeHtml(event.batter.name)} · ${escapeHtml(event.label)}</strong>
              <div class="muted">
                ${escapeHtml(event.offense === "home" ? game.homeTeamName : game.awayTeamName)}
                ${event.scoreAfterPlay.home}-${event.scoreAfterPlay.away}
              ${event.runsScored.length ? `· ${event.runsScored.length} run${event.runsScored.length !== 1 ? "s" : ""} scored` : ""}
              </div>
            </li>
          `,
        )
        .join("")
    : `<li class="muted">No plays recorded yet.</li>`;

  renderSubstitutionOptions();
}

function renderBase(label, runner) {
  return `<span class="base ${runner ? "occupied" : ""}">${label}${runner ? ` · ${escapeHtml(runner.name)}` : ""}</span>`;
}

function renderStats() {
  const stats = buildPlayerStats(state.roster, state.savedGames);
  const totalGames = state.savedGames.length;
  const totalRuns = state.savedGames.reduce(
    (sum, game) => sum + game.score.home + game.score.away,
    0,
  );
  statsSummary.innerHTML = `
    <div class="summary-card"><span>Saved games</span><strong>${totalGames}</strong></div>
    <div class="summary-card"><span>Rostered players</span><strong>${state.roster.length}</strong></div>
    <div class="summary-card"><span>Total runs tracked</span><strong>${totalRuns}</strong></div>
  `;

  statsTable.innerHTML = stats.length
    ? stats
        .map(
          (player) => `
            <tr>
              <td>${escapeHtml(player.name)}</td>
              <td>${player.plateAppearances}</td>
              <td>${player.atBats}</td>
              <td>${player.hits}</td>
              <td>${player.walks}</td>
              <td>${player.runs}</td>
              <td>${player.rbi}</td>
              <td>${player.avg}</td>
              <td>${player.obp}</td>
              <td>${player.slg}</td>
              <td>${player.ops}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="11" class="muted">Finish and save at least one game to generate stats.</td></tr>`;
}

function renderSubstitutionOptions() {
  if (!state.currentGame) {
    subLineupIndex.innerHTML = "";
    return;
  }

  const selectedTeam = subTeamSelect.value || "home";
  subLineupIndex.innerHTML = state.currentGame.teams[selectedTeam].lineup
    .map(
      (player, index) =>
        `<option value="${index}">${index + 1}. ${escapeHtml(player.name)}</option>`,
    )
    .join("");
}

function render() {
  renderRoster();
  renderLineupBuilder();
  renderTracker();
  renderStats();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

render();
