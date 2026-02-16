const http = require('http');
const fs = require('fs/promises');
const path = require('path');
let WebSocketServer = null;
try {
  ({ WebSocketServer } = require('ws'));
} catch (err) {
  WebSocketServer = null;
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'leaderboard.json');
const MAX_BODY_SIZE = 2 * 1024 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ROOM_MAX_PLAYERS = 2;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_OFFLINE_TIMEOUT_MS = 30 * 1000;
const ROOM_STALE_DELETE_MS = 60 * 60 * 1000;
const ROOM_SOLO_START_DELAY_MS = 800;
const ROOM_DUO_START_DELAY_MS = 1800;
const ROOM_WS_PATH = '/ws';
const ROOM_INITIAL_RESOURCES = Math.max(0, toInt(process.env.ROOM_INITIAL_RESOURCES, 320));

const rooms = new Map();
const wsClientsByPlayer = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function nowMs() {
  return Date.now();
}

function makeDefaultDb() {
  return { players: {} };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;

  const allowAll = ALLOWED_ORIGINS.includes('*');
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return;

  res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
  if (!allowAll) {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toFinite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePlayerId(raw) {
  if (typeof raw !== 'string') return '';
  const id = raw.trim().slice(0, 16);
  if (id.length < 2) return '';
  if (/[\x00-\x1f]/.test(id)) return '';
  return id;
}

function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4 || code.length > 12) return '';
  return code;
}

function clampNum(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sanitizeSharedBuildings(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(240, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const b = rawList[i];
    if (!b || typeof b !== 'object') continue;
    const type = typeof b.type === 'string' ? b.type.trim().slice(0, 20) : '';
    if (!type) continue;
    out.push({
      type,
      c: clampNum(toInt(b.c), 0, 512),
      r: clampNum(toInt(b.r), 0, 512),
      w: clampNum(toInt(b.w, 1), 1, 6),
      h: clampNum(toInt(b.h, 1), 1, 6),
      level: clampNum(toInt(b.level, 1), 1, 20),
      hp: clampNum(toInt(b.hp, 0), 0, 999999),
      maxHp: clampNum(toInt(b.maxHp, 0), 0, 999999),
      ownerSlot: Number.isInteger(b.ownerSlot) ? clampNum(toInt(b.ownerSlot), 0, 1) : null,
      isMainCommand: !!b.isMainCommand,
    });
  }
  return out;
}

function sanitizeSharedUnits(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(480, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const u = rawList[i];
    if (!u || typeof u !== 'object') continue;
    const kind = typeof u.kind === 'string' ? u.kind.trim().slice(0, 20) : '';
    if (!kind) continue;
    out.push({
      kind,
      x: clampNum(toFinite(u.x, 0), -16384, 16384),
      y: clampNum(toFinite(u.y, 0), -16384, 16384),
      r: clampNum(toFinite(u.r, 8), 2, 42),
      facing: clampNum(toFinite(u.facing, 0), -Math.PI * 8, Math.PI * 8),
      hp: clampNum(toInt(u.hp, 0), 0, 999999),
      maxHp: clampNum(toInt(u.maxHp, 0), 0, 999999),
      ownerSlot: Number.isInteger(u.ownerSlot) ? clampNum(toInt(u.ownerSlot), 0, 1) : null,
    });
  }
  return out;
}

function sanitizeWorldState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const phase = typeof src.phase === 'string' ? src.phase.trim().slice(0, 20) : 'build';
  const sanitizeSlotNumberMap = (input, min = 0, max = 999999) => {
    const map = {};
    const srcMap = input && typeof input === 'object' ? input : {};
    for (let slot = 0; slot <= 1; slot += 1) {
      const key = String(slot);
      map[key] = clampNum(toInt(srcMap[key], 0), min, max);
    }
    return map;
  };
  return {
    wave: Math.max(1, toInt(src.wave, 1)),
    phase,
    phaseTimer: Math.max(0, toFinite(src.phaseTimer, 0)),
    runTime: Math.max(0, toFinite(src.runTime, 0)),
    killCount: Math.max(0, toInt(src.killCount, 0)),
    totalMineralsEarned: Math.max(0, toInt(src.totalMineralsEarned, 0)),
    resources: Math.max(0, toInt(src.resources, 0)),
    resourcesBySlot: sanitizeSlotNumberMap(src.resourcesBySlot),
    totalMineralsBySlot: sanitizeSlotNumberMap(src.totalMineralsBySlot),
    populationLimitBySlot: sanitizeSlotNumberMap(src.populationLimitBySlot),
    populationUsedBySlot: sanitizeSlotNumberMap(src.populationUsedBySlot),
    waveSpawnRemain: Math.max(0, toInt(src.waveSpawnRemain, 0)),
    waveSpawnTotal: Math.max(0, toInt(src.waveSpawnTotal, 0)),
    spawnCooldown: Math.max(0, toFinite(src.spawnCooldown, 0)),
    spawnInterval: Math.max(0.01, toFinite(src.spawnInterval, 0.6)),
    spawnBurst: Math.max(1, toInt(src.spawnBurst, 1)),
    bossSpawned: !!src.bossSpawned,
  };
}

