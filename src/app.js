import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_CONFIG } from "./supabaseConfig.js";

import {
  DEFAULT_TEAM_NAME,
  FIELD_POSITIONS,
  PLAY_DEFINITIONS,
  adjustGameState,
  buildPlayerStats,
  createGame,
  deleteEvent,
  getEventLabel,
  isTeamAtBat,
  recordOpponentHalf,
  recordPlay,
  substitutePlayer,
  undoLastEvent,
  updateEvent,
  validateLineup,
} from "./gameLogic.js";

const LEGACY_TEAM_NAME = "Softball 2026";

const STORAGE_KEYS = {
  roster: "softball-roster",
  lineup: "softball-lineup-draft",
  savedGames: "softball-saved-games",
  currentGame: "softball-current-game",
  syncMeta: "softball-sync-meta",
};

const SHARED_STATE_BUCKET = "shared";

const localSyncMeta = readStorage(STORAGE_KEYS.syncMeta, {});

const state = {
  roster: readStorage(STORAGE_KEYS.roster, []),
  lineup: readStorage(STORAGE_KEYS.lineup, []),
  savedGames: normalizeSavedGames(readStorage(STORAGE_KEYS.savedGames, [])),
  currentGame: normalizeGame(readStorage(STORAGE_KEYS.currentGame, null)),
  editingEventIndex: null,
  selectedSavedGameIndex: 0,
  statsSort: { key: "rbi", direction: "desc" },
};

const syncState = {
  client: null,
  ready: false,
  saveTimer: null,
  pendingPayload: null,
  pendingUpdatedAt: null,
  localUpdatedAt: typeof localSyncMeta?.updatedAt === "string" ? localSyncMeta.updatedAt : null,
};

