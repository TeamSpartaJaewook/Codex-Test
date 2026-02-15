(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const minimapCanvas = document.getElementById('minimapCanvas');
  if (!canvas || !minimapCanvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  const miniCtx = minimapCanvas.getContext('2d');

  const mineralValueEl = document.getElementById('mineralValue');
  const populationValueEl = document.getElementById('populationValue');
  const waveValueEl = document.getElementById('waveValue');
  const timeValueEl = document.getElementById('timeValue');
  const toastEl = document.getElementById('toast');
  const waveBannerEl = document.getElementById('waveBanner');

  const cardOverlayEl = document.getElementById('cardOverlay');
  const cardListEl = document.getElementById('cardList');
  const upgradeOverlayEl = document.getElementById('upgradeOverlay');
  const upgradeListEl = document.getElementById('upgradeList');
  const barracksOverlayEl = document.getElementById('barracksOverlay');
  const barracksInfoEl = document.getElementById('barracksInfo');
  const barracksUpgradeButton = document.getElementById('barracksUpgradeButton');
  const lobbyOverlayEl = document.getElementById('lobbyOverlay');
  const nicknameInputEl = document.getElementById('nicknameInput');
  const startGameButton = document.getElementById('startGameButton');
  const bestRecordSummaryEl = document.getElementById('bestRecordSummary');
  const rankingBodyEl = document.getElementById('rankingBody');
  const gameOverOverlayEl = document.getElementById('gameOverOverlay');

  const upgradeOpenButton = document.getElementById('upgradeOpenButton');
  const spawnWorkerButton = document.getElementById('spawnWorkerButton');
  const upgradeCloseButton = document.getElementById('upgradeCloseButton');
  const barracksCloseButton = document.getElementById('barracksCloseButton');
  const centerCameraButton = document.getElementById('centerCameraButton');
  const restartButton = document.getElementById('restartButton');

  const slotButtons = Array.from(document.querySelectorAll('.slotBtn'));
  const mobileActionButtons = Array.from(document.querySelectorAll('.mobileAction'));

  const joystickZone = document.getElementById('joystickZone');
  const joystickBase = document.getElementById('joystickBase');
  const joystickKnob = document.getElementById('joystickKnob');
  const apiBaseMeta = document.querySelector('meta[name="api-base"]');
  const API_BASE = (apiBaseMeta && typeof apiBaseMeta.content === 'string' ? apiBaseMeta.content : '').trim();

  const TILE = 32;
  const MAP_COLS = 72;
  const MAP_ROWS = 48;
  const MAP_SIZE = MAP_COLS * MAP_ROWS;
  const WORLD_W = MAP_COLS * TILE;
  const WORLD_H = MAP_ROWS * TILE;

  const BUILD_RANGE = 120;
  const VISION_RADIUS_PLAYER = 7;
  const VISION_RADIUS_UNIT = 4;

  const PHASE_BUILD = 'build';
  const PHASE_COMBAT = 'combat';
  const PHASE_REWARD = 'reward';
  const PHASE_GAMEOVER = 'gameover';

  const TEAM_FRIENDLY = 'friendly';
  const TEAM_ENEMY = 'enemy';

  const MANUAL_WORKER_COST = 45;
  const BARRACKS_MAX_LEVEL = 3;
  const LOBBY_NICK_KEY = 'mineral-survivor:nickname';
  const PLAYER_ID_MIN_LEN = 2;
  const PLAYER_ID_MAX_LEN = 16;

  const terrainBlocked = new Uint8Array(MAP_SIZE);
  const discovered = new Uint8Array(MAP_SIZE);
  const buildingTile = new Int32Array(MAP_SIZE);

  const buildings = [];
  const buildingsById = new Map();
  const minerals = [];
  const enemies = [];
  const soldiers = [];
  const miniScvs = [];
  const projectiles = [];
  const particles = [];
  const debris = [];
  const popups = [];

  let nextBuildingId = 1;
  let nextMineralId = 1;
  let nextEnemyId = 1;
  let nextUnitId = 1;

  const BUILD_TYPES = {
    command: { name: '커맨드 센터', cost: 360, w: 2, h: 2, hp: 3200, color: '#53f18a' },
    barracks: { name: '병영', cost: 130, w: 1, h: 1, hp: 760, color: '#66b8ff' },
    turret: { name: '방어 타워', cost: 120, w: 1, h: 1, hp: 620, color: '#ffc85b' },
    wall: { name: '성벽', cost: 50, w: 1, h: 1, hp: 1500, color: '#9daab6' },
    supply: { name: '인구 증가 타워', cost: 115, w: 1, h: 1, hp: 540, color: '#88ffde' },
    upgrade: { name: '업그레이드 타워', cost: 170, w: 1, h: 1, hp: 520, color: '#d487ff' },
  };

  const SLOT_TO_BUILD = {
    '1': 'barracks',
    '2': 'turret',
    '3': 'wall',
    '4': 'supply',
    '5': 'upgrade',
    '6': 'command',
  };

  const UPGRADE_DEFS = [
    {
      key: 'attack',
      name: '공격력',
      desc: '모든 아군 유닛 공격력 +12%',
      baseCost: 130,
    },
    {
      key: 'defense',
      name: '방어력',
      desc: '모든 아군 유닛 방어력 +1',
      baseCost: 120,
    },
    {
      key: 'hp',
      name: '최대 체력',
      desc: '모든 아군 유닛 최대 체력 +15%',
      baseCost: 140,
    },
    {
      key: 'speed',
      name: '이동속도',
      desc: '모든 아군 유닛 이동속도 +10%',
      baseCost: 110,
    },
  ];

  const CARD_POOL = [
    {
      id: 'tower_range',
      title: '정밀 포탑',
      desc: '타워 사거리 +10%',
      apply: () => {
        state.bonuses.towerRange += 0.1;
      },
    },
    {
      id: 'scv_mining',
      title: '채굴 알고리즘',
      desc: 'SCV 채굴 속도 +20%',
      apply: () => {
        state.bonuses.mineSpeed += 0.2;
      },
    },
    {
      id: 'heal_all',
      title: '재정비',
      desc: '모든 아군 유닛 체력 100% 회복',
      apply: () => {
        healAllFriendly(1);
      },
    },
    {
      id: 'rapid_train',
      title: '병영 자동화',
      desc: '병영 생산 속도 +18%',
      apply: () => {
        state.bonuses.barracksRate += 0.18;
      },
    },
    {
      id: 'turret_damage',
      title: '과충전 탄환',
      desc: '타워 공격력 +20%',
      apply: () => {
        state.bonuses.turretDamage += 0.2;
      },
    },
    {
      id: 'wall_fortify',
      title: '강화 합금',
      desc: '성벽 최대 체력 +30%',
      apply: () => {
        state.bonuses.wallHp += 0.3;
        refreshWallHp();
      },
    },
    {
      id: 'supply_drop',
      title: '인구 보너스',
      desc: '최대 인구 +4',
      apply: () => {
        state.extraPop += 4;
        recalcPopulationLimit();
      },
    },
    {
      id: 'mineral_rain',
      title: '미네랄 보급',
      desc: '즉시 미네랄 +220',
      apply: () => {
        gainResources(220);
      },
    },
    {
      id: 'base_repair',
      title: '기지 복구',
      desc: '커맨드 센터 체력 30% 회복',
      apply: () => {
        if (!state.commandCenter) return;
        const add = state.commandCenter.maxHp * 0.3;
        state.commandCenter.hp = clamp(state.commandCenter.hp + add, 0, state.commandCenter.maxHp);
      },
    },
  ];

  const state = {
    viewW: 1280,
    viewH: 720,
    miniW: 220,
    miniH: 160,

    resources: 320,
    wave: 1,
    phase: PHASE_BUILD,
    phaseTimer: 40,
    waveSpawnTotal: 0,
    waveSpawnRemain: 0,
    spawnCooldown: 0,
    spawnInterval: 1,
    spawnBurst: 1,
    bossSpawned: false,
    runTime: 0,
    killCount: 0,
    totalMineralsEarned: 0,
    recordSaved: false,
    inLobby: true,
    playerId: '',
    serverRanking: [],
    startPending: false,

    buildMode: null,
    cardOptions: [],
    selectedCardIndex: 0,

    upgrades: {
      attack: 0,
      defense: 0,
      hp: 0,
      speed: 0,
    },

    bonuses: {
      towerRange: 0,
      mineSpeed: 0,
      barracksRate: 0,
      turretDamage: 0,
      wallHp: 0,
    },

    extraPop: 0,
    populationLimit: 10,

    pointer: {
      inside: false,
      sx: 0,
      sy: 0,
      wx: 0,
      wy: 0,
    },

    joystick: {
      active: false,
      pointerId: -1,
      x: 0,
      y: 0,
    },

    keys: Object.create(null),

    camera: {
      x: 0,
      y: 0,
    },

    toastTimer: 0,
    bannerTimer: 0,
    centerCameraTimer: 0,

    minimapRedrawCd: 0,

    commandCenter: null,

    player: {
      id: 1,
      entityKind: 'player',
      x: 0,
      y: 0,
      r: 11,
      baseSpeed: 185,
      baseDamage: 14,
      baseDefense: 1,
      baseMaxHp: 240,
      defense: 1,
      maxHp: 240,
      hp: 240,
      facingAngle: 0,
      flash: 0,
      mineTargetId: 0,
      mineProgress: 0,
      dustCd: 0,
    },

    baseAlertCd: 0,
    upgradePanelOpen: false,
    barracksPanelOpen: false,
    selectedBarracksId: 0,
    audioUnlocked: false,
    bgmStarted: false,
    bgmPulseTimer: 0,
    bgmStep: 0,
  };

  let lastTime = performance.now();
  let audioCtx = null;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(randRange(min, max + 1));
  }

  function gainResources(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    state.resources += amount;
    state.totalMineralsEarned += amount;
  }

  function spendResources(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return true;
    if (state.resources < amount) return false;
    state.resources -= amount;
    return true;
  }

  function formatTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}:${String(rs).padStart(2, '0')}`;
  }

  function sortRanking(list) {
    return list.sort((a, b) => {
      if ((b.wave || 0) !== (a.wave || 0)) return (b.wave || 0) - (a.wave || 0);
      if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
      if ((b.minerals || 0) !== (a.minerals || 0)) return (b.minerals || 0) - (a.minerals || 0);
      return (b.timeSec || 0) - (a.timeSec || 0);
    });
  }

  function apiUrl(path) {
    if (!API_BASE) return path;
    const base = API_BASE.replace(/\/+$/, '');
    if (!path) return base;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function apiRequest(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };

    const res = await fetch(apiUrl(path), init);
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }

    if (!res.ok) {
      const e = new Error((data && data.error) || '서버 요청 실패');
      e.code = data && data.code ? data.code : `HTTP_${res.status}`;
      throw e;
    }
    return data || {};
  }

  function renderLobbyRanking() {
    if (!rankingBodyEl || !bestRecordSummaryEl) return;
    const list = sortRanking((state.serverRanking || []).slice());

    rankingBodyEl.innerHTML = '';
    if (list.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan=\"6\">기록이 없습니다.</td>';
      rankingBodyEl.appendChild(tr);
      bestRecordSummaryEl.textContent = '최고기록: -';
      return;
    }

    const best = list[0];
    bestRecordSummaryEl.textContent =
      `최고기록: ${best.playerId || 'SCV'} | ${formatTime(best.timeSec || 0)} | W${best.wave || 0} | 처치 ${best.kills || 0} | 자원 ${Math.floor(best.minerals || 0)}`;

    const top = list.slice(0, 12);
    for (let i = 0; i < top.length; i += 1) {
      const r = top[i];
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${r.playerId || 'SCV'}</td>` +
        `<td>${formatTime(r.timeSec || 0)}</td>` +
        `<td>${r.wave || 0}</td>` +
        `<td>${r.kills || 0}</td>` +
        `<td>${Math.floor(r.minerals || 0)}</td>`;
      rankingBodyEl.appendChild(tr);
    }
  }

  async function fetchRankingFromServer() {
    if (!rankingBodyEl || !bestRecordSummaryEl) return;
    bestRecordSummaryEl.textContent = '랭킹 불러오는 중...';
    rankingBodyEl.innerHTML = '<tr><td colspan="6">서버에서 랭킹을 불러오는 중...</td></tr>';
    try {
      const data = await apiRequest('/api/rankings');
      state.serverRanking = Array.isArray(data.rankings) ? data.rankings : [];
      renderLobbyRanking();
    } catch (err) {
      state.serverRanking = [];
      rankingBodyEl.innerHTML = '<tr><td colspan="6">서버 연결 실패</td></tr>';
      bestRecordSummaryEl.textContent = '최고기록: -';
    }
  }

  async function registerPlayerId(playerId) {
    return apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  }

  async function submitScoreToServer(payload) {
    return apiRequest('/api/score', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function getNickname() {
    const inputName = (nicknameInputEl ? nicknameInputEl.value : '').trim();
    if (inputName) return inputName.slice(0, 16);
    const saved = (localStorage.getItem(LOBBY_NICK_KEY) || '').trim();
    if (saved) return saved.slice(0, 16);
    return 'SCV';
  }

  function saveNickname(name) {
    try {
      localStorage.setItem(LOBBY_NICK_KEY, name);
    } catch (err) {
      // ignore
    }
  }

  function saveCurrentRecord() {
    if (state.recordSaved) return;
    state.recordSaved = true;

    const waveReached = Math.max(1, state.wave);
    const record = {
      playerId: state.playerId || getNickname(),
      timeSec: Math.floor(state.runTime),
      wave: waveReached,
      kills: state.killCount,
      minerals: Math.floor(state.totalMineralsEarned),
    };

    submitScoreToServer(record)
      .then(() => fetchRankingFromServer())
      .catch(() => {
        showToast('랭킹 서버 저장 실패', 1.2);
      });
  }

  function showLobby() {
    state.inLobby = true;
    state.startPending = false;
    state.buildMode = null;
    updateSlotButtonState();
    closeUpgradeOverlay();
    closeBarracksOverlay();
    closeCardOverlay();
    closeGameOverOverlay();

    if (nicknameInputEl) {
      const saved = (localStorage.getItem(LOBBY_NICK_KEY) || '').trim();
      nicknameInputEl.value = saved ? saved.slice(0, 16) : '';
    }

    if (lobbyOverlayEl) {
      lobbyOverlayEl.classList.remove('hidden');
      lobbyOverlayEl.setAttribute('aria-hidden', 'false');
    }
    if (startGameButton) {
      startGameButton.disabled = false;
      startGameButton.textContent = '게임 시작';
    }
    fetchRankingFromServer();
  }

  function hideLobby() {
    state.inLobby = false;
    if (lobbyOverlayEl) {
      lobbyOverlayEl.classList.add('hidden');
      lobbyOverlayEl.setAttribute('aria-hidden', 'true');
    }
  }

  async function startGameFromLobby() {
    if (state.startPending) return;
    const nickname = getNickname();
    if (nickname.length < PLAYER_ID_MIN_LEN) {
      showToast(`아이디는 ${PLAYER_ID_MIN_LEN}자 이상이어야 합니다`, 1.4);
      return;
    }
    if (nickname.length > PLAYER_ID_MAX_LEN) {
      showToast(`아이디는 ${PLAYER_ID_MAX_LEN}자 이하여야 합니다`, 1.4);
      return;
    }

    state.startPending = true;
    if (startGameButton) {
      startGameButton.disabled = true;
      startGameButton.textContent = '확인 중...';
    }

    try {
      await registerPlayerId(nickname);
    } catch (err) {
      if (err.code === 'ID_EXISTS') {
        showToast('이미 존재하는 아이디입니다. 다른 아이디를 입력하세요.', 1.8);
      } else {
        showToast('서버에 연결할 수 없습니다', 1.6);
      }
      state.startPending = false;
      if (startGameButton) {
        startGameButton.disabled = false;
        startGameButton.textContent = '게임 시작';
      }
      return;
    }

    saveNickname(nickname);
    if (nicknameInputEl) nicknameInputEl.value = nickname;

    hideLobby();
    resetGame();
    state.playerId = nickname;

    if (!state.audioUnlocked) {
      ensureAudioContext();
      state.audioUnlocked = true;
    }
    startBgm();

    state.startPending = false;
    if (startGameButton) {
      startGameButton.disabled = false;
      startGameButton.textContent = '게임 시작';
    }
  }

  function toIndex(c, r) {
    return r * MAP_COLS + c;
  }

  function inBounds(c, r) {
    return c >= 0 && c < MAP_COLS && r >= 0 && r < MAP_ROWS;
  }

  function tileCenterX(c) {
    return c * TILE + TILE * 0.5;
  }

  function tileCenterY(r) {
    return r * TILE + TILE * 0.5;
  }

  function worldToTileX(x) {
    return Math.floor(x / TILE);
  }

  function worldToTileY(y) {
    return Math.floor(y / TILE);
  }

  function visibleWorldRect() {
    return {
      x: state.camera.x,
      y: state.camera.y,
      w: state.viewW,
      h: state.viewH,
    };
  }

  function isRectVisible(x, y, w, h) {
    const vr = visibleWorldRect();
    return x + w >= vr.x && x <= vr.x + vr.w && y + h >= vr.y && y <= vr.y + vr.h;
  }

  function rebuildBuildingTileMap() {
    buildingTile.fill(0);
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      for (let ry = 0; ry < b.h; ry += 1) {
        for (let rx = 0; rx < b.w; rx += 1) {
          const c = b.c + rx;
          const r = b.r + ry;
          if (!inBounds(c, r)) continue;
          buildingTile[toIndex(c, r)] = b.id;
        }
      }
    }
  }

  function getBuildingAtTile(c, r) {
    if (!inBounds(c, r)) return null;
    const id = buildingTile[toIndex(c, r)];
    if (!id) return null;
    return buildingsById.get(id) || null;
  }

  function getMineralAtTile(c, r) {
    for (let i = 0; i < minerals.length; i += 1) {
      const m = minerals[i];
      if (m.total <= 0) continue;
      if (m.c === c && m.r === r) return m;
    }
    return null;
  }

  function terrainAt(c, r) {
    if (!inBounds(c, r)) return 1;
    return terrainBlocked[toIndex(c, r)];
  }

  function clearTerrainCircle(cx, cy, radius) {
    const r2 = radius * radius;
    for (let r = Math.max(0, cy - radius); r <= Math.min(MAP_ROWS - 1, cy + radius); r += 1) {
      for (let c = Math.max(0, cx - radius); c <= Math.min(MAP_COLS - 1, cx + radius); c += 1) {
        const dc = c - cx;
        const dr = r - cy;
        if (dc * dc + dr * dr <= r2) {
          terrainBlocked[toIndex(c, r)] = 0;
        }
      }
    }
  }

  function clearTerrainRect(c0, r0, w, h) {
    for (let r = r0; r < r0 + h; r += 1) {
      for (let c = c0; c < c0 + w; c += 1) {
        if (inBounds(c, r)) {
          terrainBlocked[toIndex(c, r)] = 0;
        }
      }
    }
  }

  function generateMapTerrain() {
    terrainBlocked.fill(0);
    discovered.fill(0);

    for (let r = 0; r < MAP_ROWS; r += 1) {
      for (let c = 0; c < MAP_COLS; c += 1) {
        const edge = c <= 1 || c >= MAP_COLS - 2 || r <= 1 || r >= MAP_ROWS - 2;
        if (edge) {
          terrainBlocked[toIndex(c, r)] = 0;
          continue;
        }
        const noise = (Math.sin(c * 0.31) + Math.cos(r * 0.27)) * 0.03;
        const chance = 0.105 + noise;
        terrainBlocked[toIndex(c, r)] = Math.random() < chance ? 1 : 0;
      }
    }

    const firstPass = terrainBlocked.slice();
    for (let r = 1; r < MAP_ROWS - 1; r += 1) {
      for (let c = 1; c < MAP_COLS - 1; c += 1) {
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            count += firstPass[toIndex(c + ox, r + oy)];
          }
        }
        if (count >= 5) {
          terrainBlocked[toIndex(c, r)] = 1;
        } else if (count <= 2) {
          terrainBlocked[toIndex(c, r)] = 0;
        }
      }
    }

    for (let r = 4; r < MAP_ROWS - 4; r += 8) {
      clearTerrainRect(2, r, MAP_COLS - 4, 2);
    }

    for (let c = 5; c < MAP_COLS - 5; c += 10) {
      clearTerrainRect(c, 2, 2, MAP_ROWS - 4);
    }

    const midC = Math.floor(MAP_COLS / 2);
    const midR = Math.floor(MAP_ROWS / 2);
    clearTerrainCircle(midC, midR, 8);

    for (let i = 0; i < 14; i += 1) {
      const cx = randInt(5, MAP_COLS - 6);
      const cy = randInt(5, MAP_ROWS - 6);
      const rw = randInt(2, 4);
      const rh = randInt(2, 4);
      for (let r = cy; r < cy + rh; r += 1) {
        for (let c = cx; c < cx + rw; c += 1) {
          if (inBounds(c, r)) terrainBlocked[toIndex(c, r)] = 1;
        }
      }
    }

    clearTerrainCircle(midC, midR, 8);
  }

  function generateMinerals() {
    minerals.length = 0;

    const centerX = WORLD_W * 0.5;
    const centerY = WORLD_H * 0.5;
    const maxDist = Math.hypot(centerX, centerY);

    let created = 0;
    let tries = 0;

    while (created < 165 && tries < 10000) {
      tries += 1;

      const c = randInt(2, MAP_COLS - 3);
      const r = randInt(2, MAP_ROWS - 3);
      if (terrainAt(c, r)) continue;

      const x = tileCenterX(c);
      const y = tileCenterY(r);
      const dToCenter = dist(x, y, centerX, centerY);
      if (dToCenter < 210) continue;
      if (getMineralAtTile(c, r)) continue;

      let tooClose = false;
      for (let i = 0; i < minerals.length; i += 1) {
        const m = minerals[i];
        if (dist2(m.x, m.y, x, y) < 24 * 24) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const norm = clamp(dToCenter / maxDist, 0, 1);
      const difficulty = 1 + norm * 2.7;
      const total = Math.floor(120 + norm * 360 + Math.random() * 110);
      const chunk = Math.floor(9 + norm * 16);

      minerals.push({
        id: nextMineralId += 1,
        c,
        r,
        x,
        y,
        radius: 11 + norm * 4,
        total,
        chunk,
        difficulty,
        flash: 0,
      });
      created += 1;
    }
  }

  function addBuilding(type, c, r, level = 1, options = {}) {
    const def = BUILD_TYPES[type];
    if (!def) return null;

    const b = {
      id: nextBuildingId += 1,
      entityKind: 'building',
      team: TEAM_FRIENDLY,
      type,
      c,
      r,
      w: def.w,
      h: def.h,
      level,
      maxHp: getBuildingMaxHp(type, level),
      hp: 1,
      defense: 0,
      flash: 0,
      shootCd: randRange(0, 0.4),
      spawnCd: type === 'barracks' ? 30 : randRange(2, 4),
      hologram: 0,
      isMainCommand: !!options.isMainCommand,
    };

    b.hp = b.maxHp;

    buildings.push(b);
    buildingsById.set(b.id, b);

    if (type === 'command' && (!state.commandCenter || options.isMainCommand)) {
      state.commandCenter = b;
    }

    rebuildBuildingTileMap();
    ejectMiniScvsFromBuilding(b);
    recalcPopulationLimit();
    return b;
  }

  function removeBuilding(b) {
    if (b === state.commandCenter) {
      state.commandCenter = null;
    }
    if (state.selectedBarracksId === b.id) {
      closeBarracksOverlay();
    }
    const idx = buildings.indexOf(b);
    if (idx >= 0) {
      buildings.splice(idx, 1);
    }
    buildingsById.delete(b.id);
    rebuildBuildingTileMap();
    recalcPopulationLimit();
  }

  function getBuildingCenter(b) {
    return {
      x: (b.c + b.w * 0.5) * TILE,
      y: (b.r + b.h * 0.5) * TILE,
    };
  }

  function getAllCommandCenters() {
    return buildings.filter((b) => b.type === 'command');
  }

  function getNearestCommandCenter(x, y) {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (b.type !== 'command') continue;
      const bp = getBuildingCenter(b);
      const d2v = dist2(x, y, bp.x, bp.y);
      if (d2v < bestD2) {
        bestD2 = d2v;
        best = b;
      }
    }
    return best;
  }

  function getBuildingMaxHp(type, level) {
    const def = BUILD_TYPES[type];
    if (!def) return 1;

    let hp = def.hp * (1 + (level - 1) * 0.52);
    if (type === 'wall') {
      hp *= 1 + state.bonuses.wallHp;
    }
    return Math.round(hp);
  }

  function refreshWallHp() {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (b.type !== 'wall') continue;
      const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
      b.maxHp = getBuildingMaxHp('wall', b.level);
      b.hp = clamp(Math.round(b.maxHp * ratio), 1, b.maxHp);
    }
  }

  function recalcPopulationLimit() {
    const supplyCount = buildings.filter((b) => b.type === 'supply').length;
    state.populationLimit = 10 + state.extraPop + supplyCount * 5;
  }

  function getPopulationUsed() {
    return soldiers.length + miniScvs.length;
  }

  function getAttackMultiplier() {
    return 1 + state.upgrades.attack * 0.12;
  }

  function getDefenseBonus() {
    return state.upgrades.defense;
  }

  function getHpMultiplier() {
    return 1 + state.upgrades.hp * 0.15;
  }

  function getSpeedMultiplier() {
    return 1 + state.upgrades.speed * 0.1;
  }

  function getMineSpeedMultiplier() {
    return 1 + state.bonuses.mineSpeed;
  }

  function getWaveEaseMultiplier(wave) {
    if (wave <= 1) return 0.4;
    if (wave === 2) return 0.56;
    if (wave === 3) return 0.7;
    if (wave === 4) return 0.8;
    if (wave === 5) return 0.88;
    if (wave === 6) return 0.94;
    if (wave === 7) return 0.97;
    if (wave === 8) return 0.99;
    return 1;
  }

  function getWaveBuildDuration(wave) {
    if (wave <= 1) return 40;
    const base = Math.max(8, 18 - wave * 0.18);
    if (wave === 2) return base + 4;
    if (wave === 3) return base + 2;
    if (wave === 4) return base + 1;
    return base;
  }

  function getWaveEnemyStatScale(wave) {
    const ease = getWaveEaseMultiplier(wave);
    return 1 + wave * 0.2 * (0.58 + ease * 0.42);
  }

  function getWaveSpawnConfig(wave) {
    const ease = getWaveEaseMultiplier(wave);
    const baseTotal = Math.floor(16 + wave * 5.4);
    const baseInterval = Math.max(0.13, 0.72 - wave * 0.012);
    const baseBurst = Math.min(6, 2 + Math.floor(wave / 5));

    const total = Math.max(8, Math.floor(baseTotal * ease));
    const interval = Math.max(0.15, baseInterval * (1 + (1 - ease) * 1.15));

    let burst = Math.max(1, Math.round(baseBurst * (0.55 + ease * 0.45)));
    burst = Math.min(baseBurst, burst);
    if (wave === 1) burst = 1;

    return {
      total,
      interval,
      burst,
      combatDuration: 56 + Math.min(40, wave * 1.8),
    };
  }

  function refreshFriendlyDerivedStats() {
    state.player.maxHp = Math.round(state.player.baseMaxHp * getHpMultiplier());
    state.player.hp = clamp(state.player.hp, 1, state.player.maxHp);
    state.player.defense = state.player.baseDefense + getDefenseBonus();

    for (let i = 0; i < soldiers.length; i += 1) {
      const s = soldiers[i];
      const hpRatio = s.maxHp > 0 ? s.hp / s.maxHp : 1;
      s.maxHp = Math.round(s.baseMaxHp * getHpMultiplier());
      s.hp = clamp(Math.round(s.maxHp * hpRatio), 1, s.maxHp);
      s.defense = s.baseDefense + getDefenseBonus();
    }

    for (let i = 0; i < miniScvs.length; i += 1) {
      const scv = miniScvs[i];
      const hpRatio = scv.maxHp > 0 ? scv.hp / scv.maxHp : 1;
      scv.maxHp = Math.round(scv.baseMaxHp * getHpMultiplier());
      scv.hp = clamp(Math.round(scv.maxHp * hpRatio), 1, scv.maxHp);
      scv.defense = scv.baseDefense + getDefenseBonus();
    }
  }

  function healAllFriendly(ratio = 1) {
    state.player.hp = clamp(state.player.maxHp * ratio, 1, state.player.maxHp);
    for (let i = 0; i < soldiers.length; i += 1) {
      soldiers[i].hp = clamp(soldiers[i].maxHp * ratio, 1, soldiers[i].maxHp);
    }
    for (let i = 0; i < miniScvs.length; i += 1) {
      miniScvs[i].hp = clamp(miniScvs[i].maxHp * ratio, 1, miniScvs[i].maxHp);
    }
  }

  function showToast(text, duration = 1.45) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    state.toastTimer = duration;
  }

  function showBanner(text, duration = 1.75) {
    waveBannerEl.textContent = text;
    waveBannerEl.classList.remove('hidden');
    state.bannerTimer = duration;
  }

  function ensureAudioContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtx = new AudioCtx();
  }

  function playTone(freq, duration = 0.08, type = 'sine', gain = 0.03) {
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp);
    amp.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playSfx(name) {
    if (!state.audioUnlocked) return;
    if (!audioCtx) return;

    switch (name) {
      case 'build':
        playTone(460, 0.09, 'square', 0.03);
        playTone(620, 0.12, 'square', 0.02);
        break;
      case 'mine':
        playTone(840, 0.05, 'triangle', 0.03);
        break;
      case 'shot':
        playTone(300, 0.04, 'sawtooth', 0.02);
        break;
      case 'explode':
        playTone(120, 0.12, 'sawtooth', 0.04);
        playTone(72, 0.16, 'triangle', 0.028);
        break;
      case 'wave':
        playTone(260, 0.08, 'square', 0.03);
        playTone(380, 0.1, 'square', 0.025);
        break;
      case 'card':
        playTone(520, 0.08, 'triangle', 0.024);
        playTone(700, 0.12, 'triangle', 0.018);
        break;
      case 'error':
        playTone(180, 0.08, 'sawtooth', 0.03);
        break;
      case 'alert':
        playTone(180, 0.15, 'sine', 0.014);
        playTone(260, 0.15, 'sine', 0.01);
        break;
      default:
        break;
    }
  }

  function startBgm() {
    if (!state.audioUnlocked || !audioCtx) return;
    state.bgmStarted = true;
    state.bgmPulseTimer = 0;
  }

  function updateBgm(dt) {
    if (!state.bgmStarted) return;
    if (!state.audioUnlocked || !audioCtx) return;

    state.bgmPulseTimer -= dt;
    if (state.bgmPulseTimer > 0) return;

    const combatPattern = [130.81, 164.81, 196, 220, 196, 164.81];
    const buildPattern = [130.81, 146.83, 174.61, 146.83];
    const lobbyPattern = [110, 138.59, 164.81, 138.59];

    let pattern = buildPattern;
    if (state.inLobby) pattern = lobbyPattern;
    else if (state.phase === PHASE_COMBAT) pattern = combatPattern;

    const freq = pattern[state.bgmStep % pattern.length];
    state.bgmStep += 1;

    const inCombat = state.phase === PHASE_COMBAT && !state.inLobby;
    playTone(freq, inCombat ? 0.24 : 0.28, 'triangle', inCombat ? 0.03 : 0.02);
    if (state.bgmStep % 2 === 0) {
      playTone(freq * 0.5, inCombat ? 0.24 : 0.3, 'sine', inCombat ? 0.014 : 0.01);
    }

    if (state.inLobby) {
      state.bgmPulseTimer = 0.48;
    } else if (inCombat) {
      state.bgmPulseTimer = 0.22;
    } else {
      state.bgmPulseTimer = 0.34;
    }
  }

  function announceBaseAttack() {
    if (state.baseAlertCd > 0) return;
    state.baseAlertCd = 7.5;
    showToast('Base is under attack', 1.9);
    playSfx('alert');

    if ('speechSynthesis' in window) {
      try {
        const msg = new SpeechSynthesisUtterance('Base is under attack');
        msg.lang = 'en-US';
        msg.rate = 1;
        msg.pitch = 0.75;
        msg.volume = 0.35;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(msg);
      } catch (err) {
        // ignore
      }
    }
  }

  function resetGame() {
    buildings.length = 0;
    buildingsById.clear();
    minerals.length = 0;
    enemies.length = 0;
    soldiers.length = 0;
    miniScvs.length = 0;
    projectiles.length = 0;
    particles.length = 0;
    debris.length = 0;
    popups.length = 0;

    nextBuildingId = 1;
    nextMineralId = 1;
    nextEnemyId = 1;
    nextUnitId = 1;

    state.resources = 320;
    state.wave = 1;
    state.runTime = 0;
    state.killCount = 0;
    state.totalMineralsEarned = 0;
    state.recordSaved = false;
    state.phase = PHASE_BUILD;
    state.phaseTimer = getWaveBuildDuration(1);
    state.waveSpawnRemain = 0;
    state.waveSpawnTotal = 0;
    state.spawnCooldown = 0;
    state.spawnInterval = 1;
    state.spawnBurst = 1;
    state.bossSpawned = false;
    state.buildMode = null;
    state.cardOptions = [];
    state.selectedCardIndex = 0;

    state.upgrades.attack = 0;
    state.upgrades.defense = 0;
    state.upgrades.hp = 0;
    state.upgrades.speed = 0;

    state.bonuses.towerRange = 0;
    state.bonuses.mineSpeed = 0;
    state.bonuses.barracksRate = 0;
    state.bonuses.turretDamage = 0;
    state.bonuses.wallHp = 0;

    state.extraPop = 0;
    state.populationLimit = 10;

    state.toastTimer = 0;
    toastEl.classList.remove('show');
    state.bannerTimer = 0;
    waveBannerEl.classList.add('hidden');
    state.centerCameraTimer = 0;
    state.baseAlertCd = 0;
    state.barracksPanelOpen = false;
    state.selectedBarracksId = 0;
    state.keys = Object.create(null);

    state.commandCenter = null;

    state.player.baseSpeed = 185;
    state.player.baseDamage = 14;
    state.player.baseDefense = 1;
    state.player.baseMaxHp = 240;
    state.player.maxHp = 240;
    state.player.hp = 240;
    state.player.defense = 1;
    state.player.flash = 0;
    state.player.mineTargetId = 0;
    state.player.mineProgress = 0;
    state.player.dustCd = 0;
    state.player.facingAngle = 0;

    generateMapTerrain();
    generateMinerals();

    const midC = Math.floor(MAP_COLS / 2) - 1;
    const midR = Math.floor(MAP_ROWS / 2) - 1;

    addBuilding('command', midC, midR, 1, { isMainCommand: true });
    state.player.x = tileCenterX(midC + 1);
    state.player.y = tileCenterY(midR + 3);

    revealAround(state.player.x, state.player.y, VISION_RADIUS_PLAYER + 2);

    closeCardOverlay();
    closeUpgradeOverlay();
    closeBarracksOverlay();
    closeGameOverOverlay();

    refreshFriendlyDerivedStats();
    recalcPopulationLimit();
    updateSlotButtonState();
    showBanner('Wave 1 준비', 1.7);
    updateHud();
  }

  function revealAround(x, y, radiusTile) {
    const c0 = worldToTileX(x);
    const r0 = worldToTileY(y);
    const rr = radiusTile * radiusTile;

    for (let r = r0 - radiusTile; r <= r0 + radiusTile; r += 1) {
      for (let c = c0 - radiusTile; c <= c0 + radiusTile; c += 1) {
        if (!inBounds(c, r)) continue;
        const dc = c - c0;
        const dr = r - r0;
        if (dc * dc + dr * dr > rr) continue;
        discovered[toIndex(c, r)] = 1;
      }
    }
  }

  function screenToWorld(sx, sy) {
    return {
      x: sx + state.camera.x,
      y: sy + state.camera.y,
    };
  }

  function updatePointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left);
    const sy = (e.clientY - rect.top);

    state.pointer.inside = sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height;
    state.pointer.sx = sx;
    state.pointer.sy = sy;

    const world = screenToWorld(sx, sy);
    state.pointer.wx = world.x;
    state.pointer.wy = world.y;
  }

  function getMoveInput() {
    let x = 0;
    let y = 0;

    if (state.keys.KeyA || state.keys.ArrowLeft) x -= 1;
    if (state.keys.KeyD || state.keys.ArrowRight) x += 1;
    if (state.keys.KeyW || state.keys.ArrowUp) y -= 1;
    if (state.keys.KeyS || state.keys.ArrowDown) y += 1;

    x += state.joystick.x;
    y += state.joystick.y;

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    return { x, y, mag: len };
  }

  function circleRectIntersect(cx, cy, cr, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy <= cr * cr;
  }

  function canCircleMove(x, y, r) {
    const minC = worldToTileX(x - r);
    const maxC = worldToTileX(x + r);
    const minR = worldToTileY(y - r);
    const maxR = worldToTileY(y + r);

    for (let tr = minR; tr <= maxR; tr += 1) {
      for (let tc = minC; tc <= maxC; tc += 1) {
        if (!inBounds(tc, tr)) return false;
        if (terrainAt(tc, tr)) {
          const rx = tc * TILE;
          const ry = tr * TILE;
          if (circleRectIntersect(x, y, r, rx, ry, TILE, TILE)) return false;
        }

        const bid = buildingTile[toIndex(tc, tr)];
        if (bid) {
          const b = buildingsById.get(bid);
          if (b) {
            const rx = b.c * TILE;
            const ry = b.r * TILE;
            const rw = b.w * TILE;
            const rh = b.h * TILE;
            if (circleRectIntersect(x, y, r, rx, ry, rw, rh)) return false;
          }
        }
      }
    }

    return true;
  }

  function moveEntityWithCollision(entity, vx, vy, dt) {
    const nx = entity.x + vx * dt;
    const ny = entity.y + vy * dt;

    if (canCircleMove(nx, entity.y, entity.r)) {
      entity.x = nx;
    }
    if (canCircleMove(entity.x, ny, entity.r)) {
      entity.y = ny;
    }

    entity.x = clamp(entity.x, entity.r, WORLD_W - entity.r);
    entity.y = clamp(entity.y, entity.r, WORLD_H - entity.r);
  }

  function moveEntityGhost(entity, vx, vy, dt) {
    entity.x += vx * dt;
    entity.y += vy * dt;
    entity.x = clamp(entity.x, entity.r, WORLD_W - entity.r);
    entity.y = clamp(entity.y, entity.r, WORLD_H - entity.r);
  }

  function moveEntityGhostToward(entity, tx, ty, speed, dt) {
    const dx = tx - entity.x;
    const dy = ty - entity.y;
    const d = Math.hypot(dx, dy);
    if (d <= 0.0001) return 0;
    const nx = dx / d;
    const ny = dy / d;
    entity.facingAngle = Math.atan2(ny, nx);
    moveEntityGhost(entity, nx * speed, ny * speed, dt);
    return d;
  }

  function findFreePositionAround(cx, cy, radius, minDist = 18, maxDist = 56, tries = 28) {
    for (let i = 0; i < tries; i += 1) {
      const ang = randRange(0, Math.PI * 2);
      const distV = randRange(minDist, maxDist);
      const x = cx + Math.cos(ang) * distV;
      const y = cy + Math.sin(ang) * distV;
      if (x < radius || y < radius || x > WORLD_W - radius || y > WORLD_H - radius) continue;
      if (canCircleMove(x, y, radius)) {
        return { x, y };
      }
    }
    return { x: clamp(cx, radius, WORLD_W - radius), y: clamp(cy, radius, WORLD_H - radius) };
  }

  function hasFriendlyUnitOverlapRect(rx, ry, rw, rh) {
    for (let i = 0; i < miniScvs.length; i += 1) {
      const scv = miniScvs[i];
      if (circleRectIntersect(scv.x, scv.y, scv.r + 1, rx, ry, rw, rh)) return true;
    }
    for (let i = 0; i < soldiers.length; i += 1) {
      const s = soldiers[i];
      if (circleRectIntersect(s.x, s.y, s.r + 1, rx, ry, rw, rh)) return true;
    }
    return false;
  }

  function ejectMiniScvsFromBuilding(building) {
    const rx = building.c * TILE;
    const ry = building.r * TILE;
    const rw = building.w * TILE;
    const rh = building.h * TILE;
    const center = getBuildingCenter(building);
    const minDist = Math.max(rw, rh) * 0.5 + 14;
    const maxDist = minDist + 88;

    for (let i = 0; i < miniScvs.length; i += 1) {
      const scv = miniScvs[i];
      if (!circleRectIntersect(scv.x, scv.y, scv.r + 1, rx, ry, rw, rh)) continue;
      const pos = findFreePositionAround(center.x, center.y, scv.r, minDist, maxDist, 56);
      scv.x = pos.x;
      scv.y = pos.y;
      scv.path = [];
      scv.pathIndex = 0;
      scv.repathCd = 0;
      scv.stuckTimer = 0;
    }
  }

  function isEntityNearBuildingDock(entity, building, padding = 8) {
    if (!building) return false;
    const rx = building.c * TILE - padding;
    const ry = building.r * TILE - padding;
    const rw = building.w * TILE + padding * 2;
    const rh = building.h * TILE + padding * 2;
    return circleRectIntersect(entity.x, entity.y, entity.r, rx, ry, rw, rh);
  }

  function enemyPathTileBlocked(c, r, mode) {
    if (!inBounds(c, r)) return true;
    if (terrainAt(c, r)) return true;

    const b = getBuildingAtTile(c, r);
    if (!b) return false;

    if (b.type === 'wall') {
      return mode === 'strict';
    }

    return true;
  }

  function enemyPathTileCost(c, r, mode) {
    if (mode === 'wallSoft') {
      const b = getBuildingAtTile(c, r);
      if (b && b.type === 'wall') return 6;
    }
    return 1;
  }

  function aStar(startC, startR, goalC, goalR, mode) {
    const startKey = toIndex(startC, startR);
    const goalKey = toIndex(goalC, goalR);

    const open = [{ c: startC, r: startR, key: startKey, g: 0, f: 0 }];
    const openMap = new Map();
    openMap.set(startKey, open[0]);

    const cameFrom = new Map();
    const gScore = new Map();
    gScore.set(startKey, 0);

    const closed = new Set();

    function h(c, r) {
      return Math.abs(c - goalC) + Math.abs(r - goalR);
    }

    open[0].f = h(startC, startR);

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }

      const current = open.splice(bestIdx, 1)[0];
      openMap.delete(current.key);

      if (current.key === goalKey) {
        const path = [];
        let ck = current.key;
        while (cameFrom.has(ck)) {
          const c = ck % MAP_COLS;
          const r = Math.floor(ck / MAP_COLS);
          path.push({ c, r });
          ck = cameFrom.get(ck);
        }
        path.reverse();
        return path;
      }

      closed.add(current.key);

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (let i = 0; i < dirs.length; i += 1) {
        const nc = current.c + dirs[i][0];
        const nr = current.r + dirs[i][1];
        if (!inBounds(nc, nr)) continue;

        const nKey = toIndex(nc, nr);
        if (closed.has(nKey)) continue;

        if (enemyPathTileBlocked(nc, nr, mode)) continue;

        const tentativeG = current.g + enemyPathTileCost(nc, nr, mode);
        const bestG = gScore.has(nKey) ? gScore.get(nKey) : Infinity;

        if (tentativeG >= bestG) continue;

        cameFrom.set(nKey, current.key);
        gScore.set(nKey, tentativeG);

        const f = tentativeG + h(nc, nr);
        const existing = openMap.get(nKey);
        if (existing) {
          existing.g = tentativeG;
          existing.f = f;
          existing.c = nc;
          existing.r = nr;
        } else {
          const node = { c: nc, r: nr, key: nKey, g: tentativeG, f };
          open.push(node);
          openMap.set(nKey, node);
        }
      }
    }

    return null;
  }

  function getApproachTilesForBuilding(building, includeWallTiles = false) {
    const command = building;
    if (!command) return [];

    const tiles = [];

    for (let c = command.c - 1; c <= command.c + command.w; c += 1) {
      tiles.push({ c, r: command.r - 1 });
      tiles.push({ c, r: command.r + command.h });
    }

    for (let r = command.r; r < command.r + command.h; r += 1) {
      tiles.push({ c: command.c - 1, r });
      tiles.push({ c: command.c + command.w, r });
    }

    const result = [];
    for (let i = 0; i < tiles.length; i += 1) {
      const t = tiles[i];
      if (!inBounds(t.c, t.r)) continue;
      if (terrainAt(t.c, t.r)) continue;
      const b = getBuildingAtTile(t.c, t.r);
      if (b) {
        if (!includeWallTiles) continue;
        if (b.type !== 'wall') continue;
      }
      result.push(t);
    }

    return result;
  }

  function getCommandApproachTiles() {
    return getApproachTilesForBuilding(state.commandCenter, true);
  }

  function getNearestApproachPoint(building, fromX, fromY) {
    const tiles = getApproachTilesForBuilding(building, false);
    if (tiles.length === 0) {
      const cp = getBuildingCenter(building);
      return { c: worldToTileX(cp.x), r: worldToTileY(cp.y), x: cp.x, y: cp.y };
    }

    let best = tiles[0];
    let bestD2 = Infinity;
    for (let i = 0; i < tiles.length; i += 1) {
      const t = tiles[i];
      const tx = tileCenterX(t.c);
      const ty = tileCenterY(t.r);
      const d2v = dist2(fromX, fromY, tx, ty);
      if (d2v < bestD2) {
        bestD2 = d2v;
        best = t;
      }
    }

    return { c: best.c, r: best.r, x: tileCenterX(best.c), y: tileCenterY(best.r) };
  }

  function findEnemyPath(enemy, mode) {
    const sc = worldToTileX(enemy.x);
    const sr = worldToTileY(enemy.y);

    const approaches = getCommandApproachTiles();
    if (approaches.length === 0) return null;

    let bestPath = null;

    for (let i = 0; i < approaches.length; i += 1) {
      const goal = approaches[i];
      const p = aStar(sc, sr, goal.c, goal.r, mode);
      if (!p) continue;
      if (!bestPath || p.length < bestPath.length) {
        bestPath = p;
      }
    }

    return bestPath;
  }

  function findFirstWallOnPath(path) {
    if (!path) return null;
    for (let i = 0; i < path.length; i += 1) {
      const t = path[i];
      const b = getBuildingAtTile(t.c, t.r);
      if (b && b.type === 'wall') return b;
    }
    return null;
  }

  function spawnEnemy(type) {
    const wave = state.wave;
    const edge = randInt(0, 3);

    let c = 0;
    let r = 0;
    if (edge === 0) {
      c = randInt(1, MAP_COLS - 2);
      r = 1;
    } else if (edge === 1) {
      c = randInt(1, MAP_COLS - 2);
      r = MAP_ROWS - 2;
    } else if (edge === 2) {
      c = 1;
      r = randInt(1, MAP_ROWS - 2);
    } else {
      c = MAP_COLS - 2;
      r = randInt(1, MAP_ROWS - 2);
    }

    if (terrainAt(c, r)) {
      for (let k = 0; k < 12; k += 1) {
        const nc = clamp(c + randInt(-2, 2), 1, MAP_COLS - 2);
        const nr = clamp(r + randInt(-2, 2), 1, MAP_ROWS - 2);
        if (!terrainAt(nc, nr)) {
          c = nc;
          r = nr;
          break;
        }
      }
    }

    const norm = getWaveEnemyStatScale(wave);

    let baseHp = 92;
    let baseSpeed = 64;
    let baseDamage = 20;
    let attackRange = 18;
    let shootRange = 0;

    if (type === 'ranged') {
      baseHp = 74;
      baseSpeed = 60;
      baseDamage = 18;
      shootRange = 195;
      attackRange = 28;
    } else if (type === 'charger') {
      baseHp = 118;
      baseSpeed = 84;
      baseDamage = 27;
      attackRange = 18;
    } else if (type === 'boss') {
      baseHp = 1350;
      baseSpeed = 56;
      baseDamage = 42;
      shootRange = 250;
      attackRange = 28;
    }

    const enemy = {
      id: nextEnemyId += 1,
      entityKind: 'enemy',
      team: TEAM_ENEMY,
      type,
      x: tileCenterX(c),
      y: tileCenterY(r),
      r: type === 'boss' ? 17 : 10,
      baseSpeed,
      speed: baseSpeed,
      damage: Math.round(baseDamage * norm),
      defense: 0,
      maxHp: Math.round(baseHp * norm),
      hp: Math.round(baseHp * norm),
      flash: 0,
      attackRange,
      shootRange,
      attackCd: randRange(0, 0.3),
      specialCd: randRange(1, 2),
      dashCd: randRange(1.6, 3),
      dashTimer: 0,
      path: [],
      pathIndex: 0,
      repathCd: 0,
      wallTargetId: 0,
    };

    enemies.push(enemy);
    return enemy;
  }

  function pickEnemyTypeByWave() {
    const w = state.wave;
    const roll = Math.random();

    if (w >= 8 && roll < Math.min(0.4, 0.26 + (w - 8) * 0.02)) return 'charger';
    if (w >= 4 && roll < Math.min(0.76, 0.62 + (w - 4) * 0.02)) return 'ranged';
    return 'grunt';
  }

  function spawnWaveEnemyPack(count = 1) {
    if (state.waveSpawnRemain <= 0) return;

    const spawnCount = Math.min(count, state.waveSpawnRemain);
    for (let i = 0; i < spawnCount; i += 1) {
      const type = pickEnemyTypeByWave();
      spawnEnemy(type);
      state.waveSpawnRemain -= 1;
    }

    if (state.wave % 10 === 0 && !state.bossSpawned) {
      const threshold = Math.floor(state.waveSpawnTotal * 0.5);
      if (state.waveSpawnRemain <= threshold) {
        spawnEnemy('boss');
        state.bossSpawned = true;
        showBanner(`WAVE ${state.wave} BOSS 출현`, 1.8);
      }
    }
  }

  function addParticle(x, y, vx, vy, life, size, color) {
    particles.push({ x, y, vx, vy, life, maxLife: life, size, color });
  }

  function addPopup(x, y, text, color = '#ffffff') {
    popups.push({ x, y, text, color, life: 0.95, vy: -22 });
  }

  function addDebris(x, y, size) {
    debris.push({
      x,
      y,
      size,
      life: 3.8,
      maxLife: 3.8,
      angle: randRange(0, Math.PI * 2),
    });
  }

  function damageTarget(target, rawDamage) {
    if (!target) return;
    if (target.hp <= 0) return;

    const damage = Math.max(1, Math.round(rawDamage - (target.defense || 0)));
    target.hp -= damage;
    target.flash = 0.13;

    for (let i = 0; i < 4; i += 1) {
      const ang = randRange(0, Math.PI * 2);
      addParticle(target.x || tileCenterX(target.c), target.y || tileCenterY(target.r), Math.cos(ang) * 60, Math.sin(ang) * 60, 0.24, 2, '#eaffff');
    }

    if (target.entityKind === 'building' && target.type === 'command') {
      announceBaseAttack();
    }

    if (target.hp > 0) return;

    if (target.entityKind === 'enemy') {
      const idx = enemies.indexOf(target);
      if (idx >= 0) enemies.splice(idx, 1);
      state.killCount += 1;
      gainResources(2);
      addPopup(target.x, target.y - 14, '+2', '#87ff9d');
      addDebris(target.x, target.y, 12);
      if (Math.random() < 0.28) {
        playSfx('explode');
      }
      return;
    }

    if (target.entityKind === 'soldier') {
      const idx = soldiers.indexOf(target);
      if (idx >= 0) soldiers.splice(idx, 1);
      addDebris(target.x, target.y, 10);
      playSfx('explode');
      return;
    }

    if (target.entityKind === 'miniScv') {
      const idx = miniScvs.indexOf(target);
      if (idx >= 0) miniScvs.splice(idx, 1);
      addDebris(target.x, target.y, 10);
      playSfx('explode');
      return;
    }

    if (target.entityKind === 'player') {
      state.resources = Math.max(0, state.resources - 60);
      target.hp = Math.max(1, Math.round(target.maxHp * 0.65));
      if (state.commandCenter) {
        const cc = getBuildingCenter(state.commandCenter);
        target.x = cc.x;
        target.y = cc.y + TILE * 2;
      }
      showToast('메인 SCV 파괴! 자원 -60', 1.65);
      playSfx('explode');
      return;
    }

    if (target.entityKind === 'building') {
      const pos = getBuildingCenter(target);
      addDebris(pos.x, pos.y, 20);
      for (let i = 0; i < 12; i += 1) {
        const ang = randRange(0, Math.PI * 2);
        const spd = randRange(40, 120);
        addParticle(pos.x, pos.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.52, 3, '#ffd9cf');
      }
      playSfx('explode');

      const wasMainCommand = target === state.commandCenter;
      removeBuilding(target);

      if (wasMainCommand) {
        enterGameOver();
      }
    }
  }

  function isFriendlyOverlayOpen() {
    return state.phase === PHASE_REWARD || state.upgradePanelOpen || state.barracksPanelOpen || state.phase === PHASE_GAMEOVER;
  }

  function findClosestEnemy(x, y, range) {
    let best = null;
    let bestD2 = range * range;

    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      const d2v = dist2(x, y, e.x, e.y);
      if (d2v < bestD2) {
        bestD2 = d2v;
        best = e;
      }
    }

    return best;
  }

  function getNearestCommandTarget(x, y) {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (b.type !== 'command') continue;
      const c = getBuildingCenter(b);
      const d2v = dist2(x, y, c.x, c.y);
      if (d2v < bestD2) {
        bestD2 = d2v;
        best = b;
      }
    }
    return best;
  }

  function pushEnemiesAwayFromScv(entity, dt, strength = 1) {
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      const minDist = entity.r + e.r + 2;
      const d = dist(entity.x, entity.y, e.x, e.y);
      if (d >= minDist) continue;

      const nx = (e.x - entity.x) / (d || 1);
      const ny = (e.y - entity.y) / (d || 1);
      const push = (minDist - d + 0.8) * (0.8 + strength * 0.35);

      const oldX = e.x;
      const oldY = e.y;
      e.x += nx * push * dt * 24;
      e.y += ny * push * dt * 24;
      e.x = clamp(e.x, e.r, WORLD_W - e.r);
      e.y = clamp(e.y, e.r, WORLD_H - e.r);
      if (!canCircleMove(e.x, e.y, e.r)) {
        e.x = oldX;
        e.y = oldY;
      }
    }
  }

  function spawnProjectile(x, y, tx, ty, speed, damage, team, color, radius = 3, life = 2.2) {
    let dx = tx - x;
    let dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    projectiles.push({
      x,
      y,
      vx: dx * speed,
      vy: dy * speed,
      damage,
      team,
      color,
      radius,
      life,
    });
  }

  function spawnSoldierFromBarracks(b) {
    const config = getBarracksConfig(b.level);
    const pop = getPopulationUsed();
    if (pop >= state.populationLimit) return;
    if (countSoldiersByBarracks(b.id) >= config.maxUnits) return;

    const level = b.level;
    const bp = getBuildingCenter(b);
    const spawnPos = findFreePositionAround(bp.x, bp.y, 9, 20, 52, 32);
    const x = spawnPos.x;
    const y = spawnPos.y;

    const s = {
      id: nextUnitId += 1,
      entityKind: 'soldier',
      team: TEAM_FRIENDLY,
      x,
      y,
      r: 9,
      level,
      sourceBarracksId: b.id,
      baseSpeed: 92 + level * 5 + config.statMul * 2,
      baseDamage: Math.round((11 + level * 4) * config.statMul),
      baseDefense: 0,
      baseMaxHp: Math.round((80 + level * 30) * config.statMul),
      defense: 0,
      maxHp: 1,
      hp: 1,
      range: 140 + level * 20,
      shootCd: randRange(0, 0.4),
      targetId: 0,
      flash: 0,
      homeX: x,
      homeY: y,
    };

    soldiers.push(s);
    refreshFriendlyDerivedStats();
  }

  function countSoldiersByBarracks(barracksId) {
    let count = 0;
    for (let i = 0; i < soldiers.length; i += 1) {
      if (soldiers[i].sourceBarracksId === barracksId) count += 1;
    }
    return count;
  }

  function getBarracksConfig(level) {
    if (level <= 1) {
      return { interval: 30, maxUnits: 4, statMul: 1 };
    }
    if (level === 2) {
      return { interval: 22, maxUnits: 6, statMul: 1.28 };
    }
    return { interval: 16, maxUnits: 8, statMul: 1.62 };
  }

  function getBarracksUpgradeCost(barracks) {
    return Math.round(170 + barracks.level * 180);
  }

  function spawnMiniScv(sourceCommandCenter = null) {
    const pop = getPopulationUsed();
    if (pop >= state.populationLimit) return;
    const commandCenter = sourceCommandCenter || getNearestCommandCenter(state.player.x, state.player.y) || state.commandCenter;
    if (!commandCenter) return;

    const cc = getBuildingCenter(commandCenter);

    const spawnPos = findFreePositionAround(cc.x, cc.y, 8, 24, 58, 32);

    const scv = {
      id: nextUnitId += 1,
      entityKind: 'miniScv',
      team: TEAM_FRIENDLY,
      x: spawnPos.x,
      y: spawnPos.y,
      r: 8,
      baseSpeed: 90,
      baseDamage: 4,
      baseDefense: 0,
      baseMaxHp: 70,
      defense: 0,
      maxHp: 1,
      hp: 1,
      flash: 0,
      facingAngle: randRange(0, Math.PI * 2),

      mode: 'search',
      targetMineralId: 0,
      carry: 0,
      mineProgress: 0,
      returnCommandId: commandCenter.id,
      stuckTimer: 0,
      repathFail: 0,
      lastX: spawnPos.x,
      lastY: spawnPos.y,

      path: [],
      pathIndex: 0,
      repathCd: 0,
    };

    miniScvs.push(scv);
    refreshFriendlyDerivedStats();
  }

  function trySpawnMiniScvManual() {
    if (state.phase === PHASE_GAMEOVER) return;
    if (isFriendlyOverlayOpen()) return;

    const command = getNearestCommandCenter(state.player.x, state.player.y) || state.commandCenter;
    if (!command) {
      showToast('커맨드 센터가 필요합니다', 1.2);
      return;
    }

    if (getPopulationUsed() >= state.populationLimit) {
      showToast('인구가 가득 찼습니다', 1.2);
      return;
    }

    if (state.resources < MANUAL_WORKER_COST) {
      showToast(`미네랄이 부족합니다 (필요: ${MANUAL_WORKER_COST})`, 1.2);
      return;
    }

    spendResources(MANUAL_WORKER_COST);
    spawnMiniScv(command);
    showToast('미니 SCV 생산 완료', 1.2);
    playSfx('build');
    updateHud();
  }

  function findMineralById(id) {
    for (let i = 0; i < minerals.length; i += 1) {
      if (minerals[i].id === id) return minerals[i];
    }
    return null;
  }

  function pickClosestMineral(x, y) {
    let best = null;
    let bestD2 = Infinity;

    for (let i = 0; i < minerals.length; i += 1) {
      const m = minerals[i];
      if (m.total <= 0) continue;
      const d2v = dist2(x, y, m.x, m.y);
      if (d2v < bestD2) {
        bestD2 = d2v;
        best = m;
      }
    }

    return best;
  }

  function pickReachableMineral(x, y, maxChecks = 8) {
    const sc = worldToTileX(x);
    const sr = worldToTileY(y);

    const candidates = [];
    for (let i = 0; i < minerals.length; i += 1) {
      const m = minerals[i];
      if (m.total <= 0) continue;
      candidates.push({ m, d2: dist2(x, y, m.x, m.y) });
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.d2 - b.d2);
    const checkCount = Math.min(maxChecks, candidates.length);

    for (let i = 0; i < checkCount; i += 1) {
      const target = candidates[i].m;
      if (sc === target.c && sr === target.r) return target;
      const p = aStar(sc, sr, target.c, target.r, 'strict');
      if (p && p.length > 0) return target;
    }

    return candidates[0].m;
  }

  function updateMiniScvPathToTile(scv, tc, tr) {
    const sc = worldToTileX(scv.x);
    const sr = worldToTileY(scv.y);
    if (sc === tc && sr === tr) {
      scv.path = [];
      scv.pathIndex = 0;
      return true;
    }
    const p = aStar(sc, sr, tc, tr, 'strict');

    scv.path = p || [];
    scv.pathIndex = 0;
    return scv.path.length > 0;
  }

  function updateMiniScvPathTo(scv, tx, ty) {
    return updateMiniScvPathToTile(scv, worldToTileX(tx), worldToTileY(ty));
  }

  function followTilePath(entity, speed, dt) {
    if (!entity.path || entity.path.length === 0) return false;

    const t = entity.path[entity.pathIndex];
    if (!t) return false;

    const tx = tileCenterX(t.c);
    const ty = tileCenterY(t.r);

    const dx = tx - entity.x;
    const dy = ty - entity.y;
    const d = Math.hypot(dx, dy);

    if (d < 6) {
      entity.pathIndex += 1;
      if (entity.pathIndex >= entity.path.length) {
        entity.path = [];
        entity.pathIndex = 0;
      }
      return true;
    }

    const nx = dx / (d || 1);
    const ny = dy / (d || 1);
    if (entity.entityKind === 'miniScv') {
      entity.facingAngle = Math.atan2(ny, nx);
    }
    moveEntityWithCollision(entity, nx * speed, ny * speed, dt);
    return true;
  }

  function getBuildPreviewAt(wx, wy) {
    if (!state.buildMode) return null;

    const type = state.buildMode;
    const def = BUILD_TYPES[type];
    if (!def) return null;

    let c = worldToTileX(wx);
    let r = worldToTileY(wy);

    c -= Math.floor(def.w / 2);
    r -= Math.floor(def.h / 2);

    const validation = validateBuildPlacement(type, c, r);

    return {
      type,
      c,
      r,
      w: def.w,
      h: def.h,
      ...validation,
    };
  }

  function getBuildUpgradeCost(building) {
    const base = BUILD_TYPES[building.type].cost;
    return Math.round(base * (1.35 + building.level * 0.75));
  }

  function validateBuildPlacement(type, c, r) {
    const def = BUILD_TYPES[type];
    if (!def) {
      return { valid: false, reason: 'invalid', cost: 0, upgradeTarget: null };
    }

    const centerX = (c + def.w * 0.5) * TILE;
    const centerY = (r + def.h * 0.5) * TILE;

    const distToPlayer = dist(state.player.x, state.player.y, centerX, centerY);
    if (distToPlayer > BUILD_RANGE) {
      return { valid: false, reason: 'range', cost: def.cost, upgradeTarget: null };
    }

    if (!inBounds(c, r) || !inBounds(c + def.w - 1, r + def.h - 1)) {
      return { valid: false, reason: 'bounds', cost: def.cost, upgradeTarget: null };
    }

    const placeX = c * TILE;
    const placeY = r * TILE;
    const placeW = def.w * TILE;
    const placeH = def.h * TILE;
    if (circleRectIntersect(state.player.x, state.player.y, state.player.r + 2, placeX, placeY, placeW, placeH)) {
      return { valid: false, reason: 'playerOverlap', cost: def.cost, upgradeTarget: null };
    }
    if (hasFriendlyUnitOverlapRect(placeX, placeY, placeW, placeH)) {
      return { valid: false, reason: 'unitOverlap', cost: def.cost, upgradeTarget: null };
    }

    const touchedIds = new Set();

    for (let ry = 0; ry < def.h; ry += 1) {
      for (let rx = 0; rx < def.w; rx += 1) {
        const tc = c + rx;
        const tr = r + ry;

        if (terrainAt(tc, tr)) {
          return { valid: false, reason: 'blocked', cost: def.cost, upgradeTarget: null };
        }

        const mineral = getMineralAtTile(tc, tr);
        if (mineral && mineral.total > 0) {
          return { valid: false, reason: 'mineral', cost: def.cost, upgradeTarget: null };
        }

        const existing = getBuildingAtTile(tc, tr);
        if (existing) {
          touchedIds.add(existing.id);
        }
      }
    }

    if (touchedIds.size === 0) {
      return { valid: true, reason: 'ok', cost: def.cost, upgradeTarget: null };
    }

    if (touchedIds.size === 1) {
      const target = buildingsById.get(Array.from(touchedIds)[0]);
      if (
        target &&
        target.type === type &&
        type === 'turret' &&
        target.level < 3 &&
        target.c === c &&
        target.r === r
      ) {
        return {
          valid: true,
          reason: 'upgrade',
          cost: getBuildUpgradeCost(target),
          upgradeTarget: target,
        };
      }
    }

    return { valid: false, reason: 'overlap', cost: def.cost, upgradeTarget: null };
  }

  function tryBuildAtPointer() {
    if (!state.buildMode) return;

    const preview = getBuildPreviewAt(state.pointer.wx, state.pointer.wy);
    if (!preview) return;

    if (!preview.valid) {
      if (preview.reason === 'overlap') {
        showToast('이 지역에는 건설할 수 없습니다', 1.3);
        playSfx('error');
      } else if (preview.reason === 'playerOverlap') {
        showToast('메인 SCV 위치에는 건설할 수 없습니다', 1.3);
        playSfx('error');
      } else if (preview.reason === 'unitOverlap') {
        showToast('유닛 위에는 건설할 수 없습니다', 1.3);
        playSfx('error');
      } else if (preview.reason === 'range') {
        showToast('메인 SCV 주변에서만 건설 가능합니다', 1.2);
        playSfx('error');
      } else if (preview.reason === 'mineral') {
        showToast('미네랄 위에는 건설할 수 없습니다', 1.2);
        playSfx('error');
      } else {
        showToast('건설 불가 지역입니다', 1.2);
        playSfx('error');
      }
      return;
    }

    if (!spendResources(preview.cost)) {
      showToast('미네랄이 부족합니다', 1.2);
      playSfx('error');
      return;
    }

    if (preview.upgradeTarget) {
      const b = preview.upgradeTarget;
      b.level += 1;
      b.maxHp = getBuildingMaxHp(b.type, b.level);
      b.hp = b.maxHp;
      b.flash = 0.2;
      showToast(`${BUILD_TYPES[b.type].name} Lv.${b.level} 업그레이드`, 1.3);
    } else {
      const newBuilding = addBuilding(preview.type, preview.c, preview.r, 1);
      if (newBuilding) {
        if (newBuilding.type === 'upgrade') {
          showToast('업그레이드 타워 가동 준비 완료', 1.4);
        } else {
          showToast(`${BUILD_TYPES[newBuilding.type].name} 건설 완료`, 1.2);
        }
      }
    }

    playSfx('build');
    updateHud();
  }

  function setBuildModeBySlot(slot) {
    if (state.inLobby || state.phase === PHASE_GAMEOVER) return;
    const type = SLOT_TO_BUILD[slot];
    if (!type) return;

    if (state.buildMode === type) {
      state.buildMode = null;
    } else {
      state.buildMode = type;
      showToast(`${BUILD_TYPES[type].name} 선택 - 클릭으로 설치`, 1.05);
    }
    updateSlotButtonState();
  }

  function updateSlotButtonState() {
    for (let i = 0; i < slotButtons.length; i += 1) {
      const btn = slotButtons[i];
      const slot = btn.dataset.slot;
      const type = SLOT_TO_BUILD[slot];
      const active = type && state.buildMode === type;
      btn.classList.toggle('active', active);
    }

    for (let i = 0; i < mobileActionButtons.length; i += 1) {
      const btn = mobileActionButtons[i];
      const slot = btn.dataset.slot;
      const type = SLOT_TO_BUILD[slot];
      const active = type && state.buildMode === type;
      btn.classList.toggle('active', active);
    }
  }

  function hasUpgradeTower() {
    return buildings.some((b) => b.type === 'upgrade');
  }

  function openUpgradeOverlay() {
    if (state.phase === PHASE_GAMEOVER) return;
    if (!hasUpgradeTower()) {
      showToast('업그레이드 타워를 먼저 건설하세요', 1.4);
      return;
    }

    closeBarracksOverlay();
    state.upgradePanelOpen = true;
    upgradeOverlayEl.classList.remove('hidden');
    upgradeOverlayEl.setAttribute('aria-hidden', 'false');
    renderUpgradeButtons();
  }

  function closeUpgradeOverlay() {
    state.upgradePanelOpen = false;
    upgradeOverlayEl.classList.add('hidden');
    upgradeOverlayEl.setAttribute('aria-hidden', 'true');
  }

  function getSelectedBarracks() {
    if (!state.selectedBarracksId) return null;
    const b = buildingsById.get(state.selectedBarracksId);
    if (!b || b.type !== 'barracks') return null;
    return b;
  }

  function openBarracksOverlay(barracks) {
    if (state.phase === PHASE_GAMEOVER) return;
    if (!barracks || barracks.type !== 'barracks') return;
    if (!barracksOverlayEl) return;
    closeUpgradeOverlay();
    state.selectedBarracksId = barracks.id;
    state.barracksPanelOpen = true;
    barracksOverlayEl.classList.remove('hidden');
    barracksOverlayEl.setAttribute('aria-hidden', 'false');
    renderBarracksOverlay();
  }

  function closeBarracksOverlay() {
    state.barracksPanelOpen = false;
    state.selectedBarracksId = 0;
    if (!barracksOverlayEl) return;
    barracksOverlayEl.classList.add('hidden');
    barracksOverlayEl.setAttribute('aria-hidden', 'true');
  }

  function renderBarracksOverlay() {
    const b = getSelectedBarracks();
    if (!b) {
      closeBarracksOverlay();
      return;
    }

    const config = getBarracksConfig(b.level);
    const soldierCount = countSoldiersByBarracks(b.id);
    const cost = getBarracksUpgradeCost(b);

    if (barracksInfoEl) {
      barracksInfoEl.innerHTML =
        `레벨: Lv.${b.level}<br>` +
        `병력 보유: ${soldierCount} / ${config.maxUnits}<br>` +
        `생산 주기: ${config.interval}초당 1기<br>` +
        `생산 병력 스탯 배율: x${config.statMul.toFixed(2)}<br>` +
        (b.level < BARRACKS_MAX_LEVEL ? `업그레이드 비용: ${cost} Mineral` : '최대 레벨입니다');
    }

    if (barracksUpgradeButton) {
      if (b.level >= BARRACKS_MAX_LEVEL) {
        barracksUpgradeButton.textContent = '최대 레벨';
        barracksUpgradeButton.disabled = true;
      } else {
        barracksUpgradeButton.textContent = `업그레이드 (비용 ${cost})`;
        barracksUpgradeButton.disabled = state.resources < cost;
      }
    }
  }

  function tryUpgradeSelectedBarracks() {
    const b = getSelectedBarracks();
    if (!b) return;
    if (b.level >= BARRACKS_MAX_LEVEL) {
      showToast('이미 최대 레벨 병영입니다', 1.2);
      return;
    }

    const cost = getBarracksUpgradeCost(b);
    if (state.resources < cost) {
      showToast('미네랄이 부족합니다', 1.2);
      return;
    }

    const prevConfig = getBarracksConfig(b.level);
    spendResources(cost);
    b.level += 1;
    b.maxHp = getBuildingMaxHp('barracks', b.level);
    b.hp = clamp(b.hp + b.maxHp * 0.25, 1, b.maxHp);
    b.spawnCd = Math.min(b.spawnCd, getBarracksConfig(b.level).interval);
    b.flash = 0.2;

    const nextConfig = getBarracksConfig(b.level);
    const ratio = nextConfig.statMul / prevConfig.statMul;
    for (let i = 0; i < soldiers.length; i += 1) {
      const s = soldiers[i];
      if (s.sourceBarracksId !== b.id) continue;
      s.baseDamage = Math.round(s.baseDamage * ratio);
      s.baseMaxHp = Math.round(s.baseMaxHp * ratio);
      s.baseSpeed = Math.round(s.baseSpeed * (1 + (ratio - 1) * 0.45));
      s.range += 8;
    }
    refreshFriendlyDerivedStats();

    showToast(`병영 Lv.${b.level} 업그레이드 완료`, 1.3);
    playSfx('build');
    renderBarracksOverlay();
    updateHud();
  }

  function renderUpgradeButtons() {
    upgradeListEl.innerHTML = '';

    for (let i = 0; i < UPGRADE_DEFS.length; i += 1) {
      const up = UPGRADE_DEFS[i];
      const level = state.upgrades[up.key];
      const cost = Math.floor(up.baseCost * Math.pow(1.5, level));

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'upgradeBtn';
      btn.innerHTML = `<b>${up.name} Lv.${level}</b><div>${up.desc}</div><div>비용: ${cost} Mineral</div>`;

      btn.addEventListener('click', () => {
        if (state.resources < cost) {
          showToast('미네랄이 부족합니다', 1.2);
          return;
        }

        spendResources(cost);
        state.upgrades[up.key] += 1;
        refreshFriendlyDerivedStats();

        for (let bi = 0; bi < buildings.length; bi += 1) {
          const b = buildings[bi];
          if (b.type === 'upgrade') {
            b.hologram = 2.4;
          }
        }

        showToast(`${up.name} 업그레이드 완료`, 1.2);
        playSfx('build');
        renderUpgradeButtons();
        updateHud();
      });

      upgradeListEl.appendChild(btn);
    }
  }

  function openCardOverlay(cards) {
    state.cardOptions = cards;
    state.selectedCardIndex = 0;

    cardListEl.innerHTML = '';
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cardBtn';
      if (i === 0) btn.classList.add('active');
      btn.innerHTML = `<b>${i + 1}. ${card.title}</b><div>${card.desc}</div>`;
      btn.addEventListener('click', () => chooseCard(i));
      cardListEl.appendChild(btn);
    }

    cardOverlayEl.classList.remove('hidden');
    cardOverlayEl.setAttribute('aria-hidden', 'false');
  }

  function closeCardOverlay() {
    cardOverlayEl.classList.add('hidden');
    cardOverlayEl.setAttribute('aria-hidden', 'true');
    state.cardOptions = [];
  }

  function chooseCard(index) {
    if (state.phase !== PHASE_REWARD) return;
    const card = state.cardOptions[index];
    if (!card) return;

    card.apply();
    playSfx('card');
    showToast(`카드 적용: ${card.title}`, 1.45);

    closeCardOverlay();
    closeUpgradeOverlay();

    state.wave += 1;
    state.phase = PHASE_BUILD;
    state.phaseTimer = getWaveBuildDuration(state.wave);

    showBanner(`WAVE ${state.wave} 준비`, 1.6);
    updateHud();
  }

  function drawCardChoices() {
    const pool = CARD_POOL.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    return pool.slice(0, 3);
  }

  function closeGameOverOverlay() {
    gameOverOverlayEl.classList.add('hidden');
    gameOverOverlayEl.setAttribute('aria-hidden', 'true');
  }

  function enterGameOver() {
    state.phase = PHASE_GAMEOVER;
    state.buildMode = null;
    updateSlotButtonState();
    closeUpgradeOverlay();
    closeBarracksOverlay();
    closeCardOverlay();

    gameOverOverlayEl.classList.remove('hidden');
    gameOverOverlayEl.setAttribute('aria-hidden', 'false');
    showBanner('GAME OVER', 2.2);
    saveCurrentRecord();
  }

  function updateWaveSystem(dt) {
    if (state.phase === PHASE_BUILD) {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        state.phase = PHASE_COMBAT;
        const spawnConfig = getWaveSpawnConfig(state.wave);
        state.waveSpawnTotal = spawnConfig.total;
        state.waveSpawnRemain = state.waveSpawnTotal;
        state.spawnInterval = spawnConfig.interval;
        state.spawnCooldown = 0.18;
        state.spawnBurst = spawnConfig.burst;
        state.phaseTimer = spawnConfig.combatDuration;
        state.bossSpawned = false;
        showBanner(`WAVE ${state.wave} 시작`, 1.5);
        playSfx('wave');
      }
      return;
    }

    if (state.phase === PHASE_COMBAT) {
      state.phaseTimer -= dt;

      state.spawnCooldown -= dt;
      if (state.waveSpawnRemain > 0 && state.spawnCooldown <= 0) {
        state.spawnCooldown = state.spawnInterval;
        spawnWaveEnemyPack(state.spawnBurst);
      }

      if (state.waveSpawnRemain <= 0 && enemies.length === 0) {
        state.phase = PHASE_REWARD;
        const cards = drawCardChoices();
        openCardOverlay(cards);
        showBanner(`WAVE ${state.wave} 완료`, 1.6);
        playSfx('card');
      }

      if (state.phaseTimer <= 0 && state.waveSpawnRemain <= 0 && enemies.length === 0) {
        state.phase = PHASE_REWARD;
        openCardOverlay(drawCardChoices());
      }
    }
  }

  function updatePlayer(dt) {
    const p = state.player;

    p.flash = Math.max(0, p.flash - dt * 1.9);

    const input = getMoveInput();
    const speed = p.baseSpeed * getSpeedMultiplier();

    if (!isFriendlyOverlayOpen()) {
      moveEntityWithCollision(p, input.x * speed, input.y * speed, dt);
    }

    if (Math.abs(input.x) > 0.01 || Math.abs(input.y) > 0.01) {
      p.facingAngle = Math.atan2(input.y, input.x);
      p.dustCd -= dt;
      if (p.dustCd <= 0) {
        p.dustCd = 0.05;
        addParticle(p.x + randRange(-4, 4), p.y + randRange(-4, 4), randRange(-20, 20), randRange(10, 42), 0.25, 2, 'rgba(210,230,240,0.8)');
      }
      p.mineTargetId = 0;
      p.mineProgress = 0;
    } else {
      updatePlayerMiningAndRepair(dt);
    }

    pushEnemiesAwayFromScv(p, dt, 1.25);
    revealAround(p.x, p.y, VISION_RADIUS_PLAYER);
  }

  function updatePlayerMiningAndRepair(dt) {
    const p = state.player;

    const mineral = pickClosestMineral(p.x, p.y);
    if (mineral && dist(p.x, p.y, mineral.x, mineral.y) <= 34) {
      if (p.mineTargetId !== mineral.id) {
        p.mineTargetId = mineral.id;
        p.mineProgress = 0;
      }

      p.mineProgress += (dt * 0.75 * getMineSpeedMultiplier()) / mineral.difficulty;

      if (Math.random() < 0.22) {
        addParticle(mineral.x + randRange(-6, 6), mineral.y + randRange(-6, 6), randRange(-18, 18), randRange(-24, -8), 0.26, 2, '#ffe48b');
      }

      if (p.mineProgress >= 1) {
        p.mineProgress = 0;
        const gain = Math.min(mineral.chunk, mineral.total);
        mineral.total -= gain;
        mineral.flash = 0.12;

        gainResources(gain);
        addPopup(mineral.x, mineral.y - 14, `+${gain}`, '#ffd95e');
        playSfx('mine');

        if (mineral.total <= 0) {
          const idx = minerals.indexOf(mineral);
          if (idx >= 0) minerals.splice(idx, 1);
          p.mineTargetId = 0;
        }
      }
    } else {
      p.mineTargetId = 0;
      p.mineProgress = 0;
    }

    const nearestBuilding = findNearestDamagedBuilding(p.x, p.y, 44);
    if (nearestBuilding && state.resources > 0) {
      const repairAmount = dt * 48;
      const repairCost = repairAmount * 0.28;
      const possibleRepair = Math.min(repairAmount, nearestBuilding.maxHp - nearestBuilding.hp, state.resources / 0.28);
      if (possibleRepair > 0) {
        spendResources(possibleRepair * 0.28);
        nearestBuilding.hp += possibleRepair;
        addParticle(p.x + randRange(-5, 5), p.y + randRange(-5, 5), randRange(-16, 16), randRange(-18, 0), 0.2, 2, '#86f4ff');
      }
    }
  }

  function findNearestDamagedBuilding(x, y, range) {
    let best = null;
    let bestD = range;

    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (b.hp >= b.maxHp) continue;

      const pos = getBuildingCenter(b);
      const d = dist(x, y, pos.x, pos.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }

    return best;
  }

  function updateBuildings(dt) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      b.flash = Math.max(0, b.flash - dt * 2.2);
      b.hologram = Math.max(0, b.hologram - dt);

      if (b.type === 'turret') {
        b.shootCd -= dt;
        const center = getBuildingCenter(b);
        const range = (165 + (b.level - 1) * 40) * (1 + state.bonuses.towerRange);
        const target = findClosestEnemy(center.x, center.y, range);
        if (target && b.shootCd <= 0) {
          b.shootCd = Math.max(0.22, 0.74 - b.level * 0.09);
          const damage = Math.round((16 + (b.level - 1) * 11) * getAttackMultiplier() * (1 + state.bonuses.turretDamage));
          spawnProjectile(center.x, center.y, target.x, target.y, 320, damage, TEAM_FRIENDLY, '#ffdc8e', 3, 1.35);
          playSfx('shot');
        }
      }

      if (b.type === 'barracks') {
        const config = getBarracksConfig(b.level);
        b.spawnCd -= dt;
        if (b.spawnCd <= 0) {
          if (getPopulationUsed() < state.populationLimit && countSoldiersByBarracks(b.id) < config.maxUnits) {
            spawnSoldierFromBarracks(b);
          }
          b.spawnCd = Math.max(8, config.interval * (1 - state.bonuses.barracksRate * 0.5));
        }
      }
    }
  }

  function updateMiniScvs(dt) {
    for (let i = miniScvs.length - 1; i >= 0; i -= 1) {
      const scv = miniScvs[i];
      scv.flash = Math.max(0, scv.flash - dt * 2.5);
      revealAround(scv.x, scv.y, VISION_RADIUS_UNIT);

      const speed = scv.baseSpeed * getSpeedMultiplier();
      scv.repathCd = Math.max(0, scv.repathCd - dt);

      if (scv.carry > 0 && scv.mode !== 'toBase') {
        scv.mode = 'toBase';
        scv.targetMineralId = 0;
        scv.path = [];
        scv.pathIndex = 0;
        scv.repathCd = 0;
        scv.stuckTimer = 0;
      }

      if (scv.mode === 'search') {
        const target = pickReachableMineral(scv.x, scv.y, 12);
        if (!target) {
          scv.targetMineralId = 0;
          scv.path = [];
          scv.pathIndex = 0;
          continue;
        }
        scv.targetMineralId = target.id;
        scv.mode = 'toMineral';
        scv.repathCd = 0;
        scv.repathFail = 0;
        scv.stuckTimer = 0;
      } else if (scv.mode === 'toMineral') {
        const mineral = findMineralById(scv.targetMineralId);
        if (!mineral || mineral.total <= 0) {
          scv.mode = 'search';
          scv.targetMineralId = 0;
          scv.path = [];
          scv.pathIndex = 0;
          continue;
        }

        if (dist(scv.x, scv.y, mineral.x, mineral.y) < 18) {
          scv.mode = 'mining';
          scv.mineProgress = 0;
          scv.path = [];
          scv.pathIndex = 0;
          scv.repathFail = 0;
          scv.stuckTimer = 0;
          continue;
        }

        if (!scv.path.length || scv.repathCd <= 0 || scv.stuckTimer > 0.72) {
          const ok = updateMiniScvPathToTile(scv, mineral.c, mineral.r);
          scv.repathCd = ok ? 0.42 : 0.18;
          if (!ok) {
            scv.repathFail += 1;
            if (scv.repathFail > 5) {
              scv.mode = 'search';
              scv.targetMineralId = 0;
              scv.repathFail = 0;
              continue;
            }
          } else {
            scv.repathFail = 0;
          }
        }

        const prevX = scv.x;
        const prevY = scv.y;
        let moved = followTilePath(scv, speed, dt);

        if (!moved) {
          const d = dist(scv.x, scv.y, mineral.x, mineral.y);
          if (d > 0.001) {
            const dx = (mineral.x - scv.x) / d;
            const dy = (mineral.y - scv.y) / d;
            scv.facingAngle = Math.atan2(dy, dx);
            moveEntityWithCollision(scv, dx * speed, dy * speed, dt);
            moved = true;
          }
        }

        const progress = dist(scv.x, scv.y, prevX, prevY);
        if (moved && progress < 0.3) scv.stuckTimer += dt;
        else scv.stuckTimer = Math.max(0, scv.stuckTimer - dt * 1.4);
      } else if (scv.mode === 'mining') {
        const mineral = findMineralById(scv.targetMineralId);
        if (!mineral || mineral.total <= 0) {
          scv.mode = 'search';
          scv.targetMineralId = 0;
          scv.mineProgress = 0;
          continue;
        }

        scv.facingAngle = Math.atan2(mineral.y - scv.y, mineral.x - scv.x);
        scv.mineProgress += (dt * 1.05 * getMineSpeedMultiplier()) / mineral.difficulty;

        if (Math.random() < 0.22) {
          addParticle(mineral.x + randRange(-5, 5), mineral.y + randRange(-5, 5), randRange(-12, 12), randRange(-18, -2), 0.2, 2, '#ffe198');
        }

        if (scv.mineProgress >= 1) {
          scv.mineProgress = 0;
          const gain = Math.min(Math.max(1, Math.floor(mineral.chunk * 0.8)), mineral.total);
          mineral.total -= gain;
          scv.carry = gain;
          scv.mode = 'toBase';
          const returnCommand = getNearestCommandCenter(scv.x, scv.y) || state.commandCenter;
          scv.returnCommandId = returnCommand ? returnCommand.id : 0;
          scv.path = [];
          scv.pathIndex = 0;
          scv.repathCd = 0;
          scv.repathFail = 0;
          scv.stuckTimer = 0;

          if (mineral.total <= 0) {
            const idx = minerals.indexOf(mineral);
            if (idx >= 0) minerals.splice(idx, 1);
          }
        }
      } else if (scv.mode === 'toBase') {
        const returnCommand = buildingsById.get(scv.returnCommandId) || getNearestCommandCenter(scv.x, scv.y) || state.commandCenter;
        if (!returnCommand) {
          scv.mode = 'search';
          scv.targetMineralId = 0;
          scv.path = [];
          scv.pathIndex = 0;
          continue;
        }

        const cp = getBuildingCenter(returnCommand);
        if (dist(scv.x, scv.y, cp.x, cp.y) < 28 || isEntityNearBuildingDock(scv, returnCommand, 10)) {
          if (scv.carry > 0) {
            gainResources(scv.carry);
            addPopup(scv.x, scv.y - 10, `+${scv.carry}`, '#f5dc74');
            scv.carry = 0;
            playSfx('mine');
          }
          scv.mode = 'search';
          scv.targetMineralId = 0;
          scv.path = [];
          scv.pathIndex = 0;
          scv.repathCd = 0;
          scv.repathFail = 0;
          scv.stuckTimer = 0;
          continue;
        }

        if (!scv.path.length || scv.repathCd <= 0 || scv.stuckTimer > 0.72) {
          const approach = getNearestApproachPoint(returnCommand, scv.x, scv.y);
          const ok = updateMiniScvPathToTile(scv, approach.c, approach.r);
          scv.repathCd = ok ? 0.38 : 0.16;
          if (!ok) {
            scv.repathFail += 1;
            if (scv.repathFail > 7) {
              scv.path = [];
              scv.pathIndex = 0;
              scv.repathCd = 0.12;
              scv.repathFail = 0;
            }
          } else {
            scv.repathFail = 0;
          }
        }

        const prevX = scv.x;
        const prevY = scv.y;
        let moved = followTilePath(scv, speed, dt);

        if (!moved) {
          const d = dist(scv.x, scv.y, cp.x, cp.y);
          if (d > 0.001) {
            const dx = (cp.x - scv.x) / d;
            const dy = (cp.y - scv.y) / d;
            scv.facingAngle = Math.atan2(dy, dx);
            moveEntityWithCollision(scv, dx * speed, dy * speed, dt);
            moved = true;
          }
        }

        const progress = dist(scv.x, scv.y, prevX, prevY);
        if (moved && progress < 0.3) scv.stuckTimer += dt;
        else scv.stuckTimer = Math.max(0, scv.stuckTimer - dt * 1.4);
      }
    }
  }

  function updateSoldiers(dt) {
    for (let i = soldiers.length - 1; i >= 0; i -= 1) {
      const s = soldiers[i];
      s.flash = Math.max(0, s.flash - dt * 2.5);
      revealAround(s.x, s.y, VISION_RADIUS_UNIT);

      const speed = s.baseSpeed * getSpeedMultiplier();
      s.shootCd -= dt;

      let target = null;
      if (s.targetId) {
        target = enemies.find((e) => e.id === s.targetId) || null;
      }
      if (!target || target.hp <= 0 || dist(s.x, s.y, target.x, target.y) > 260) {
        target = findClosestEnemy(s.x, s.y, 250);
        s.targetId = target ? target.id : 0;
      }

      if (target) {
        const d = dist(s.x, s.y, target.x, target.y);
        if (d > s.range * 0.84) {
          const dx = (target.x - s.x) / (d || 1);
          const dy = (target.y - s.y) / (d || 1);
          moveEntityWithCollision(s, dx * speed, dy * speed, dt);
        }

        if (d <= s.range && s.shootCd <= 0) {
          s.shootCd = 0.62;
          const damage = Math.round(s.baseDamage * getAttackMultiplier());
          spawnProjectile(s.x, s.y, target.x, target.y, 260, damage, TEAM_FRIENDLY, '#9fd8ff', 3, 1.4);
          playSfx('shot');
        }
      } else {
        const homeD = dist(s.x, s.y, s.homeX, s.homeY);
        if (homeD > 22) {
          const dx = (s.homeX - s.x) / homeD;
          const dy = (s.homeY - s.y) / homeD;
          moveEntityWithCollision(s, dx * speed * 0.75, dy * speed * 0.75, dt);
        }
      }
    }
  }

  function updateEnemies(dt) {
    const mainTarget = state.commandCenter || getNearestCommandTarget(state.player.x, state.player.y);
    if (!mainTarget) return;
    const mainPos = getBuildingCenter(mainTarget);

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const e = enemies[i];
      e.flash = Math.max(0, e.flash - dt * 2.3);
      e.attackCd -= dt;
      e.specialCd -= dt;
      e.repathCd -= dt;
      e.dashCd -= dt;
      e.dashTimer = Math.max(0, e.dashTimer - dt);

      if (e.type === 'charger' && e.dashCd <= 0) {
        e.dashCd = randRange(3, 5);
        e.dashTimer = 0.9;
      }

      if (e.repathCd <= 0) {
        e.repathCd = randRange(0.7, 1.1);
        e.wallTargetId = 0;

        const strictPath = findEnemyPath(e, 'strict');
        if (strictPath && strictPath.length > 0) {
          e.path = strictPath;
          e.pathIndex = 0;
        } else {
          const softPath = findEnemyPath(e, 'wallSoft');
          if (softPath && softPath.length > 0) {
            const wall = findFirstWallOnPath(softPath);
            if (wall) {
              e.wallTargetId = wall.id;
              e.path = [];
              e.pathIndex = 0;
            } else {
              e.path = softPath;
              e.pathIndex = 0;
            }
          } else {
            e.path = [];
            e.pathIndex = 0;
          }
        }
      }

      if (e.wallTargetId) {
        const wall = buildingsById.get(e.wallTargetId);
        if (!wall || wall.hp <= 0) {
          e.wallTargetId = 0;
        } else {
          const wp = getBuildingCenter(wall);
          const d = dist(e.x, e.y, wp.x, wp.y);

          if (e.type === 'ranged' && d <= e.shootRange && e.attackCd <= 0) {
            e.attackCd = 0.95;
            spawnProjectile(e.x, e.y, wp.x, wp.y, 210, e.damage, TEAM_ENEMY, '#ff9ca8', 3, 1.6);
          } else if (d > e.attackRange + 12) {
            const speedMul = e.dashTimer > 0 ? 1.8 : 1;
            const speed = e.baseSpeed * speedMul;
            const dx = (wp.x - e.x) / (d || 1);
            const dy = (wp.y - e.y) / (d || 1);
            moveEntityWithCollision(e, dx * speed, dy * speed, dt);
          } else if (e.attackCd <= 0) {
            e.attackCd = e.type === 'boss' ? 0.46 : 0.78;
            damageTarget(wall, e.damage);
          }

          continue;
        }
      }

      const commandTarget = getNearestCommandTarget(e.x, e.y) || mainTarget;
      const commandPos = getBuildingCenter(commandTarget);
      const dToCommand = dist(e.x, e.y, commandPos.x, commandPos.y);
      const canMeleeCommand = isEntityNearBuildingDock(e, commandTarget, e.attackRange + 4);

      if (!canMeleeCommand) {
        if (e.path && e.path.length > 0) {
          followTilePath(e, e.baseSpeed * (e.dashTimer > 0 ? 1.8 : 1), dt);
        } else {
          const d = dist(e.x, e.y, mainPos.x, mainPos.y);
          const dx = (mainPos.x - e.x) / (d || 1);
          const dy = (mainPos.y - e.y) / (d || 1);
          moveEntityWithCollision(e, dx * e.baseSpeed, dy * e.baseSpeed, dt);
        }
      } else {
        e.path = [];
        e.pathIndex = 0;
      }

      if (e.type === 'ranged' && dToCommand <= e.shootRange && e.attackCd <= 0) {
        e.attackCd = 0.9;
        spawnProjectile(e.x, e.y, commandPos.x, commandPos.y, 220, e.damage, TEAM_ENEMY, '#ff9aa2', 3, 1.7);
      } else if (canMeleeCommand && e.attackCd <= 0) {
        e.attackCd = e.type === 'boss' ? 0.48 : 0.8;
        damageTarget(commandTarget, e.damage);
      }

      if (e.type === 'boss' && e.specialCd <= 0) {
        e.specialCd = 3.6;
        for (let n = 0; n < 6; n += 1) {
          const ang = (Math.PI * 2 * n) / 6;
          const tx = e.x + Math.cos(ang) * 120;
          const ty = e.y + Math.sin(ang) * 120;
          spawnProjectile(e.x, e.y, tx, ty, 250, Math.round(e.damage * 0.65), TEAM_ENEMY, '#ff7a8c', 3, 1.2);
        }
      }
    }
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const p = projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        projectiles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < -30 || p.y < -30 || p.x > WORLD_W + 30 || p.y > WORLD_H + 30) {
        projectiles.splice(i, 1);
        continue;
      }

      let hit = false;

      if (p.team === TEAM_FRIENDLY) {
        for (let ei = enemies.length - 1; ei >= 0; ei -= 1) {
          const e = enemies[ei];
          if (dist2(p.x, p.y, e.x, e.y) <= (p.radius + e.r) * (p.radius + e.r)) {
            damageTarget(e, p.damage);
            hit = true;
            break;
          }
        }
      } else {
        const cc = state.commandCenter;
        if (cc) {
          const ccPos = getBuildingCenter(cc);
          const rr = Math.max(cc.w, cc.h) * TILE * 0.55;
          if (dist2(p.x, p.y, ccPos.x, ccPos.y) <= (p.radius + rr) * (p.radius + rr)) {
            damageTarget(cc, p.damage);
            hit = true;
          }
        }

        if (!hit && dist2(p.x, p.y, state.player.x, state.player.y) <= (p.radius + state.player.r) * (p.radius + state.player.r)) {
          damageTarget(state.player, p.damage * 0.8);
          hit = true;
        }

        if (!hit) {
          for (let si = soldiers.length - 1; si >= 0; si -= 1) {
            const s = soldiers[si];
            if (dist2(p.x, p.y, s.x, s.y) <= (p.radius + s.r) * (p.radius + s.r)) {
              damageTarget(s, p.damage);
              hit = true;
              break;
            }
          }
        }
      }

      if (hit) {
        projectiles.splice(i, 1);
      }
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }

    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        debris.splice(i, 1);
      }
    }

    for (let i = popups.length - 1; i >= 0; i -= 1) {
      const p = popups[i];
      p.life -= dt;
      if (p.life <= 0) {
        popups.splice(i, 1);
        continue;
      }
      p.y += p.vy * dt;
      p.vy *= 0.93;
    }

    for (let i = minerals.length - 1; i >= 0; i -= 1) {
      minerals[i].flash = Math.max(0, minerals[i].flash - dt * 2.4);
    }

    state.baseAlertCd = Math.max(0, state.baseAlertCd - dt);

    if (state.toastTimer > 0) {
      state.toastTimer -= dt;
      if (state.toastTimer <= 0) {
        toastEl.classList.remove('show');
      }
    }

    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0) {
        waveBannerEl.classList.add('hidden');
      }
    }
  }

  function updateCamera(dt) {
    const target = state.player;
    const tx = clamp(target.x - state.viewW * 0.5, 0, Math.max(0, WORLD_W - state.viewW));
    const ty = clamp(target.y - state.viewH * 0.5, 0, Math.max(0, WORLD_H - state.viewH));

    const smooth = state.centerCameraTimer > 0 ? 0.5 : 0.13;
    state.camera.x = lerp(state.camera.x, tx, smooth);
    state.camera.y = lerp(state.camera.y, ty, smooth);
    state.centerCameraTimer = Math.max(0, state.centerCameraTimer - dt);
  }

  function updateHud() {
    mineralValueEl.textContent = Math.floor(state.resources).toString();
    populationValueEl.textContent = `${getPopulationUsed()} / ${state.populationLimit}`;
    if (spawnWorkerButton) {
      spawnWorkerButton.textContent = `일꾼 생산 (E) ${MANUAL_WORKER_COST}`;
      spawnWorkerButton.title = `수동 생산 비용 ${MANUAL_WORKER_COST}`;
    }

    let phaseName = '';
    if (state.phase === PHASE_BUILD) phaseName = '준비';
    else if (state.phase === PHASE_COMBAT) phaseName = '전투';
    else if (state.phase === PHASE_REWARD) phaseName = '보상';
    else phaseName = '종료';

    waveValueEl.textContent = `${state.wave} (${phaseName})`;

    if (state.phase === PHASE_REWARD) {
      timeValueEl.textContent = '선택';
    } else if (state.phase === PHASE_GAMEOVER) {
      timeValueEl.textContent = '-';
    } else {
      timeValueEl.textContent = `${Math.max(0, Math.ceil(state.phaseTimer))}`;
    }

    if (state.barracksPanelOpen) {
      renderBarracksOverlay();
    }
  }

  function drawWorld() {
    ctx.clearRect(0, 0, state.viewW, state.viewH);

    const startC = clamp(worldToTileX(state.camera.x) - 1, 0, MAP_COLS - 1);
    const endC = clamp(worldToTileX(state.camera.x + state.viewW) + 1, 0, MAP_COLS - 1);
    const startR = clamp(worldToTileY(state.camera.y) - 1, 0, MAP_ROWS - 1);
    const endR = clamp(worldToTileY(state.camera.y + state.viewH) + 1, 0, MAP_ROWS - 1);

    for (let r = startR; r <= endR; r += 1) {
      for (let c = startC; c <= endC; c += 1) {
        const x = c * TILE - state.camera.x;
        const y = r * TILE - state.camera.y;
        const known = discovered[toIndex(c, r)] === 1;

        if (known) {
          const tint = ((c * 17 + r * 19) % 14) / 255;
          ctx.fillStyle = `rgba(${14 + tint * 110}, ${30 + tint * 80}, ${43 + tint * 70}, 1)`;
        } else {
          ctx.fillStyle = '#04090e';
        }

        ctx.fillRect(x, y, TILE, TILE);

        if (terrainAt(c, r) && known) {
          ctx.fillStyle = '#2e404c';
          ctx.fillRect(x + 3, y + 4, TILE - 6, TILE - 8);
          ctx.fillStyle = '#3a5461';
          ctx.fillRect(x + 7, y + 8, TILE - 14, TILE - 16);
        }

        if (known) {
          ctx.strokeStyle = 'rgba(120, 170, 200, 0.04)';
          ctx.strokeRect(x, y, TILE, TILE);
        }
      }
    }

    for (let i = 0; i < debris.length; i += 1) {
      const d = debris[i];
      const alpha = d.life / d.maxLife;
      const x = d.x - state.camera.x;
      const y = d.y - state.camera.y;
      const s = d.size * alpha;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.angle + (1 - alpha) * 0.8);
      ctx.fillStyle = `rgba(130, 145, 160, ${0.32 * alpha})`;
      ctx.fillRect(-s * 0.5, -s * 0.3, s, s * 0.6);
      ctx.restore();
    }

    for (let i = 0; i < minerals.length; i += 1) {
      const m = minerals[i];
      if (!discovered[toIndex(m.c, m.r)]) continue;
      if (m.total <= 0) continue;

      const x = m.x - state.camera.x;
      const y = m.y - state.camera.y;
      const k = 1 + Math.sin(performance.now() * 0.004 + i) * 0.06;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);
      ctx.fillStyle = m.flash > 0 ? '#fff8cc' : '#ffd76a';
      ctx.beginPath();
      ctx.moveTo(0, -m.radius);
      ctx.lineTo(m.radius * 0.8, 0);
      ctx.lineTo(0, m.radius);
      ctx.lineTo(-m.radius * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      const rx = b.c * TILE - state.camera.x;
      const ry = b.r * TILE - state.camera.y;
      const rw = b.w * TILE;
      const rh = b.h * TILE;

      if (!isRectVisible(b.c * TILE, b.r * TILE, rw, rh)) continue;

      let color = BUILD_TYPES[b.type].color;
      if (b.flash > 0) {
        color = '#f8ffff';
      }

      ctx.fillStyle = color;
      ctx.fillRect(rx + 2, ry + 2, rw - 4, rh - 4);

      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
      drawBuildingIcon(b, rx + 2, ry + 2, rw - 4, rh - 4);

      if ((b.type === 'barracks' || b.type === 'turret') && b.level > 1) {
        ctx.fillStyle = '#0a1520';
        ctx.font = 'bold 11px Trebuchet MS';
        ctx.fillText(`Lv${b.level}`, rx + 6, ry + 14);
      }

      if (b.type === 'upgrade') {
        const center = getBuildingCenter(b);
        const cx = center.x - state.camera.x;
        const cy = center.y - state.camera.y;
        const holoAlpha = 0.35 + Math.sin(performance.now() * 0.01) * 0.15;
        ctx.strokeStyle = `rgba(154, 222, 255, ${holoAlpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy - 10, 11 + Math.sin(performance.now() * 0.008 + i) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (b.hp < b.maxHp) {
        drawHpBar(rx + rw * 0.12, ry - 7, rw * 0.76, 4, b.hp / b.maxHp, '#7cff73');
      }
    }

    for (let i = 0; i < soldiers.length; i += 1) {
      const s = soldiers[i];
      if (!discovered[toIndex(worldToTileX(s.x), worldToTileY(s.y))]) continue;
      drawUnitCircle(s.x, s.y, s.r, s.flash > 0 ? '#f8ffff' : '#6dc7ff');
      if (s.hp < s.maxHp) {
        drawHpBar(s.x - 10 - state.camera.x, s.y - 16 - state.camera.y, 20, 3, s.hp / s.maxHp, '#87ff90');
      }
    }

    for (let i = 0; i < miniScvs.length; i += 1) {
      const scv = miniScvs[i];
      if (!discovered[toIndex(worldToTileX(scv.x), worldToTileY(scv.y))]) continue;
      drawMiniScv(scv);
    }

    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!discovered[toIndex(worldToTileX(e.x), worldToTileY(e.y))]) continue;
      let color = '#ff6a7f';
      if (e.type === 'ranged') color = '#ff9e5e';
      if (e.type === 'charger') color = '#ff4f5a';
      if (e.type === 'boss') color = '#ff2f9d';
      if (e.flash > 0) color = '#fff';

      drawUnitCircle(e.x, e.y, e.r, color);
      drawHpBar(e.x - 12 - state.camera.x, e.y - 16 - state.camera.y, 24, 3, e.hp / e.maxHp, '#ff8f8f');
    }

    drawPlayer();

    for (let i = 0; i < projectiles.length; i += 1) {
      const p = projectiles[i];
      const x = p.x - state.camera.x;
      const y = p.y - state.camera.y;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color.includes('rgba') ? p.color : `${p.color}`;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - state.camera.x, p.y - state.camera.y, p.size, p.size);
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < popups.length; i += 1) {
      const p = popups[i];
      ctx.globalAlpha = clamp(p.life / 0.95, 0, 1);
      ctx.fillStyle = p.color;
      ctx.font = 'bold 12px Trebuchet MS';
      ctx.fillText(p.text, p.x - state.camera.x, p.y - state.camera.y);
      ctx.globalAlpha = 1;
    }

    drawBuildPreview();
    drawMiningGauge();
    drawFog();
  }

  function drawUnitCircle(wx, wy, radius, color) {
    const x = wx - state.camera.x;
    const y = wy - state.camera.y;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBuildingIcon(b, x, y, w, h) {
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const s = Math.max(8, Math.min(w, h) * 0.32);

    ctx.save();
    ctx.strokeStyle = 'rgba(8, 16, 22, 0.9)';
    ctx.fillStyle = 'rgba(8, 16, 22, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (b.type === 'barracks') {
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.1, cy + s * 0.3);
      ctx.lineTo(cx + s * 1.0, cy - s * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.1, cy + s * 0.8);
      ctx.stroke();
      ctx.fillRect(cx + s * 0.55, cy - s * 0.57, s * 0.55, s * 0.18);
    } else if (b.type === 'turret') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy);
      ctx.lineTo(cx + s * 0.95, cy - s * 0.1);
      ctx.stroke();
      ctx.fillRect(cx - s * 0.28, cy - s * 0.22, s * 0.44, s * 0.44);
    } else if (b.type === 'wall') {
      const bw = s * 0.75;
      const bh = s * 0.45;
      const startX = cx - bw * 1.5;
      const startY = cy - bh * 0.8;
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const ox = startX + col * (bw + 1) + (row === 1 ? bw * 0.35 : 0);
          const oy = startY + row * (bh + 2);
          ctx.strokeRect(ox, oy, bw, bh);
        }
      }
    } else if (b.type === 'supply') {
      ctx.strokeRect(cx - s * 0.85, cy - s * 0.75, s * 1.7, s * 1.5);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.55);
      ctx.lineTo(cx, cy + s * 0.55);
      ctx.moveTo(cx - s * 0.55, cy);
      ctx.lineTo(cx + s * 0.55, cy);
      ctx.stroke();
    } else if (b.type === 'upgrade') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i += 1) {
        const a = (Math.PI * 2 * i) / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
        ctx.lineTo(cx + Math.cos(a) * s * 1.2, cy + Math.sin(a) * s * 1.2);
        ctx.stroke();
      }
      ctx.fillRect(cx - s * 0.2, cy - s * 0.2, s * 0.4, s * 0.4);
    } else if (b.type === 'command') {
      ctx.strokeRect(cx - s * 0.95, cy - s * 0.68, s * 1.9, s * 1.36);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy + s * 0.2);
      ctx.lineTo(cx + s * 0.4, cy + s * 0.2);
      ctx.moveTo(cx, cy + s * 0.2);
      ctx.lineTo(cx, cy - s * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.65, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawMiniScv(scv) {
    const x = scv.x - state.camera.x;
    const y = scv.y - state.camera.y;
    const bodyColor = scv.flash > 0 ? '#ffffff' : '#7cf5e8';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(scv.facingAngle || 0);

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, scv.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#154757';
    ctx.beginPath();
    ctx.moveTo(scv.r * 0.95, 0);
    ctx.lineTo(scv.r * 0.2, -scv.r * 0.45);
    ctx.lineTo(scv.r * 0.2, scv.r * 0.45);
    ctx.closePath();
    ctx.fill();

    if (scv.carry > 0) {
      const mx = scv.r + 4;
      const mr = 3.2;
      ctx.fillStyle = '#ffd968';
      ctx.beginPath();
      ctx.moveTo(mx, -mr);
      ctx.lineTo(mx + mr * 0.8, 0);
      ctx.lineTo(mx, mr);
      ctx.lineTo(mx - mr * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 76, 15, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawHpBar(x, y, w, h, ratio, color) {
    const r = clamp(ratio, 0, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, (w - 2) * r, h - 2);
  }

  function drawPlayer() {
    const p = state.player;
    const x = p.x - state.camera.x;
    const y = p.y - state.camera.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.facingAngle);

    ctx.fillStyle = p.flash > 0 ? '#f8ffff' : '#e9f6ff';
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#66c9ff';
    ctx.fillRect(-4, -4, 8, 8);

    ctx.restore();

    if (p.hp < p.maxHp) {
      drawHpBar(x - 14, y - 19, 28, 4, p.hp / p.maxHp, '#94ffd3');
    }
  }

  function drawBuildPreview() {
    if (!state.buildMode || !state.pointer.inside || isFriendlyOverlayOpen()) return;

    const preview = getBuildPreviewAt(state.pointer.wx, state.pointer.wy);
    if (!preview) return;

    const x = preview.c * TILE - state.camera.x;
    const y = preview.r * TILE - state.camera.y;
    const w = preview.w * TILE;
    const h = preview.h * TILE;

    let fill = 'rgba(96, 255, 170, 0.25)';
    let stroke = 'rgba(96, 255, 170, 0.75)';

    if (!preview.valid) {
      fill = 'rgba(255, 82, 95, 0.24)';
      stroke = 'rgba(255, 82, 95, 0.86)';
    } else if (preview.upgradeTarget) {
      fill = 'rgba(124, 182, 255, 0.24)';
      stroke = 'rgba(124, 182, 255, 0.84)';
    }

    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#f0ffff';
    ctx.font = 'bold 12px Trebuchet MS';
    ctx.fillText(`Cost: ${preview.cost}`, x + 2, y - 6);
  }

  function drawMiningGauge() {
    const p = state.player;
    if (!p.mineTargetId || p.mineProgress <= 0) return;

    const mineral = findMineralById(p.mineTargetId);
    if (!mineral) return;

    const x = mineral.x - state.camera.x - 18;
    const y = mineral.y - state.camera.y - 20;
    const w = 36;
    const h = 5;

    drawHpBar(x, y, w, h, p.mineProgress, '#ffe66f');
  }

  function drawFog() {
    const startC = clamp(worldToTileX(state.camera.x) - 1, 0, MAP_COLS - 1);
    const endC = clamp(worldToTileX(state.camera.x + state.viewW) + 1, 0, MAP_COLS - 1);
    const startR = clamp(worldToTileY(state.camera.y) - 1, 0, MAP_ROWS - 1);
    const endR = clamp(worldToTileY(state.camera.y + state.viewH) + 1, 0, MAP_ROWS - 1);

    for (let r = startR; r <= endR; r += 1) {
      for (let c = startC; c <= endC; c += 1) {
        if (discovered[toIndex(c, r)]) continue;
        const x = c * TILE - state.camera.x;
        const y = r * TILE - state.camera.y;
        ctx.fillStyle = 'rgba(1, 4, 8, 0.9)';
        ctx.fillRect(x, y, TILE, TILE);
      }
    }
  }

  function drawMinimap() {
    miniCtx.clearRect(0, 0, state.miniW, state.miniH);

    const sx = state.miniW / MAP_COLS;
    const sy = state.miniH / MAP_ROWS;

    miniCtx.fillStyle = '#02080d';
    miniCtx.fillRect(0, 0, state.miniW, state.miniH);

    for (let r = 0; r < MAP_ROWS; r += 1) {
      for (let c = 0; c < MAP_COLS; c += 1) {
        const known = discovered[toIndex(c, r)] === 1;
        if (!known) continue;

        if (terrainAt(c, r)) {
          miniCtx.fillStyle = '#293942';
        } else {
          miniCtx.fillStyle = '#0f2734';
        }

        miniCtx.fillRect(c * sx, r * sy, sx + 0.2, sy + 0.2);
      }
    }

    for (let i = 0; i < minerals.length; i += 1) {
      const m = minerals[i];
      if (m.total <= 0) continue;
      if (!discovered[toIndex(m.c, m.r)]) continue;
      miniCtx.fillStyle = '#f7dc6d';
      miniCtx.fillRect(m.c * sx, m.r * sy, Math.max(1, sx), Math.max(1, sy));
    }

    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (!discovered[toIndex(b.c, b.r)]) continue;

      if (b.type === 'command') {
        miniCtx.fillStyle = '#58f58c';
      } else {
        miniCtx.fillStyle = '#8bc6ff';
      }

      miniCtx.fillRect(b.c * sx, b.r * sy, b.w * sx, b.h * sy);
    }

    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      const c = worldToTileX(e.x);
      const r = worldToTileY(e.y);
      if (!inBounds(c, r) || !discovered[toIndex(c, r)]) continue;
      miniCtx.fillStyle = '#ff6b79';
      miniCtx.fillRect(c * sx, r * sy, Math.max(1, sx), Math.max(1, sy));
    }

    const pc = worldToTileX(state.player.x);
    const pr = worldToTileY(state.player.y);
    miniCtx.fillStyle = '#ffffff';
    miniCtx.fillRect(pc * sx, pr * sy, Math.max(2, sx), Math.max(2, sy));

    const camC = state.camera.x / TILE;
    const camR = state.camera.y / TILE;
    const camW = state.viewW / TILE;
    const camH = state.viewH / TILE;

    miniCtx.strokeStyle = 'rgba(119, 232, 255, 0.8)';
    miniCtx.strokeRect(camC * sx, camR * sy, camW * sx, camH * sy);
  }

  function update(dt) {
    updateBgm(dt);

    if (state.inLobby) {
      updateEffects(dt);
      updateCamera(dt);
      updateHud();
      return;
    }

    if (state.phase === PHASE_GAMEOVER) {
      updateEffects(dt);
      updateCamera(dt);
      updateHud();
      return;
    }

    const paused = state.phase === PHASE_REWARD || state.upgradePanelOpen || state.barracksPanelOpen;

    if (!paused) {
      state.runTime += dt;
      updateWaveSystem(dt);
      updatePlayer(dt);
      updateBuildings(dt);
      updateMiniScvs(dt);
      updateSoldiers(dt);
      updateEnemies(dt);
      updateProjectiles(dt);
    }

    updateEffects(dt);
    updateCamera(dt);
    updateHud();

    state.minimapRedrawCd -= dt;
    if (state.minimapRedrawCd <= 0) {
      state.minimapRedrawCd = 0.12;
      drawMinimap();
    }
  }

  function render() {
    drawWorld();
  }

  function frame(now) {
    const dt = clamp((now - lastTime) / 1000, 0.001, 0.045);
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const rect = canvas.getBoundingClientRect();
    state.viewW = Math.max(320, rect.width);
    state.viewH = Math.max(200, rect.height);

    canvas.width = Math.floor(state.viewW * dpr);
    canvas.height = Math.floor(state.viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mRect = minimapCanvas.getBoundingClientRect();
    state.miniW = Math.max(100, mRect.width);
    state.miniH = Math.max(70, mRect.height);

    minimapCanvas.width = Math.floor(state.miniW * dpr);
    minimapCanvas.height = Math.floor(state.miniH * dpr);
    miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawMinimap();
  }

  function handleGlobalKeyDown(e) {
    state.keys[e.code] = true;

    if (!state.audioUnlocked) {
      ensureAudioContext();
      state.audioUnlocked = true;
      startBgm();
    }

    const slotKey = (() => {
      if (e.code === 'Digit1' || e.code === 'Numpad1') return '1';
      if (e.code === 'Digit2' || e.code === 'Numpad2') return '2';
      if (e.code === 'Digit3' || e.code === 'Numpad3') return '3';
      if (e.code === 'Digit4' || e.code === 'Numpad4') return '4';
      if (e.code === 'Digit5' || e.code === 'Numpad5') return '5';
      if (e.code === 'Digit6' || e.code === 'Numpad6') return '6';
      return null;
    })();

    if (state.inLobby) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        startGameFromLobby();
        e.preventDefault();
      }
      return;
    }

    if (state.phase === PHASE_REWARD) {
      if (slotKey) {
        const idx = Number(slotKey) - 1;
        if (idx >= 0 && idx < state.cardOptions.length) {
          chooseCard(idx);
        }
        e.preventDefault();
        return;
      }

      if (e.code === 'Space') {
        chooseCard(state.selectedCardIndex || 0);
        e.preventDefault();
        return;
      }
    }

    if (slotKey && !isFriendlyOverlayOpen()) {
      setBuildModeBySlot(slotKey);
      e.preventDefault();
      return;
    }

    if (e.code === 'Space') {
      if (state.buildMode && !isFriendlyOverlayOpen()) {
        e.preventDefault();
      }
      return;
    }

    if (e.code === 'Escape') {
      if (state.upgradePanelOpen) {
        closeUpgradeOverlay();
      } else if (state.barracksPanelOpen) {
        closeBarracksOverlay();
      } else if (state.phase === PHASE_REWARD) {
        // reward phase cannot close without choice
      } else {
        state.buildMode = null;
        updateSlotButtonState();
      }
      e.preventDefault();
      return;
    }

    if (e.code === 'KeyU') {
      if (state.upgradePanelOpen) {
        closeUpgradeOverlay();
      } else {
        openUpgradeOverlay();
      }
      e.preventDefault();
      return;
    }

    if (e.code === 'KeyE') {
      trySpawnMiniScvManual();
      e.preventDefault();
      return;
    }

    if (e.code.startsWith('Arrow')) {
      e.preventDefault();
    }
  }

  function handleGlobalKeyUp(e) {
    state.keys[e.code] = false;
  }

  function setupJoystick() {
    if (!joystickZone || !joystickBase || !joystickKnob) return;

    function setJoystickFromPointer(clientX, clientY) {
      const rect = joystickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const maxLen = rect.width * 0.34;
      const len = Math.hypot(dx, dy) || 1;

      const nx = clamp(dx / maxLen, -1, 1);
      const ny = clamp(dy / maxLen, -1, 1);
      state.joystick.x = nx;
      state.joystick.y = ny;

      const clampedLen = Math.min(maxLen, len);
      const kx = (dx / len) * clampedLen;
      const ky = (dy / len) * clampedLen;
      joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    }

    joystickZone.addEventListener('pointerdown', (e) => {
      state.joystick.active = true;
      state.joystick.pointerId = e.pointerId;
      joystickZone.setPointerCapture(e.pointerId);
      setJoystickFromPointer(e.clientX, e.clientY);
      e.preventDefault();
    });

    joystickZone.addEventListener('pointermove', (e) => {
      if (!state.joystick.active || state.joystick.pointerId !== e.pointerId) return;
      setJoystickFromPointer(e.clientX, e.clientY);
      e.preventDefault();
    });

    function endJoystick(e) {
      if (!state.joystick.active) return;
      if (state.joystick.pointerId !== e.pointerId) return;
      state.joystick.active = false;
      state.joystick.pointerId = -1;
      state.joystick.x = 0;
      state.joystick.y = 0;
      joystickKnob.style.transform = 'translate(0px, 0px)';
      e.preventDefault();
    }

    joystickZone.addEventListener('pointerup', endJoystick);
    joystickZone.addEventListener('pointercancel', endJoystick);
  }

  function setupDomEvents() {
    window.addEventListener('resize', resizeCanvas);

    document.addEventListener('keydown', handleGlobalKeyDown);
    document.addEventListener('keyup', handleGlobalKeyUp);

    canvas.addEventListener('pointermove', (e) => {
      updatePointerFromEvent(e);
    });

    canvas.addEventListener('pointerleave', () => {
      state.pointer.inside = false;
    });

    canvas.addEventListener('pointerdown', (e) => {
      updatePointerFromEvent(e);
      if (!state.audioUnlocked) {
        ensureAudioContext();
        state.audioUnlocked = true;
        startBgm();
      }

      if (state.phase === PHASE_REWARD || state.phase === PHASE_GAMEOVER || state.upgradePanelOpen || state.barracksPanelOpen) {
        return;
      }

      if (state.buildMode) {
        tryBuildAtPointer();
        return;
      }

      const tc = worldToTileX(state.pointer.wx);
      const tr = worldToTileY(state.pointer.wy);
      const b = getBuildingAtTile(tc, tr);
      if (b) {
        if (b.type === 'upgrade') {
          openUpgradeOverlay();
        } else if (b.type === 'barracks') {
          openBarracksOverlay(b);
        }
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state.buildMode = null;
      updateSlotButtonState();
    });

    for (let i = 0; i < slotButtons.length; i += 1) {
      slotButtons[i].addEventListener('click', () => {
        const slot = slotButtons[i].dataset.slot;
        setBuildModeBySlot(slot);
      });
    }

    for (let i = 0; i < mobileActionButtons.length; i += 1) {
      mobileActionButtons[i].addEventListener('click', () => {
        const slot = mobileActionButtons[i].dataset.slot;
        setBuildModeBySlot(slot);
      });
    }

    if (upgradeOpenButton) {
      upgradeOpenButton.addEventListener('click', () => {
        if (state.upgradePanelOpen) {
          closeUpgradeOverlay();
        } else {
          openUpgradeOverlay();
        }
      });
    }

    if (startGameButton) {
      startGameButton.addEventListener('click', () => {
        startGameFromLobby();
      });
    }

    if (nicknameInputEl) {
      nicknameInputEl.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          startGameFromLobby();
          e.preventDefault();
        }
      });
    }

    if (spawnWorkerButton) {
      spawnWorkerButton.addEventListener('click', () => {
        trySpawnMiniScvManual();
      });
    }

    if (upgradeCloseButton) {
      upgradeCloseButton.addEventListener('click', () => {
        closeUpgradeOverlay();
      });
    }

    if (barracksUpgradeButton) {
      barracksUpgradeButton.addEventListener('click', () => {
        tryUpgradeSelectedBarracks();
      });
    }

    if (barracksCloseButton) {
      barracksCloseButton.addEventListener('click', () => {
        closeBarracksOverlay();
      });
    }

    if (centerCameraButton) {
      centerCameraButton.addEventListener('click', () => {
        const cc = state.commandCenter;
        if (!cc) return;
        const cp = getBuildingCenter(cc);
        state.player.x = cp.x;
        state.player.y = cp.y + TILE * 2;
        state.centerCameraTimer = 0.7;
      });
    }

    if (restartButton) {
      restartButton.addEventListener('click', () => {
        showLobby();
      });
    }

    setupJoystick();
  }

  setupDomEvents();
  resizeCanvas();
  resetGame();
  showLobby();
  requestAnimationFrame(frame);
})();