function sanitizeWorldBuildings(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(360, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const b = rawList[i];
    if (!b || typeof b !== 'object') continue;
    const type = typeof b.type === 'string' ? b.type.trim().slice(0, 20) : '';
    if (!type) continue;
    out.push({
      id: Math.max(1, toInt(b.id, i + 1)),
      type,
      c: clampNum(toInt(b.c), 0, 512),
      r: clampNum(toInt(b.r), 0, 512),
      w: clampNum(toInt(b.w, 1), 1, 6),
      h: clampNum(toInt(b.h, 1), 1, 6),
      level: clampNum(toInt(b.level, 1), 1, 50),
      hp: clampNum(toInt(b.hp, 0), 0, 999999),
      maxHp: clampNum(toInt(b.maxHp, 0), 0, 999999),
      ownerSlot: Number.isInteger(b.ownerSlot) ? clampNum(toInt(b.ownerSlot), 0, 1) : null,
      isMainCommand: !!b.isMainCommand,
    });
  }
  return out;
}

function sanitizeWorldEnemies(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(720, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const e = rawList[i];
    if (!e || typeof e !== 'object') continue;
    const type = typeof e.type === 'string' ? e.type.trim().slice(0, 20) : '';
    if (!type) continue;
    out.push({
      id: Math.max(1, toInt(e.id, i + 1)),
      type,
      x: clampNum(toFinite(e.x, 0), -16384, 16384),
      y: clampNum(toFinite(e.y, 0), -16384, 16384),
      r: clampNum(toFinite(e.r, 8), 2, 60),
      hp: clampNum(toInt(e.hp, 0), 0, 999999),
      maxHp: clampNum(toInt(e.maxHp, 0), 0, 999999),
      attackCd: clampNum(toFinite(e.attackCd, 0), 0, 100),
      specialCd: clampNum(toFinite(e.specialCd, 0), 0, 100),
      dashCd: clampNum(toFinite(e.dashCd, 0), 0, 100),
      dashTimer: clampNum(toFinite(e.dashTimer, 0), 0, 100),
      wallTargetId: Math.max(0, toInt(e.wallTargetId, 0)),
      path: [],
      pathIndex: 0,
      repathCd: clampNum(toFinite(e.repathCd, 0.2), 0, 10),
      flash: clampNum(toFinite(e.flash, 0), 0, 1),
    });
  }
  return out;
}

function sanitizeWorldMinerals(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(520, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const m = rawList[i];
    if (!m || typeof m !== 'object') continue;
    out.push({
      id: Math.max(1, toInt(m.id, i + 1)),
      c: clampNum(toInt(m.c), 0, 512),
      r: clampNum(toInt(m.r), 0, 512),
      x: clampNum(toFinite(m.x, 0), -16384, 16384),
      y: clampNum(toFinite(m.y, 0), -16384, 16384),
      radius: clampNum(toFinite(m.radius, 8), 1, 100),
      total: Math.max(0, toInt(m.total, 0)),
      chunk: Math.max(1, toInt(m.chunk, 1)),
      difficulty: clampNum(toFinite(m.difficulty, 1), 0.1, 999),
      flash: clampNum(toFinite(m.flash, 0), 0, 1),
      special: !!m.special,
    });
  }
  return out;
}