const tabButtons = [...document.querySelectorAll(".tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const sortButtons = [...document.querySelectorAll(".sort-button")];
const rosterForm = document.querySelector("#roster-form");
const rosterTable = document.querySelector("#roster-table");
const exportDataButton = document.querySelector("#export-data");
const importDataButton = document.querySelector("#import-data");
const importFileInput = document.querySelector("#import-file");
const storageMessage = document.querySelector("#storage-message");
const cloudMessage = document.querySelector("#cloud-message");
const lineupPool = document.querySelector("#lineup-pool");
const dailyLineup = document.querySelector("#daily-lineup");
const lineupSummary = document.querySelector("#lineup-summary");
const setupForm = document.querySelector("#setup-form");
const setupMessage = document.querySelector("#setup-message");
const trackerEmpty = document.querySelector("#tracker-empty");
const trackerContent = document.querySelector("#tracker-content");
const scoreboard = document.querySelector("#scoreboard");
const atBatCard = document.querySelector("#at-bat-card");
const stateAdjustForm = document.querySelector("#state-adjust-form");
const stateAdjustMessage = document.querySelector("#state-adjust-message");
const currentHitterSelect = document.querySelector("#current-hitter");
const currentOutsSelect = document.querySelector("#current-outs");
const actionPanelTitle = document.querySelector("#action-panel-title");
const trackerMessage = document.querySelector("#tracker-message");
const teamOffensePanel = document.querySelector("#team-offense-panel");
const opponentPanel = document.querySelector("#opponent-panel");
const playRbiInput = document.querySelector("#play-rbi");
const playExtraOutsInput = document.querySelector("#play-extra-outs");
const playButtons = document.querySelector("#play-buttons");
const opponentForm = document.querySelector("#opponent-form");
const opponentMessage = document.querySelector("#opponent-message");
const eventLog = document.querySelector("#event-log");
const finishGameButton = document.querySelector("#finish-game");
const undoLastButtons = [...document.querySelectorAll("[data-undo-last]")];
const subForm = document.querySelector("#sub-form");
const subLineupIndex = document.querySelector("#sub-lineup-index");
const subPlayerId = document.querySelector("#sub-player-id");
const subMessage = document.querySelector("#sub-message");
const editPanel = document.querySelector("#edit-panel");
const editForm = document.querySelector("#edit-form");
const editFields = document.querySelector("#edit-fields");
const editMessage = document.querySelector("#edit-message");
const cancelEditButton = document.querySelector("#cancel-edit");
const statsTable = document.querySelector("#stats-table");
const statsSummary = document.querySelector("#stats-summary");
const statsImportButton = document.querySelector("#stats-import-games");
const statsImportFileInput = document.querySelector("#stats-import-file");
const statsImportMessage = document.querySelector("#stats-import-message");
const savedGamesList = document.querySelector("#saved-games-list");
const savedGameDetail = document.querySelector("#saved-game-detail");

sortButtons.forEach((button) => {
  button.dataset.label ||= button.textContent.trim();
  button.addEventListener("click", () => {
    const key = button.dataset.sortKey;
    if (state.statsSort.key === key) {
      state.statsSort.direction = state.statsSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.statsSort = { key, direction: key === "name" ? "asc" : "desc" };
    }
    renderStats();
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
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

exportDataButton.addEventListener("click", () => {
  storageMessage.textContent = "";
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    roster: state.roster,
    lineupDraft: state.lineup,
    savedGames: state.savedGames,
    currentGame: state.currentGame,
    statsSnapshot: buildPlayerStats(state.roster, state.savedGames),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `swanvegas-softball-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  storageMessage.textContent = "Backup downloaded to your computer.";
});

importDataButton.addEventListener("click", () => {
  storageMessage.textContent = "";
  importFileInput.click();
});

if (statsImportButton && statsImportFileInput) {
  statsImportButton.addEventListener("click", () => {
    if (statsImportMessage) {
      statsImportMessage.textContent = "";
    }
    statsImportFileInput.click();
  });

  statsImportFileInput.addEventListener("change", async () => {
    const files = [...(statsImportFileInput.files || [])];
    if (!files.length) {
      return;
    }

    try {
      let importedGames = [];
      for (const file of files) {
        const payload = JSON.parse(await file.text());
        importedGames = importedGames.concat(parseSavedGamesPayload(payload));
      }

      if (!importedGames.length) {
        throw new Error("No completed games were found in those files.");
      }

      const beforeCount = state.savedGames.length;
      state.savedGames = mergeSavedGames(state.savedGames, importedGames);
      state.selectedSavedGameIndex = 0;
      persistState();
      renderStats();

      const addedCount = state.savedGames.length - beforeCount;
      if (statsImportMessage) {
        statsImportMessage.textContent = addedCount > 0
          ? `Loaded ${addedCount} game${addedCount === 1 ? "" : "s"} from file.`
          : "Those game files were already loaded on this device.";
      }
    } catch (error) {
      if (statsImportMessage) {
        statsImportMessage.textContent = error instanceof Error
          ? error.message
          : "Could not import those game files.";
      }
    } finally {
      statsImportFileInput.value = "";
    }
  });
}

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];
  if (!file) {
    return;
  }

  try {
    const imported = JSON.parse(await file.text());
    state.roster = Array.isArray(imported.roster) ? imported.roster : [];
    state.lineup = Array.isArray(imported.lineupDraft) ? imported.lineupDraft : [];
    state.savedGames = normalizeSavedGames(imported.savedGames || []);
    state.currentGame = normalizeGame(imported.currentGame);
    state.editingEventIndex = null;
    state.selectedSavedGameIndex = 0;
    persistState();
    render();
    storageMessage.textContent = `Imported backup from ${file.name}.`;
  } catch {
    storageMessage.textContent = "Could not import that file. Use a backup JSON exported from this app.";
  } finally {
    importFileInput.value = "";
  }
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setupMessage.textContent = "";

  try {
    const formData = new FormData(setupForm);
    const lineup = buildGameLineup();
    const validation = validateLineup(lineup);
    if (!validation.valid) {
      setupMessage.textContent = validation.errors[0];
      return;
    }

    state.currentGame = createGame({
      teamName: normalizeTeamName(String(formData.get("teamName")).trim()) || DEFAULT_TEAM_NAME,
      opponentName: String(formData.get("opponentName")).trim() || "Opponent",
      teamSide: String(formData.get("teamSide")),
      lineup,
    });
    state.editingEventIndex = null;
    persistState();
    setActiveTab("tracker");
    render();
  } catch (error) {
    setupMessage.textContent = error instanceof Error ? error.message : "Could not start the game.";
  }
});

opponentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.currentGame) {
    return;
  }
  opponentMessage.textContent = "";
  try {
    const formData = new FormData(opponentForm);
    state.currentGame = recordOpponentHalf(state.currentGame, {
      runs: Number(formData.get("runs")),
    });
    state.editingEventIndex = null;
    persistState();
    opponentForm.reset();
    document.querySelector("#opponent-runs").value = "0";
    render();
  } catch (error) {
    opponentMessage.textContent = error instanceof Error ? error.message : "Could not record the inning.";
  }
});

subForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.currentGame) {
    return;
  }

  subMessage.textContent = "";
  const formData = new FormData(subForm);
  const lineupIndex = Number(formData.get("lineupIndex"));
  const playerId = String(formData.get("playerId"));
  const player = state.roster.find((entry) => entry.id === playerId);
  if (!player) {
    subMessage.textContent = "Choose a roster player for that partner slot.";
    return;
  }

  try {
    state.currentGame = substitutePlayer(state.currentGame, {
      lineupIndex,
      player,
      injury: formData.get("injury") === "on",
    });
    state.editingEventIndex = null;
    persistState();
    subForm.reset();
    render();
  } catch (error) {
    subMessage.textContent = error instanceof Error ? error.message : "Could not apply the substitution.";
  }
});

stateAdjustForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.currentGame) {
    return;
  }

  stateAdjustMessage.textContent = "";
  try {
    state.currentGame = adjustGameState(state.currentGame, {
      batterIndex: Number(currentHitterSelect.value),
      outs: Number(currentOutsSelect.value),
    });
    state.editingEventIndex = null;
    persistState();
    render();
  } catch (error) {
    stateAdjustMessage.textContent = error instanceof Error ? error.message : "Could not apply that adjustment.";
  }
});

editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.currentGame || state.editingEventIndex === null) {
    return;
  }

  const targetEvent = state.currentGame.eventHistory[state.editingEventIndex];
  if (!targetEvent) {
    return;
  }

  editMessage.textContent = "";
  const formData = new FormData(editForm);
  try {
    if (targetEvent.type === "play") {
      state.currentGame = updateEvent(state.currentGame, state.editingEventIndex, {
        playKey: String(formData.get("playKey")),
        rbi: Number(formData.get("rbi")),
        extraOuts: Number(formData.get("extraOuts")),
      });
    } else if (targetEvent.type === "opponent-half") {
      state.currentGame = updateEvent(state.currentGame, state.editingEventIndex, {
        runs: Number(formData.get("runs")),
      });
    } else if (targetEvent.type === "state-adjustment") {
      state.currentGame = updateEvent(state.currentGame, state.editingEventIndex, {
        batterIndex: Number(formData.get("batterIndex")),
        outs: Number(formData.get("outs")),
      });
    }
    state.editingEventIndex = null;
    persistState();
    render();
  } catch (error) {
    editMessage.textContent = error instanceof Error ? error.message : "Could not update that event.";
  }
});

cancelEditButton.addEventListener("click", () => {
  state.editingEventIndex = null;
  render();
});

finishGameButton.addEventListener("click", () => {
  if (!state.currentGame) {
    return;
  }
  const finishedGame = finalizeGameRecord(state.currentGame);
  state.savedGames = mergeSavedGames(state.savedGames, [finishedGame]);
  downloadJsonFile(buildGameFileName(finishedGame), buildGameExportPayload(finishedGame));
  state.currentGame = null;
  state.editingEventIndex = null;
  state.selectedSavedGameIndex = 0;
  persistState();
  render();
});

undoLastButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!state.currentGame?.eventHistory.length) {
      return;
    }
    state.currentGame = undoLastEvent(state.currentGame);
    state.editingEventIndex = null;
    persistState();
    render();
  });
});

function setActiveTab(tabId) {
  tabButtons.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabId));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabId}`));
}

function normalizeTeamName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed === LEGACY_TEAM_NAME) {
    return DEFAULT_TEAM_NAME;
  }
  return trimmed;
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeGame(game) {
  if (!game?.setup || !Array.isArray(game?.lineup) || !Array.isArray(game?.eventHistory)) {
    return null;
  }
  const completedAt = game.completedAt || game.events?.at(-1)?.createdAt || null;
  return {
    ...game,
    id: game.id || buildGameIdentity({
      ...game,
      completedAt,
      teamName: normalizeTeamName(game.teamName),
    }),
    completedAt,
    teamName: normalizeTeamName(game.teamName),
    setup: {
      ...game.setup,
      teamName: normalizeTeamName(game.setup.teamName),
    },
  };
}

function normalizeSavedGames(games) {
  if (!Array.isArray(games)) {
    return [];
  }
  return games.map((game) => normalizeGame(game)).filter((game) => game?.playerGameStats);
}

function parseSavedGamesPayload(payload) {
  if (Array.isArray(payload)) {
    return normalizeSavedGames(payload);
  }
  if (payload?.savedGames) {
    return normalizeSavedGames(payload.savedGames);
  }
  if (payload?.game) {
    return normalizeSavedGames([payload.game]);
  }
  if (payload?.playerGameStats && payload?.eventHistory) {
    return normalizeSavedGames([payload]);
  }
  return [];
}

function finalizeGameRecord(game) {
  return normalizeGame({
    ...game,
    completedAt: new Date().toISOString(),
  });
}

function buildGameExportPayload(game) {
  return {
    version: 1,
    type: "swanvegas-game",
    exportedAt: new Date().toISOString(),
    game,
  };
}

function downloadJsonFile(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildGameFileName(game) {
  const datePart = (game.completedAt || new Date().toISOString()).slice(0, 10);
  const opponentPart = sanitizeFileSegment(game.opponentName || "opponent");
  return `swanvegas-game-${datePart}-vs-${opponentPart}.json`;
}

function sanitizeFileSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "game";
}

function buildGameIdentity(game) {
  return [
    normalizeTeamName(game.teamName),
    game.opponentName || "Opponent",
    game.completedAt || game.events?.at(-1)?.createdAt || "unknown-date",
    `${game.score?.team ?? 0}-${game.score?.opponent ?? 0}`,
    Array.isArray(game.eventHistory) ? game.eventHistory.length : 0,
  ].join("|");
}

function mergeSavedGames(existingGames, incomingGames) {
  const merged = new Map();

  [...incomingGames, ...existingGames].forEach((game) => {
    const normalizedGame = normalizeGame(game);
    if (!normalizedGame) {
      return;
    }
    merged.set(buildGameIdentity(normalizedGame), normalizedGame);
  });

  return [...merged.values()].sort((left, right) => {
    const leftTime = Date.parse(left.completedAt || left.events?.at(-1)?.createdAt || 0);
    const rightTime = Date.parse(right.completedAt || right.events?.at(-1)?.createdAt || 0);
    return rightTime - leftTime;
  });
}

function persistState() {
  const updatedAt = new Date().toISOString();
  persistLocalState(updatedAt);
  queueCloudSave(updatedAt);
}

function persistLocalState(updatedAt = new Date().toISOString()) {
  localStorage.setItem(STORAGE_KEYS.roster, JSON.stringify(state.roster));
  localStorage.setItem(STORAGE_KEYS.lineup, JSON.stringify(state.lineup));
  localStorage.setItem(STORAGE_KEYS.savedGames, JSON.stringify(state.savedGames));
  if (state.currentGame) {
    localStorage.setItem(STORAGE_KEYS.currentGame, JSON.stringify(state.currentGame));
  } else {
    localStorage.removeItem(STORAGE_KEYS.currentGame);
  }
  localStorage.setItem(STORAGE_KEYS.syncMeta, JSON.stringify({ updatedAt }));
  syncState.localUpdatedAt = updatedAt;
}

function buildStateSnapshot() {
  return {
    version: 1,
    roster: state.roster,
    lineupDraft: state.lineup,
    savedGames: state.savedGames,
    currentGame: state.currentGame,
  };
}

function applyStateSnapshot(snapshot) {
  state.roster = Array.isArray(snapshot?.roster) ? snapshot.roster : [];
  state.lineup = Array.isArray(snapshot?.lineupDraft)
    ? snapshot.lineupDraft
    : Array.isArray(snapshot?.lineup)
      ? snapshot.lineup
      : [];
  state.savedGames = normalizeSavedGames(snapshot?.savedGames || []);
  state.currentGame = normalizeGame(snapshot?.currentGame);
  state.editingEventIndex = null;
  state.selectedSavedGameIndex = 0;
}

function hasStateData(snapshot) {
  return Boolean(
    snapshot?.currentGame
      || snapshot?.roster?.length
      || snapshot?.lineupDraft?.length
      || snapshot?.lineup?.length
      || snapshot?.savedGames?.length,
  );
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
}

function updateCloudMessage(message) {
  if (cloudMessage) {
    cloudMessage.textContent = message;
  }
}

function queueCloudSave(updatedAt = new Date().toISOString()) {
  if (!isSupabaseConfigured()) {
    return;
  }

  syncState.pendingPayload = buildStateSnapshot();
  syncState.pendingUpdatedAt = updatedAt;

  if (!syncState.ready || !syncState.client) {
    updateCloudMessage("Cloud sync pending while the app initializes the shared cloud connection.");
    return;
  }

  window.clearTimeout(syncState.saveTimer);
  syncState.saveTimer = window.setTimeout(() => {
    void flushCloudSave();
  }, 400);
}

async function flushCloudSave() {
  if (!syncState.ready || !syncState.client || !syncState.pendingPayload) {
    return;
  }

  const payload = syncState.pendingPayload;
  const updatedAt = syncState.pendingUpdatedAt || new Date().toISOString();
  syncState.pendingPayload = null;
  syncState.pendingUpdatedAt = null;

  updateCloudMessage("Cloud sync saving...");

  const { error } = await syncState.client.from("app_state").upsert(
    {
      bucket: SHARED_STATE_BUCKET,
      payload,
      updated_at: updatedAt,
    },
    { onConflict: "bucket" },
  );

  if (error) {
    syncState.pendingPayload = payload;
    syncState.pendingUpdatedAt = updatedAt;
    updateCloudMessage(`Cloud sync unavailable: ${error.message}. Local saves still work.`);
    return;
  }

  updateCloudMessage("Cloud sync saved to Supabase.");
}

async function initializeSupabase() {
  if (!isSupabaseConfigured()) {
    updateCloudMessage("Cloud sync is off. Add your Supabase URL and anon key in src/supabaseConfig.js.");
    return;
  }

  try {
    updateCloudMessage("Cloud sync connecting...");
    syncState.client = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    syncState.ready = true;
    await syncFromCloud();

    if (syncState.pendingPayload) {
      await flushCloudSave();
    } else {
      updateCloudMessage("Cloud sync connected.");
    }
  } catch (error) {
    updateCloudMessage(`Cloud sync unavailable: ${getErrorMessage(error)}. Local saves still work.`);
  }
}

async function syncFromCloud() {
  if (!syncState.client) {
    return;
  }

  const localSnapshot = buildStateSnapshot();
  const localUpdatedAt = Date.parse(syncState.localUpdatedAt || 0);
  const { data, error } = await syncState.client
    .from("app_state")
    .select("payload, updated_at")
    .eq("bucket", SHARED_STATE_BUCKET)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const remoteUpdatedAt = Date.parse(data?.updated_at || 0);
  if (data?.payload && remoteUpdatedAt > localUpdatedAt) {
    applyStateSnapshot(data.payload);
    persistLocalState(data.updated_at);
    render();
    updateCloudMessage("Cloud sync loaded your latest Supabase data.");
    return;
  }

  if (hasStateData(localSnapshot) && (!data?.payload || localUpdatedAt >= remoteUpdatedAt)) {
    syncState.pendingPayload = localSnapshot;
    syncState.pendingUpdatedAt = syncState.localUpdatedAt || new Date().toISOString();
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function getRosterPlayer(playerId) {
  return state.roster.find((player) => player.id === playerId) ?? null;
}

function getActiveSlotPlayer(slot) {
  return slot.players.find((player) => player.id === slot.activePlayerId) ?? null;
}

function removePlayer(playerId) {
  state.roster = state.roster.filter((player) => player.id !== playerId);
  state.lineup = state.lineup.filter((entry) => entry.playerId !== playerId);
  persistState();
  render();
}

function addLineupPlayer(playerId) {
  if (state.lineup.length >= 12 || state.lineup.some((entry) => entry.playerId === playerId)) {
    return;
  }
  state.lineup.push({ playerId, position: "" });
  persistState();
  render();
}

function moveLineupPlayer(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= state.lineup.length) {
    return;
  }
  const [entry] = state.lineup.splice(index, 1);
  state.lineup.splice(nextIndex, 0, entry);
  persistState();
  render();
}

function removeLineupPlayer(playerId) {
  state.lineup = state.lineup.filter((entry) => entry.playerId !== playerId);
  persistState();
  render();
}

function updateLineupPosition(index, position) {
  if (!state.lineup[index]) {
    return;
  }
  state.lineup[index].position = position;
  persistState();
}

function buildGameLineup() {
  return state.lineup.map((entry, index) => {
    const player = getRosterPlayer(entry.playerId);
    if (!player) {
      throw new Error(`Lineup slot ${index + 1} is not tied to a valid roster player.`);
    }
    return {
      player,
      position: entry.position,
    };
  });
}

function buildDraftGameLineup() {
  return state.lineup.flatMap((entry) => {
    const player = getRosterPlayer(entry.playerId);
    return player ? [{ player, position: entry.position }] : [];
  });
}

function getAvailablePositions() {
  return state.lineup.length === 12 ? [...FIELD_POSITIONS, "DH"] : FIELD_POSITIONS;
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
              <td><button class="danger" type="button" data-remove-player="${player.id}">Remove</button></td>
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
  const lineupFull = state.lineup.length >= 12;
  lineupPool.innerHTML = state.roster.length
    ? state.roster
        .map((player) => {
          const disabled = state.lineup.some((entry) => entry.playerId === player.id) || lineupFull ? "disabled" : "";
          return `<button type="button" ${disabled} data-add-lineup="${player.id}">${escapeHtml(player.name)}</button>`;
        })
        .join("")
    : `<p class="muted">Add roster players first.</p>`;

  lineupPool.querySelectorAll("[data-add-lineup]").forEach((button) => {
    button.addEventListener("click", () => addLineupPlayer(button.dataset.addLineup));
  });

  const availablePositions = getAvailablePositions();
  dailyLineup.innerHTML = state.lineup.length
    ? state.lineup
        .map((entry, index) => {
          const player = getRosterPlayer(entry.playerId);
          if (!player) {
            return "";
          }
          const positionOptions = ["", ...availablePositions]
            .map(
              (position) =>
                `<option value="${position}" ${entry.position === position ? "selected" : ""}>${position || "Choose position"}</option>`,
            )
            .join("");
          return `
            <li>
              <div class="lineup-slot">
                <div class="slot-header">
                  <div>
                    <strong>${index + 1}. ${escapeHtml(player.name)}</strong>
                    <div class="muted">${escapeHtml(player.gender)} · ${escapeHtml(player.positions.join(", ") || "No preferred positions")}</div>
                  </div>
                  <span class="slot-rule">${getSlotRule(index + 1, state.lineup.length)}</span>
                </div>
                <div class="grid two-up">
                  <label>
                    <span>Game position</span>
                    <select data-slot-position="${index}">${positionOptions}</select>
                  </label>
                  <div class="button-row compact">
                    <button type="button" data-move-up="${index}">↑</button>
                    <button type="button" data-move-down="${index}">↓</button>
                    <button type="button" class="danger" data-remove-lineup="${player.id}">Remove</button>
                  </div>
                </div>
              </div>
            </li>
          `;
        })
        .join("")
    : `<li class="muted">No lineup selected yet.</li>`;

  dailyLineup.querySelectorAll("[data-slot-position]").forEach((select) => {
    select.addEventListener("change", () => updateLineupPosition(Number(select.dataset.slotPosition), select.value));
  });
  dailyLineup.querySelectorAll("[data-move-up]").forEach((button) => {
    button.addEventListener("click", () => moveLineupPlayer(Number(button.dataset.moveUp), -1));
  });
  dailyLineup.querySelectorAll("[data-move-down]").forEach((button) => {
    button.addEventListener("click", () => moveLineupPlayer(Number(button.dataset.moveDown), 1));
  });
  dailyLineup.querySelectorAll("[data-remove-lineup]").forEach((button) => {
    button.addEventListener("click", () => removeLineupPlayer(button.dataset.removeLineup));
  });

  renderLineupSummary();
}

function renderLineupSummary() {
  const lineup = buildDraftGameLineup();
  const size = lineup.length;
  const validation = validateLineup(lineup);
  const femaleSlots = size === 10 ? [3, 6, 9] : size === 12 ? [3, 6, 9, 12] : [];
  const femaleSlotHits = lineup.reduce((count, entry, index) => {
    return count + (femaleSlots.includes(index + 1) && entry.player.gender === "Female" ? 1 : 0);
  }, 0);
  const femaleInfielders = lineup.filter(
    (entry) => entry.player.gender === "Female" && ["P", "C", "1B", "2B", "3B", "SS"].includes(entry.position),
  ).length;
  const femaleOutfielders = lineup.filter(
    (entry) => entry.player.gender === "Female" && ["LF", "LCF", "RCF", "RF"].includes(entry.position),
  ).length;
  const dhBreakdown = lineup.reduce(
    (summary, entry) => {
      if (entry.position !== "DH") {
        return summary;
      }
      if (entry.player.gender === "Female") {
        summary.female += 1;
      } else {
        summary.male += 1;
      }
      return summary;
    },
    { female: 0, male: 0 },
  );

  if (!size) {
    lineupSummary.innerHTML = `<p class="muted">Add players to the lineup to see the ASA checks.</p>`;
    return;
  }

  const summaryItems = [
    { label: "Players", value: `${size}/10 or 12`, good: size === 10 || size === 12 },
    { label: "Female batting slots", value: `${femaleSlotHits}/${femaleSlots.length || "?"}`, good: femaleSlots.length > 0 && femaleSlotHits === femaleSlots.length },
    { label: "Female infielders", value: String(femaleInfielders), good: femaleInfielders >= 1 },
    { label: "Female outfielders", value: String(femaleOutfielders), good: femaleOutfielders >= 1 },
    { label: "DH split", value: size === 12 ? `${dhBreakdown.female}F / ${dhBreakdown.male}M` : "Not used", good: size !== 12 || (dhBreakdown.female === 1 && dhBreakdown.male === 1) },
  ];

  lineupSummary.innerHTML = `
    <div class="summary-grid">
      ${summaryItems
        .map(
          (item) => `
            <div class="summary-pill ${item.good ? "good" : "bad"}">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
    ${validation.valid ? `<p class="summary-message success">Lineup passes the current ASA checks.</p>` : `<p class="summary-message">${escapeHtml(validation.errors[0])}</p>`}
  `;
}

function renderTracker() {
  const game = state.currentGame;
  trackerEmpty.classList.toggle("hidden", Boolean(game));
  trackerContent.classList.toggle("hidden", !game);

  if (!game) {
    return;
  }

  const teamAtBat = isTeamAtBat(game);
  const battingPreview = getBattingPreview(game, 3);

  scoreboard.innerHTML = `
    <div class="score-compact">
      <div class="score-team-row">
        <div class="score-chip your-team">
          <span>${escapeHtml(normalizeTeamName(game.teamName))}</span>
          <strong>${game.score.team}</strong>
        </div>
        <div class="score-chip opponent-team">
          <span>${escapeHtml(game.opponentName)}</span>
          <strong>${game.score.opponent}</strong>
        </div>
      </div>
      <div class="score-meta-row">
        <span>${game.half === "top" ? "Top" : "Bottom"} ${game.inning}</span>
        <span>${game.outs} out${game.outs === 1 ? "" : "s"}</span>
        <span>${teamAtBat ? `${escapeHtml(normalizeTeamName(game.teamName))} batting` : `${escapeHtml(game.opponentName)} batting`}</span>
      </div>
      ${renderDiamond(game.bases)}
    </div>
  `;

  atBatCard.innerHTML = teamAtBat
    ? `
      <h3>Batting order</h3>
      <p><strong>${escapeHtml(battingPreview[0]?.name || "Unknown")}</strong> is currently up to hit.</p>
      <p><strong>${escapeHtml(battingPreview[1]?.name || "Unknown")}</strong> is on deck.</p>
      <p><strong>${escapeHtml(battingPreview[2]?.name || "Unknown")}</strong> is in the hole.</p>
    `
    : `
      <h3>Next up for ${escapeHtml(normalizeTeamName(game.teamName))}</h3>
      <p><strong>${escapeHtml(battingPreview[0]?.name || "Unknown")}</strong> will lead off next inning.</p>
      <p><strong>${escapeHtml(battingPreview[1]?.name || "Unknown")}</strong> is on deck.</p>
      <p><strong>${escapeHtml(battingPreview[2]?.name || "Unknown")}</strong> is in the hole.</p>
    `;

  currentHitterSelect.innerHTML = game.lineup
    .map((slot, index) => {
      const activePlayer = getActiveSlotPlayer(slot);
      return `<option value="${index}" ${index === game.batterIndex ? "selected" : ""}>${slot.slot}. ${escapeHtml(activePlayer?.name || "Unknown")}</option>`;
    })
    .join("");
  currentOutsSelect.value = String(game.outs);

  teamOffensePanel.classList.toggle("hidden", !teamAtBat);
  opponentPanel.classList.toggle("hidden", teamAtBat);
  actionPanelTitle.textContent = teamAtBat ? "Your offense" : "Opponent half inning";

  playButtons.innerHTML = PLAY_DEFINITIONS.map(
    (play) => `<button type="button" data-play="${play.key}">${play.label}</button>`,
  ).join("");
  playButtons.querySelectorAll("[data-play]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.currentGame) {
        return;
      }
      trackerMessage.textContent = "";
      try {
        state.currentGame = recordPlay(state.currentGame, {
          playKey: button.dataset.play,
          rbi: Number(playRbiInput.value),
          extraOuts: Number(playExtraOutsInput.value),
        });
        state.editingEventIndex = null;
        playRbiInput.value = "0";
        playExtraOutsInput.value = "0";
        persistState();
        render();
      } catch (error) {
        trackerMessage.textContent = error instanceof Error ? error.message : "Could not record that play.";
      }
    });
  });

  renderEventLog(game);
  renderSubstitutionOptions(game);
  renderEditPanel(game);
  undoLastButtons.forEach((button) => {
    button.disabled = game.eventHistory.length === 0;
  });
}

function renderDiamond(bases) {
  return `
    <div class="diamond-board">
      <div class="diamond-shape">
        <span class="diamond-base second ${bases.second ? "occupied" : ""}">${bases.second ? escapeHtml(bases.second.name) : "2B"}</span>
        <span class="diamond-base third ${bases.third ? "occupied" : ""}">${bases.third ? escapeHtml(bases.third.name) : "3B"}</span>
        <span class="diamond-base first ${bases.first ? "occupied" : ""}">${bases.first ? escapeHtml(bases.first.name) : "1B"}</span>
        <span class="diamond-home">HOME</span>
      </div>
    </div>
  `;
}

function getBattingPreview(game, count) {
  return Array.from({ length: count }, (_, offset) => {
    const slot = game.lineup[(game.batterIndex + offset) % game.lineup.length];
    return getActiveSlotPlayer(slot);
  }).filter(Boolean);
}

function renderEventLog(game) {
  const items = game.events.map((event, index) => ({ event, index })).reverse();
  eventLog.innerHTML = items.length
    ? items
        .map(({ event, index }) => {
          const detail = event.type === "play"
            ? `${event.batter.name} · RBI ${event.rbi}${event.extraOuts ? ` · ${event.extraOuts} extra out${event.extraOuts === 1 ? "" : "s"}` : ""}${event.runsScored.length ? ` · ${event.runsScored.length} run${event.runsScored.length === 1 ? "" : "s"} scored` : ""}`
            : event.type === "opponent-half"
              ? `${event.runs} opponent run${event.runs === 1 ? "" : "s"}`
              : event.type === "state-adjustment"
                ? `Batter ${event.batterIndex + 1} · Outs ${event.outs}`
                : `${event.fromPlayer.name} -> ${event.toPlayer.name}`;
          const canEdit = event.type === "play" || event.type === "opponent-half" || event.type === "state-adjustment";
          return `
            <li>
              <div class="event-row">
                <div>
                  <strong>${escapeHtml(event.half === "top" ? "Top" : "Bottom")} ${event.inning} · ${escapeHtml(getEventLabel(event))}</strong>
                  <div class="muted">${escapeHtml(detail)} · Score ${event.scoreAfterEvent.team}-${event.scoreAfterEvent.opponent}</div>
                </div>
                <div class="button-row compact">
                  ${canEdit ? `<button type="button" data-edit-event="${index}">Edit</button>` : ""}
                  <button type="button" class="danger" data-delete-event="${index}">Delete</button>
                </div>
              </div>
            </li>
          `;
        })
        .join("")
    : `<li class="muted">No events recorded yet.</li>`;

  eventLog.querySelectorAll("[data-edit-event]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingEventIndex = Number(button.dataset.editEvent);
      render();
    });
  });
  eventLog.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.currentGame) {
        return;
      }
      state.currentGame = deleteEvent(state.currentGame, Number(button.dataset.deleteEvent));
      state.editingEventIndex = null;
      persistState();
      render();
    });
  });
}

function renderSubstitutionOptions(game) {
  subLineupIndex.innerHTML = game.lineup
    .map((slot, index) => {
      const active = getActiveSlotPlayer(slot);
      const partner = slot.players.find((player) => player.id !== slot.activePlayerId);
      const rotationTag = slot.autoRotate && partner ? ` · rotates with ${partner.name}` : partner ? ` · partner ${partner.name}` : "";
      const label = `${slot.slot}. ${active?.name ?? "Unknown"} · ${slot.position}${rotationTag}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const selectedIndex = Number(subLineupIndex.value || 0);
  const selectedSlot = game.lineup[selectedIndex] ?? game.lineup[0];
  const usedIds = new Set(
    game.lineup.flatMap((slot, index) => (index === selectedIndex ? [] : slot.players.map((player) => player.id))),
  );
  const inactivePartnerId = selectedSlot?.players.find((player) => player.id !== selectedSlot.activePlayerId)?.id;

  const playerOptions = state.roster.filter((player) => !usedIds.has(player.id) && player.id !== selectedSlot?.activePlayerId);
  subPlayerId.innerHTML = playerOptions.length
    ? playerOptions
        .map(
          (player) =>
            `<option value="${player.id}" ${player.id === inactivePartnerId ? "selected" : ""}>${escapeHtml(player.name)} (${escapeHtml(player.gender)})</option>`,
        )
        .join("")
    : `<option value="">No eligible partner available</option>`;
  subForm.querySelector('button[type="submit"]').disabled = !playerOptions.length;
  subLineupIndex.onchange = () => renderSubstitutionOptions(game);
}

function renderEditPanel(game) {
  const event = state.editingEventIndex === null ? null : game.eventHistory[state.editingEventIndex];
  editPanel.classList.toggle("hidden", !event || event.type === "substitution");
  editMessage.textContent = "";

  if (!event || event.type === "substitution") {
    return;
  }

  if (event.type === "play") {
    const playOptions = PLAY_DEFINITIONS
      .map(
        (play) =>
          `<option value="${play.key}" ${play.key === event.playKey ? "selected" : ""}>${play.label}</option>`,
      )
      .join("");
    editFields.innerHTML = `
      <label>
        <span>Play result</span>
        <select name="playKey">${playOptions}</select>
      </label>
      <label>
        <span>RBI</span>
        <input name="rbi" type="number" min="0" max="4" value="${event.rbi}" />
      </label>
      <label>
        <span>Extra runner outs</span>
        <input name="extraOuts" type="number" min="0" max="3" value="${event.extraOuts ?? 0}" />
      </label>
    `;
    return;
  }

  if (event.type === "state-adjustment") {
    editFields.innerHTML = `
      <label>
        <span>Current hitter</span>
        <select name="batterIndex">
          ${game.lineup
            .map((slot, index) => {
              const activePlayer = getActiveSlotPlayer(slot);
              return `<option value="${index}" ${index === event.batterIndex ? "selected" : ""}>${slot.slot}. ${escapeHtml(activePlayer?.name || "Unknown")}</option>`;
            })
            .join("")}
        </select>
      </label>
      <label>
        <span>Outs</span>
        <select name="outs">
          <option value="0" ${event.outs === 0 ? "selected" : ""}>0</option>
          <option value="1" ${event.outs === 1 ? "selected" : ""}>1</option>
          <option value="2" ${event.outs === 2 ? "selected" : ""}>2</option>
        </select>
      </label>
    `;
    return;
  }

  editFields.innerHTML = `
    <label>
      <span>Opponent runs</span>
      <input name="runs" type="number" min="0" value="${event.runs}" />
    </label>
  `;
}

function renderStats() {
  const stats = sortStats(buildPlayerStats(buildStatsRoster(), state.savedGames));
  const record = buildRecord(state.savedGames);
  const teamRuns = state.savedGames.reduce((sum, game) => sum + (game.score?.team ?? 0), 0);

  statsSummary.innerHTML = `
    <div class="summary-card summary-card-large"><span>Team record</span><strong>${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}</strong></div>
    <div class="summary-card"><span>Saved games</span><strong>${state.savedGames.length}</strong></div>
    <div class="summary-card"><span>Team runs scored</span><strong>${teamRuns}</strong></div>
    <div class="summary-card"><span>Rostered players</span><strong>${state.roster.length}</strong></div>
  `;

  statsTable.innerHTML = stats.length
    ? stats
        .map(
          (player) => `
            <tr>
              <td>${escapeHtml(player.name)}</td>
              <td>${player.gamesPlayed}</td>
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
    : `<tr><td colspan="12" class="muted">Finish and save at least one game to generate stats.</td></tr>`;

  sortButtons.forEach((button) => {
    const active = button.dataset.sortKey === state.statsSort.key;
    const direction = active ? (state.statsSort.direction === "asc" ? " ↑" : " ↓") : "";
    button.textContent = `${button.dataset.label}${direction}`;
  });

  renderSavedGames();
}

function buildStatsRoster() {
  const players = new Map(state.roster.map((player) => [player.id, player]));

  state.savedGames.forEach((game) => {
    game.lineup?.forEach((slot) => {
      slot.players?.forEach((player) => {
        if (!players.has(player.id)) {
          players.set(player.id, {
            id: player.id,
            name: player.name,
            gender: player.gender,
            positions: Array.isArray(player.positions) ? [...player.positions] : [],
          });
        }
      });
    });
  });

  return [...players.values()];
}

function buildRecord(games) {
  return games.reduce(
    (record, game) => {
      if ((game.score?.team ?? 0) > (game.score?.opponent ?? 0)) {
        record.wins += 1;
      } else if ((game.score?.team ?? 0) < (game.score?.opponent ?? 0)) {
        record.losses += 1;
      } else {
        record.ties += 1;
      }
      return record;
    },
    { wins: 0, losses: 0, ties: 0 },
  );
}

function sortStats(stats) {
  const { key, direction } = state.statsSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...stats].sort((left, right) => {
    const leftValue = normalizeSortValue(left[key]);
    const rightValue = normalizeSortValue(right[key]);
    if (leftValue < rightValue) {
      return -1 * multiplier;
    }
    if (leftValue > rightValue) {
      return 1 * multiplier;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeSortValue(value) {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    return value.toLowerCase();
  }
  return value;
}

function renderSavedGames() {
  if (!state.savedGames.length) {
    savedGamesList.innerHTML = `<li class="muted">No completed games saved yet.</li>`;
    savedGameDetail.innerHTML = `<p class="muted">Finish a game to review its final score and event log here.</p>`;
    return;
  }

  state.selectedSavedGameIndex = Math.min(state.selectedSavedGameIndex, state.savedGames.length - 1);
  savedGamesList.innerHTML = state.savedGames
    .map((game, index) => {
      const result = getGameResult(game);
      return `
        <li>
          <button type="button" class="saved-game-button ${index === state.selectedSavedGameIndex ? "active" : ""}" data-saved-game="${index}">
            <strong>${escapeHtml(formatSavedGameLabel(game))}</strong>
            <span>${result} · ${game.score.team}-${game.score.opponent}</span>
          </button>
        </li>
      `;
    })
    .join("");

  savedGamesList.querySelectorAll("[data-saved-game]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSavedGameIndex = Number(button.dataset.savedGame);
      renderStats();
    });
  });

  const game = state.savedGames[state.selectedSavedGameIndex];
  savedGameDetail.innerHTML = `
    <div class="saved-game-summary">
      <strong>${escapeHtml(normalizeTeamName(game.teamName))} ${game.score.team}, ${escapeHtml(game.opponentName)} ${game.score.opponent}</strong>
      <p class="muted">${escapeHtml(formatSavedGameLabel(game))} · ${getGameResult(game)}</p>
    </div>
    <ul class="saved-game-events">
      ${game.events.length
        ? game.events
            .map(
              (event) => `
                <li>
                  <strong>${escapeHtml(event.half === "top" ? "Top" : "Bottom")} ${event.inning} · ${escapeHtml(getEventLabel(event))}</strong>
                  <div class="muted">Score ${event.scoreAfterEvent.team}-${event.scoreAfterEvent.opponent}</div>
                </li>
              `,
            )
            .join("")
        : `<li class="muted">No logged events were saved for this game.</li>`}
    </ul>
  `;
}

function formatSavedGameLabel(game) {
  const date = game.completedAt || game.events.at(-1)?.createdAt;
  const formattedDate = date ? new Date(date).toLocaleDateString() : "Saved game";
  return `${formattedDate} vs ${game.opponentName}`;
}

function getGameResult(game) {
  if (game.score.team > game.score.opponent) {
    return "Win";
  }
  if (game.score.team < game.score.opponent) {
    return "Loss";
  }
  return "Tie";
}

function getSlotRule(slotNumber, lineupSize) {
  if (lineupSize === 10 || lineupSize === 12) {
    const femaleSlots = lineupSize === 10 ? [3, 6, 9] : [3, 6, 9, 12];
    return femaleSlots.includes(slotNumber) ? "Girl slot" : "Guy slot";
  }
  return "Set batting slot";
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
void initializeSupabase();