function sanitizeWorldProjectiles(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(1200, rawList.length);
  for (let i = 0; i < limit; i += 1) {
    const p = rawList[i];
    if (!p || typeof p !== 'object') continue;
    const team = p.team === 'enemy' ? 'enemy' : 'friendly';
    out.push({
      x: clampNum(toFinite(p.x, 0), -16384, 16384),
      y: clampNum(toFinite(p.y, 0), -16384, 16384),
      vx: clampNum(toFinite(p.vx, 0), -4096, 4096),
      vy: clampNum(toFinite(p.vy, 0), -4096, 4096),
      damage: Math.max(0, toInt(p.damage, 0)),
      team,
      color: typeof p.color === 'string' ? p.color.slice(0, 24) : '#ffffff',
      radius: clampNum(toFinite(p.radius, 2), 1, 20),
      life: clampNum(toFinite(p.life, 0.5), 0, 15),
      ownerSlot: Number.isInteger(p.ownerSlot) ? clampNum(toInt(p.ownerSlot), 0, 1) : null,
    });
  }
  return out;
}

function sanitizeWorldSnapshot(raw, sourcePlayerId = '', sourceSlot = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    sourcePlayerId,
    sourceSlot,
    updatedAt: nowMs(),
    state: sanitizeWorldState(src.state),
    buildings: sanitizeWorldBuildings(src.buildings),
    enemies: sanitizeWorldEnemies(src.enemies),
    units: sanitizeSharedUnits(src.units),
    minerals: sanitizeWorldMinerals(src.minerals),
    projectiles: sanitizeWorldProjectiles(src.projectiles),
  };
}

function compareScoresDesc(a, b) {
  if ((b.wave || 0) !== (a.wave || 0)) return (b.wave || 0) - (a.wave || 0);
  if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
  if ((b.minerals || 0) !== (a.minerals || 0)) return (b.minerals || 0) - (a.minerals || 0);
  return (b.timeSec || 0) - (a.timeSec || 0);
}

function buildRankings(db) {
  const rows = [];
  const players = db.players || {};
  const keys = Object.keys(players);
  for (let i = 0; i < keys.length; i += 1) {
    const player = players[keys[i]];
    if (!player || !player.bestScore) continue;
    rows.push({
      playerId: player.playerId,
      timeSec: toInt(player.bestScore.timeSec),
      wave: toInt(player.bestScore.wave, 1),
      kills: toInt(player.bestScore.kills),
      minerals: toInt(player.bestScore.minerals),
      updatedAt: toInt(player.bestScore.updatedAt),
    });
  }
  rows.sort(compareScoresDesc);
  return rows.slice(0, 100);
}

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    await fs.writeFile(DATA_FILE, JSON.stringify(makeDefaultDb(), null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDbFile();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid db');
    if (!parsed.players || typeof parsed.players !== 'object') {
      parsed.players = {};
    }
    return parsed;
  } catch (err) {
    const fallback = makeDefaultDb();
    await fs.writeFile(DATA_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

async function writeDb(db) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let dbQueue = Promise.resolve();
function withDb(mutator) {
  const runner = async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  };
  dbQueue = dbQueue.then(runner, runner);
  return dbQueue;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new HttpError(413, '요청 크기가 너무 큽니다', 'BODY_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new HttpError(400, 'JSON 형식이 올바르지 않습니다', 'BAD_JSON'));
      }
    });
    req.on('error', () => reject(new HttpError(400, '요청을 읽을 수 없습니다', 'BAD_REQUEST')));
  });
}

function makeRoomCode() {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    s += ROOM_CODE_CHARS[idx];
  }
  return s;
}

function makeRoomSeed() {
  return Math.max(1, Math.floor(Math.random() * 2147483646));
}

function wsSendJson(ws, payload) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    return false;
  }
}

function unbindWsClient(ws) {
  if (!ws || !ws._playerId) return;
  const playerId = ws._playerId;
  const set = wsClientsByPlayer.get(playerId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      wsClientsByPlayer.delete(playerId);
    }
  }
  ws._playerId = '';
  ws._roomCode = '';
}

function bindWsClient(ws, playerId, roomCode) {
  if (!ws) return false;
  const safePlayerId = normalizePlayerId(playerId);
  const safeRoomCode = normalizeRoomCode(roomCode);
  if (!safePlayerId || !safeRoomCode) return false;

  const room = rooms.get(safeRoomCode);
  if (!room || !room.players.some((p) => p.playerId === safePlayerId)) {
    return false;
  }

  unbindWsClient(ws);
  let set = wsClientsByPlayer.get(safePlayerId);
  if (!set) {
    set = new Set();
    wsClientsByPlayer.set(safePlayerId, set);
  }
  set.add(ws);
  ws._playerId = safePlayerId;
  ws._roomCode = safeRoomCode;
  return true;
}

function clearWsRoomBindings(roomCode) {
  if (!roomCode) return;
  const safeRoomCode = normalizeRoomCode(roomCode);
  if (!safeRoomCode) return;

  for (const set of wsClientsByPlayer.values()) {
    const sockets = Array.from(set);
    for (let i = 0; i < sockets.length; i += 1) {
      const ws = sockets[i];
      if (!ws) continue;
      if (normalizeRoomCode(ws._roomCode || '') !== safeRoomCode) continue;
      wsSendJson(ws, {
        type: 'room',
        reason: 'closed',
        at: nowMs(),
        room: null,
        roomCode: safeRoomCode,
      });
      unbindWsClient(ws);
    }
  }
}

function pushRoomSnapshot(room, reason = 'update') {
  if (!room) return;
  const sentByPlayer = new Map();

  for (let i = 0; i < room.players.length; i += 1) {
    const player = room.players[i];
    const sockets = wsClientsByPlayer.get(player.playerId);
    if (!sockets || sockets.size === 0) continue;

    let text = sentByPlayer.get(player.playerId);
    if (!text) {
      const payload = {
        type: 'room',
        reason,
        at: nowMs(),
        room: roomSnapshot(room, player.playerId),
      };
      text = JSON.stringify(payload);
      sentByPlayer.set(player.playerId, text);
    }

    for (const ws of sockets) {
      if (!ws || ws.readyState !== 1) continue;
      if (normalizeRoomCode(ws._roomCode || '') !== room.roomCode) continue;
      try {
        ws.send(text);
      } catch (err) {
        // ignore transient websocket send failures
      }
    }
  }
}

function findRoomByPlayer(playerId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.playerId === playerId)) return room;
  }
  return null;
}

function ensureRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    throw new HttpError(404, '방을 찾을 수 없습니다', 'ROOM_NOT_FOUND');
  }
  return room;
}

function ensureRoomMember(room, playerId) {
  const member = room.players.find((p) => p.playerId === playerId);
  if (!member) {
    throw new HttpError(403, '방 참여자가 아닙니다', 'ROOM_NOT_MEMBER');
  }
  return member;
}

function markRoomFailed(room, reason = 'command_destroyed', failedBy = '') {
  if (!room) return;
  if (room.status === 'failed') return;
  room.status = 'failed';
  room.failReason = reason;
  room.failedBy = failedBy || '';
  room.failedAt = nowMs();
  room.startAt = 0;
  room.updatedAt = nowMs();
}

function refreshRoomState(room) {
  if (!room) return;

  const now = nowMs();

  if (room.status === 'starting' && room.startAt > 0 && now >= room.startAt) {
    room.status = 'started';
    room.updatedAt = now;
  }

  if (room.status === 'started') {
    for (let i = 0; i < room.players.length; i += 1) {
      const p = room.players[i];
      if (p.hasHeartbeat && p.commandHp <= 0) {
        markRoomFailed(room, 'command_destroyed', p.playerId);
        break;
      }
      if (now - p.lastSeenAt > ROOM_OFFLINE_TIMEOUT_MS) {
        markRoomFailed(room, 'player_disconnected', p.playerId);
        break;
      }
    }
  }
}

function tryScheduleRoomStart(room) {
  if (!room) return;
  if (room.status === 'failed' || room.status === 'started') return;

  const count = room.players.length;
  const allReady = count > 0 && room.players.every((p) => p.ready);
  const canSolo = count === 1 && room.players[0].ready;
  const canDuo = count === ROOM_MAX_PLAYERS && allReady;

  if (canSolo || canDuo) {
    room.status = 'starting';
    room.startAt = nowMs() + (canSolo ? ROOM_SOLO_START_DELAY_MS : ROOM_DUO_START_DELAY_MS);
    room.seed = room.seed || makeRoomSeed();
    room.updatedAt = nowMs();
    return;
  }

  if (room.status === 'starting') {
    room.status = 'waiting';
    room.startAt = 0;
    room.updatedAt = nowMs();
  }
}

function removePlayerFromRoom(room, playerId, reason = 'player_left') {
  if (!room) return;
  const idx = room.players.findIndex((p) => p.playerId === playerId);
  if (idx < 0) return;

  room.players.splice(idx, 1);
  room.updatedAt = nowMs();

  if (room.players.length === 0) {
    rooms.delete(room.roomCode);
    clearWsRoomBindings(room.roomCode);
    return;
  }

  if (room.status === 'started' || room.status === 'starting') {
    markRoomFailed(room, reason, playerId);
  } else {
    tryScheduleRoomStart(room);
  }
}

function roomSnapshot(room, viewerPlayerId = '') {
  refreshRoomState(room);

  const now = nowMs();
  const players = room.players
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({
      playerId: p.playerId,
      slot: p.slot,
      ready: !!p.ready,
      rewardChosen: !!p.rewardChosen,
      online: now - p.lastSeenAt <= ROOM_OFFLINE_TIMEOUT_MS,
      commandHp: toInt(p.commandHp),
      wave: toInt(p.wave, 1),
      phase: typeof p.phase === 'string' ? p.phase : '',
      resources: Math.max(0, toInt(p.resources, 0)),
      totalMineralsEarned: Math.max(0, toInt(p.totalMineralsEarned, 0)),
      populationUsed: Math.max(0, toInt(p.populationUsed, 0)),
      populationLimit: Math.max(0, toInt(p.populationLimit, 0)),
      x: toFinite(p.x, 0),
      y: toFinite(p.y, 0),
      facing: toFinite(p.facing, 0),
      buildings: sanitizeSharedBuildings(p.buildings),
      units: sanitizeSharedUnits(p.units),
      lastSeenAt: p.lastSeenAt,
    }));

  const you = players.find((p) => p.playerId === viewerPlayerId) || null;

  return {
    roomCode: room.roomCode,
    status: room.status,
    startAt: room.startAt,
    seed: room.seed,
    maxPlayers: ROOM_MAX_PLAYERS,
    failReason: room.failReason || '',
    failedBy: room.failedBy || '',
    players,
    world: room.world || null,
    you,
  };
}

function cleanupRooms() {
  const now = nowMs();
  for (const [code, room] of rooms) {
    refreshRoomState(room);
    const age = now - room.updatedAt;
    if (room.players.length === 0 || age > ROOM_STALE_DELETE_MS) {
      rooms.delete(code);
      clearWsRoomBindings(code);
    }
  }
}

async function ensureRegisteredPlayer(playerId) {
  const db = await readDb();
  const players = db.players || {};
  if (!players[playerId]) {
    throw new HttpError(404, '등록되지 않은 아이디입니다', 'ID_NOT_FOUND');
  }
}

async function handleApi(req, res, urlObj) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const pathname = urlObj.pathname;
  cleanupRooms();

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/rankings' && req.method === 'GET') {
    const db = await readDb();
    sendJson(res, 200, { ok: true, rankings: buildRankings(db) });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다 (2~16자)', 'INVALID_ID');
    }

    const result = await withDb(async (db) => {
      const players = db.players || (db.players = {});
      if (players[playerId]) {
        throw new HttpError(409, '이미 존재하는 아이디입니다', 'ID_EXISTS');
      }
      players[playerId] = {
        playerId,
        createdAt: nowMs(),
        bestScore: null,
        lastPlayedAt: 0,
      };
      return { ok: true, playerId };
    });

    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/score' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다', 'INVALID_ID');
    }

    const payload = {
      playerId,
      timeSec: toInt(body.timeSec),
      wave: Math.max(1, toInt(body.wave, 1)),
      kills: toInt(body.kills),
      minerals: toInt(body.minerals),
      updatedAt: nowMs(),
    };

    const result = await withDb(async (db) => {
      const players = db.players || (db.players = {});
      const player = players[playerId];
      if (!player) {
        throw new HttpError(404, '등록되지 않은 아이디입니다', 'ID_NOT_FOUND');
      }

      const prev = player.bestScore;
      const updated = !prev || compareScoresDesc(payload, prev) < 0;
      if (updated) {
        player.bestScore = payload;
      }
      player.lastPlayedAt = nowMs();
      return { ok: true, updated };
    });

    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/rooms/create' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const requestedCodeRaw = typeof body.roomCode === 'string' ? body.roomCode : '';
    const requestedCode = normalizeRoomCode(requestedCodeRaw);
    if (requestedCodeRaw.trim() && !requestedCode) {
      throw new HttpError(400, '방 코드 형식이 올바르지 않습니다 (영문/숫자 4~12자)', 'INVALID_ROOM_CODE');
    }
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다', 'INVALID_ID');
    }

    await ensureRegisteredPlayer(playerId);

    const prevRoom = findRoomByPlayer(playerId);
    if (prevRoom) {
      removePlayerFromRoom(prevRoom, playerId, 'player_left');
    }

    let code = requestedCode;
    if (code) {
      if (rooms.has(code)) {
        throw new HttpError(409, '이미 사용 중인 방 코드입니다', 'ROOM_CODE_TAKEN');
      }
    } else {
      for (let i = 0; i < 32; i += 1) {
        const candidate = makeRoomCode();
        if (!rooms.has(candidate)) {
          code = candidate;
          break;
        }
      }
    }
    if (!code) {
      throw new HttpError(500, '방 코드를 생성하지 못했습니다', 'ROOM_CREATE_FAILED');
    }

    const now = nowMs();
    const room = {
      roomCode: code,
      status: 'waiting',
      startAt: 0,
      seed: makeRoomSeed(),
      failReason: '',
      failedBy: '',
      failedAt: 0,
      world: null,
      createdAt: now,
      updatedAt: now,
      players: [
        {
          playerId,
          slot: 0,
          ready: false,
          joinedAt: now,
          lastSeenAt: now,
          hasHeartbeat: false,
          commandHp: 0,
          wave: 1,
          phase: 'build',
          rewardChosen: false,
          resources: ROOM_INITIAL_RESOURCES,
          totalMineralsEarned: 0,
          populationUsed: 0,
          populationLimit: 0,
          x: 0,
          y: 0,
          facing: 0,
          buildings: [],
          units: [],
        },
      ],
    };

    rooms.set(code, room);

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    pushRoomSnapshot(room, 'created');
    return;
  }

  if (pathname === '/api/rooms/join' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다', 'INVALID_ID');
    }
    if (!roomCode) {
      throw new HttpError(400, '방 코드 형식이 올바르지 않습니다', 'INVALID_ROOM_CODE');
    }

    await ensureRegisteredPlayer(playerId);

    const room = ensureRoom(roomCode);
    refreshRoomState(room);

    if (room.status !== 'waiting') {
      throw new HttpError(409, '입장 가능한 상태가 아닙니다', 'ROOM_NOT_JOINABLE');
    }

    const existing = room.players.find((p) => p.playerId === playerId);
    if (!existing && room.players.length >= ROOM_MAX_PLAYERS) {
      throw new HttpError(409, '방이 가득 찼습니다', 'ROOM_FULL');
    }

    const prevRoom = findRoomByPlayer(playerId);
    if (prevRoom && prevRoom.roomCode !== room.roomCode) {
      removePlayerFromRoom(prevRoom, playerId, 'player_left');
    }

    if (!existing) {
      const used = new Set(room.players.map((p) => p.slot));
      const slot = used.has(0) ? 1 : 0;
      const now = nowMs();
      room.players.push({
        playerId,
        slot,
        ready: false,
        joinedAt: now,
        lastSeenAt: now,
        hasHeartbeat: false,
        commandHp: 0,
        wave: 1,
        phase: 'build',
        rewardChosen: false,
        resources: ROOM_INITIAL_RESOURCES,
        totalMineralsEarned: 0,
        populationUsed: 0,
        populationLimit: 0,
        x: 0,
        y: 0,
        facing: 0,
        buildings: [],
        units: [],
      });
      room.updatedAt = now;
    } else {
      existing.lastSeenAt = nowMs();
      room.updatedAt = nowMs();
    }

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    pushRoomSnapshot(room, 'joined');
    return;
  }

  if (pathname === '/api/rooms/ready' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!playerId || !roomCode) {
      throw new HttpError(400, '요청 값이 올바르지 않습니다', 'INVALID_REQUEST');
    }

    const room = ensureRoom(roomCode);
    refreshRoomState(room);

    if (room.status !== 'waiting' && room.status !== 'starting') {
      throw new HttpError(409, '레디할 수 없는 상태입니다', 'ROOM_NOT_READYABLE');
    }

    const member = ensureRoomMember(room, playerId);
    member.ready = !!body.ready;
    member.lastSeenAt = nowMs();
    room.updatedAt = nowMs();

    tryScheduleRoomStart(room);
    refreshRoomState(room);

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    pushRoomSnapshot(room, 'ready');
    return;
  }

  if (pathname === '/api/rooms/state' && req.method === 'GET') {
    const playerId = normalizePlayerId(urlObj.searchParams.get('playerId') || '');
    const roomCode = normalizeRoomCode(urlObj.searchParams.get('roomCode') || '');
    if (!playerId || !roomCode) {
      throw new HttpError(400, '요청 값이 올바르지 않습니다', 'INVALID_REQUEST');
    }

    const room = ensureRoom(roomCode);
    const member = ensureRoomMember(room, playerId);
    const prevStatus = room.status;
    const prevStartAt = room.startAt;
    const prevFailReason = room.failReason;
    const prevFailedBy = room.failedBy;
    member.lastSeenAt = nowMs();
    room.updatedAt = nowMs();

    refreshRoomState(room);

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    if (
      room.status !== prevStatus
      || room.startAt !== prevStartAt
      || room.failReason !== prevFailReason
      || room.failedBy !== prevFailedBy
    ) {
      pushRoomSnapshot(room, 'state_changed');
    }
    return;
  }

  if (pathname === '/api/rooms/heartbeat' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!playerId || !roomCode) {
      throw new HttpError(400, '요청 값이 올바르지 않습니다', 'INVALID_REQUEST');
    }

    const room = ensureRoom(roomCode);
    const member = ensureRoomMember(room, playerId);

    member.lastSeenAt = nowMs();
    member.hasHeartbeat = true;
    member.x = toFinite(body.x, member.x || 0);
    member.y = toFinite(body.y, member.y || 0);
    member.facing = toFinite(body.facing, member.facing || 0);
    member.commandHp = toInt(body.commandHp, member.commandHp || 0);
    member.wave = Math.max(1, toInt(body.wave, member.wave || 1));
    member.phase = typeof body.phase === 'string' ? body.phase.slice(0, 20) : member.phase;
    member.rewardChosen = !!body.rewardChosen;
    member.resources = Math.max(0, toInt(body.resources, member.resources || 0));
    member.totalMineralsEarned = Math.max(0, toInt(body.totalMineralsEarned, member.totalMineralsEarned || 0));
    member.populationUsed = Math.max(0, toInt(body.populationUsed, member.populationUsed || 0));
    member.populationLimit = Math.max(0, toInt(body.populationLimit, member.populationLimit || 0));
    member.buildings = sanitizeSharedBuildings(body.buildings);
    member.units = sanitizeSharedUnits(body.units);

    if (room.status === 'started' && member.slot === 0 && body.world && typeof body.world === 'object') {
      room.world = sanitizeWorldSnapshot(body.world, member.playerId, member.slot);
    }

    room.updatedAt = nowMs();

    if (room.status === 'started' && member.commandHp <= 0) {
      markRoomFailed(room, 'command_destroyed', member.playerId);
    }

    refreshRoomState(room);

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    pushRoomSnapshot(room, 'heartbeat');
    return;
  }

  if (pathname === '/api/rooms/fail' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!playerId || !roomCode) {
      throw new HttpError(400, '요청 값이 올바르지 않습니다', 'INVALID_REQUEST');
    }

    const room = ensureRoom(roomCode);
    ensureRoomMember(room, playerId);

    const reason = typeof body.reason === 'string' && body.reason ? body.reason.slice(0, 32) : 'command_destroyed';
    markRoomFailed(room, reason, playerId);

    sendJson(res, 200, {
      ok: true,
      room: roomSnapshot(room, playerId),
    });
    pushRoomSnapshot(room, 'failed');
    return;
  }

  if (pathname === '/api/rooms/leave' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!playerId || !roomCode) {
      throw new HttpError(400, '요청 값이 올바르지 않습니다', 'INVALID_REQUEST');
    }

    const room = ensureRoom(roomCode);
    removePlayerFromRoom(room, playerId, 'player_left');

    sendJson(res, 200, { ok: true });
    const remained = rooms.get(roomCode);
    if (remained) {
      pushRoomSnapshot(remained, 'left');
    }
    return;
  }

  throw new HttpError(404, 'API 경로를 찾을 수 없습니다', 'NOT_FOUND');
}

async function serveStatic(req, res, pathname) {
  let requestPath = pathname;
  if (requestPath === '/') {
    requestPath = '/index.html';
  }

  const decoded = decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT_DIR, decoded));
  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { ok: false, error: '접근이 허용되지 않습니다', code: 'FORBIDDEN' });
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: '파일을 찾을 수 없습니다', code: 'NOT_FOUND' });
    return;
  }

  let finalPath = filePath;
  if (stat.isDirectory()) {
    finalPath = path.join(filePath, 'index.html');
  }

  try {
    const data = await fs.readFile(finalPath);
    const ext = path.extname(finalPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: '파일을 찾을 수 없습니다', code: 'NOT_FOUND' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    applyCorsHeaders(req, res);

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
      return;
    }
    await serveStatic(req, res, urlObj.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof HttpError ? err.message : '서버 오류가 발생했습니다';
    sendJson(res, status, { ok: false, error: message, code });
  }
});

if (WebSocketServer) {
  const wsServer = new WebSocketServer({ noServer: true });

  wsServer.on('connection', (ws, req, authInfo = {}) => {
    ws._playerId = '';
    ws._roomCode = '';

    ws.on('close', () => {
      unbindWsClient(ws);
    });

    ws.on('error', () => {
      // ignore websocket transport errors
    });

    ws.on('message', (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(String(raw));
      } catch (err) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ping') {
        wsSendJson(ws, { type: 'pong', at: nowMs() });
        return;
      }

      if (msg.type === 'auth') {
        const playerId = normalizePlayerId(msg.playerId);
        const roomCode = normalizeRoomCode(msg.roomCode);
        if (!bindWsClient(ws, playerId, roomCode)) {
          wsSendJson(ws, { type: 'error', code: 'WS_AUTH_FAILED', message: '웹소켓 인증 실패' });
          ws.close(1008, 'auth failed');
          return;
        }
        const room = rooms.get(roomCode);
        if (room) {
          wsSendJson(ws, { type: 'room', reason: 'auth', at: nowMs(), room: roomSnapshot(room, playerId) });
        }
      }
    });

    const playerId = normalizePlayerId(authInfo.playerId || '');
    const roomCode = normalizeRoomCode(authInfo.roomCode || '');
    if (!bindWsClient(ws, playerId, roomCode)) {
      wsSendJson(ws, { type: 'error', code: 'WS_AUTH_FAILED', message: '웹소켓 인증 실패' });
      ws.close(1008, 'auth failed');
      return;
    }

    const room = rooms.get(roomCode);
    if (room) {
      wsSendJson(ws, { type: 'room', reason: 'connected', at: nowMs(), room: roomSnapshot(room, playerId) });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (urlObj.pathname !== ROOM_WS_PATH) {
        socket.destroy();
        return;
      }
      const playerId = normalizePlayerId(urlObj.searchParams.get('playerId') || '');
      const roomCode = normalizeRoomCode(urlObj.searchParams.get('roomCode') || '');
      if (!playerId || !roomCode) {
        socket.destroy();
        return;
      }

      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit('connection', ws, req, { playerId, roomCode });
      });
    } catch (err) {
      socket.destroy();
    }
  });
}

server.on('error', (err) => {
  console.error(`[Mineral Survivor] 서버 시작 실패: ${err.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[Mineral Survivor] http://${HOST}:${PORT}`);
});
