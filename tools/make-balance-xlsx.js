#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'balance.config.js');
const OUT_PATH = path.join(ROOT, 'balance.xlsx');

const CATEGORY_ORDER = [
  'economy',
  'buildings',
  'player',
  'miniScv',
  'barracks',
  'upgrades',
  'cards',
  'enemies',
  'waves',
  'specialMineral',
];

const CATEGORY_DESC = {
  economy: '자원/비용/패널티 관련 공통 경제 밸런스',
  buildings: '건물 기본 스탯, 비용, 크기, 색상',
  player: '메인 SCV(플레이어) 기본 능력치',
  miniScv: '미니 SCV 자동 채굴 유닛 기본 능력치',
  barracks: '병영 업그레이드/병사 생산 스탯',
  upgrades: '업그레이드 타워의 강화 수치와 비용 스케일',
  cards: '웨이브 보상 카드 효과 수치',
  enemies: '적 성장/조합 확률/타입별 능력치',
  waves: '웨이브 시간, 스폰량, 난이도 곡선',
  specialMineral: '특수 미네랄 생성 조건 및 보상 배율',
};

const BUILDING_NAME = {
  command: '커맨드 센터',
  barracks: '병영',
  turret: '방어 타워',
  wall: '성벽',
  supply: '보급 타워',
  upgrade: '업그레이드 타워',
};

const ENEMY_NAME = {
  grunt: '기본 적',
  ranged: '원거리 적',
  charger: '돌진 적',
  boss: '보스',
};

const UPGRADE_NAME = {
  attack: '공격력',
  defense: '방어력',
  hp: '최대 체력',
  speed: '이동속도',
};

function loadBalance() {
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'balance.config.js' });
  const data = sandbox.window && sandbox.window.GAME_BALANCE;
  if (!data || typeof data !== 'object') {
    throw new Error('balance.config.js 에서 window.GAME_BALANCE를 찾을 수 없습니다.');
  }
  return data;
}

function detectType(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return 'json';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function valueToCell(type, value) {
  if (type === 'json') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function flattenObject(obj, prefix = '', out = []) {
  if (Array.isArray(obj)) {
    out.push({ key: prefix, value: obj });
    return out;
  }
  if (!obj || typeof obj !== 'object') {
    out.push({ key: prefix, value: obj });
    return out;
  }

  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const next = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, next, out);
    } else {
      out.push({ key: next, value });
    }
  }
  return out;
}

function describeEconomy(key) {
  const map = {
    manualWorkerCost: '수동으로 미니 SCV 1기를 생산할 때 드는 미네랄 비용',
    startResources: '게임 시작 시 보유하는 초기 미네랄',
    enemyKillReward: '적 1기 처치 시 즉시 획득하는 미네랄',
    playerDeathPenalty: '메인 SCV가 파괴됐을 때 차감되는 미네랄',
    repairMineralPerHp: '건물 체력 1을 수리할 때 소비되는 미네랄',
  };
  return map[key] || '경제 밸런스 값';
}

function describeBuildings(key) {
  const map = {
    basePopulation: '기본 최대 인구(보급 타워/카드 보너스 제외)',
    hpLevelScalePerLevel: '건물 레벨 1 증가 시 최대 체력 증가 비율',
    supplyCostExpPerBuilt: '보급 타워를 지을수록 비용이 증가하는 지수 배율(누적)',
    supplyCostFlatPerBuilt: '보급 타워를 지을수록 비용에 추가되는 고정 증가치(누적)',
    supplyPopBonus: '보급 타워 1개당 증가하는 최대 인구',
    turretUpgradeCostBase: '타워 업그레이드 비용 계산의 기본 계수',
    turretUpgradeCostPerLevel: '타워 레벨이 오를수록 추가되는 업그레이드 비용 계수',
  };
  if (map[key]) return map[key];

  const m = key.match(/^defs\.([^.]+)\.(cost|w|h|hp|color)$/);
  if (m) {
    const bType = m[1];
    const prop = m[2];
    const bName = BUILDING_NAME[bType] || bType;
    if (prop === 'cost') return `${bName} 건설 비용`;
    if (prop === 'w') return `${bName} 가로 타일 크기`;
    if (prop === 'h') return `${bName} 세로 타일 크기`;
    if (prop === 'hp') return `${bName} 레벨 1 기준 최대 체력`;
    if (prop === 'color') return `${bName} 본체 색상(16진수)`;
  }

  return '건물 밸런스 값';
}

function describePlayer(key) {
  const map = {
    baseSpeed: '메인 SCV 기본 이동 속도',
    baseDamage: '메인 SCV 기본 공격력',
    baseDefense: '메인 SCV 기본 방어력',
    baseMaxHp: '메인 SCV 기본 최대 체력',
    mineRate: '메인 SCV 기본 채굴 속도 계수',
  };
  return map[key] || '메인 SCV 밸런스 값';
}

function describeMiniScv(key) {
  const map = {
    baseSpeed: '미니 SCV 기본 이동 속도',
    baseDamage: '미니 SCV 기본 공격력',
    baseMaxHp: '미니 SCV 기본 최대 체력',
    mineRate: '미니 SCV 기본 채굴 속도 계수',
    carryChunkMul: '미니 SCV 1회 채굴량 배율(미네랄 chunk에 곱해짐)',
  };
  return map[key] || '미니 SCV 밸런스 값';
}

function describeBarracks(key) {
  const exact = {
    levels: '병영 레벨별 생산 주기/최대 병력/스탯 배율(JSON 배열)',
    upgradeCostBase: '병영 업그레이드 기본 비용',
    upgradeCostPerLevel: '병영 레벨당 추가 업그레이드 비용',
  };
  if (exact[key]) return exact[key];

  const m = key.match(/^soldier\.(.+)$/);
  if (m) {
    const prop = m[1];
    const map = {
      baseSpeed: '병영 병사 기본 이동 속도',
      speedPerLevel: '병영 레벨당 병사 속도 추가치',
      speedStatMulFactor: '병영 statMul이 병사 속도에 반영되는 계수',
      baseDamage: '병영 병사 기본 공격력',
      damagePerLevel: '병영 레벨당 병사 공격력 추가치',
      baseMaxHp: '병영 병사 기본 최대 체력',
      hpPerLevel: '병영 레벨당 병사 최대 체력 추가치',
      baseRange: '병영 병사 기본 사거리',
      rangePerLevel: '병영 레벨당 병사 사거리 추가치',
      shootCooldown: '병영 병사 공격 쿨타임(초)',
    };
    return map[prop] || `병영 병사 설정: ${prop}`;
  }

  return '병영 밸런스 값';
}

function describeUpgrades(key) {
  if (key === 'costScale') return '업그레이드 레벨당 비용 증가 배율';
  const m = key.match(/^(attack|defense|hp|speed)\.(baseCost|gainPerLevel)$/);
  if (m) {
    const up = UPGRADE_NAME[m[1]] || m[1];
    if (m[2] === 'baseCost') return `${up} 업그레이드 Lv.0 기준 비용`;
    return `${up} 업그레이드 1레벨당 증가량`;
  }
  return '업그레이드 밸런스 값';
}

function describeCards(key) {
  const map = {
    towerRange: '카드 선택 시 타워 사거리 증가 비율',
    scvMineSpeed: '카드 선택 시 SCV 채굴 속도 증가 비율',
    barracksRate: '카드 선택 시 병영 생산 속도 향상 비율',
    turretDamage: '카드 선택 시 타워 공격력 증가 비율',
    wallHp: '카드 선택 시 성벽 최대 체력 증가 비율',
    supplyBonus: '카드 선택 시 추가 최대 인구',
    mineralRain: '카드 선택 시 즉시 획득 미네랄',
    baseRepairRatio: '카드 선택 시 커맨드 센터 즉시 회복 비율',
  };
  return map[key] || '카드 밸런스 값';
}

function describeEnemies(key) {
  const exact = {
    deathExplosionChance: '적 처치 시 폭발 사운드/연출이 재생될 확률',
    'scale.perWave': '웨이브당 기본 능력치 증가량',
    'scale.easeBase': '초반 완화 곡선의 기본 배율',
    'scale.easeWeight': '초반 완화 곡선의 가중치',
    'composition.rangedStartWave': '원거리 적이 등장하기 시작하는 웨이브',
    'composition.rangedChanceBase': '원거리 적 기본 등장 확률',
    'composition.rangedChanceGrowthPerWave': '웨이브 증가 시 원거리 적 확률 증가량',
    'composition.rangedChanceCap': '원거리 적 등장 확률 상한',
    'composition.chargerStartWave': '돌진 적이 등장하기 시작하는 웨이브',
    'composition.chargerChanceBase': '돌진 적 기본 등장 확률',
    'composition.chargerChanceGrowthPerWave': '웨이브 증가 시 돌진 적 확률 증가량',
    'composition.chargerChanceCap': '돌진 적 등장 확률 상한',
  };
  if (exact[key]) return exact[key];

  const m = key.match(/^types\.([^.]+)\.(hp|speed|damage|attackRange|shootRange)$/);
  if (m) {
    const eName = ENEMY_NAME[m[1]] || m[1];
    const prop = m[2];
    if (prop === 'hp') return `${eName} 기본 최대 체력`;
    if (prop === 'speed') return `${eName} 기본 이동 속도`;
    if (prop === 'damage') return `${eName} 기본 공격력`;
    if (prop === 'attackRange') return `${eName} 근접 공격 유효 거리`;
    if (prop === 'shootRange') return `${eName} 원거리 공격 사거리(0이면 원거리 없음)`;
  }

  return '적 밸런스 값';
}

function describeWaves(key) {
  const exact = {
    easeByWave: '웨이브별 초반 난이도 완화 계수(JSON 배열, 1웨이브부터 순서대로 적용)',
    buildDurationBase: '준비 페이즈 기본 시간(초)',
    buildDurationPerWave: '웨이브당 준비 시간 감소량',
    buildDurationMin: '준비 페이즈 최소 시간(초)',
    combatDurationBase: '전투 페이즈 기본 시간(초)',
    combatDurationPerWave: '웨이브당 전투 시간 증가량',
    combatDurationBonusCap: '전투 시간 추가 최대치',
    firstWaveBuildDuration: '1웨이브 전용 준비 시간(초)',
    spawnTotalBase: '웨이브 스폰 수 기본값',
    spawnTotalPerWave: '웨이브당 스폰 수 증가량',
    spawnTotalMin: '웨이브 최소 스폰 수',
    spawnIntervalBase: '적 스폰 간격 기본값(초)',
    spawnIntervalPerWave: '웨이브당 스폰 간격 감소량',
    spawnIntervalMin: '스폰 간격 계산용 하한',
    spawnIntervalFloor: '최종 스폰 간격 최소값',
    spawnIntervalEasePenalty: '초반 완화 적용 시 스폰 간격 보정치',
    spawnBurstBase: '한 번에 나오는 적 수(버스트) 기본값',
    spawnBurstStepWave: '버스트가 증가하는 웨이브 간격',
    spawnBurstMax: '버스트 최대값',
    spawnBurstEaseBase: '초반 완화 시 버스트 계산 기본 배율',
    spawnBurstEaseWeight: '초반 완화 시 버스트 계산 가중치',
    firstWaveBurst: '1웨이브 전용 버스트 수',
    spawnInitialCooldown: '전투 시작 직후 첫 스폰까지 대기 시간(초)',
    expGrowthStartWave: '지수 난이도 증가가 시작되는 웨이브 번호',
    expGrowthInputScale: '지수 성장 입력 스케일(클수록 후반 기울기 증가)',
    expGrowthPower: '지수 성장 지수값(클수록 후반 급상승)',
    expEnemyStatWeight: '지수 성장치를 적 스탯 배율에 반영하는 가중치',
    expSpawnTotalWeight: '지수 성장치를 웨이브 총 스폰 수에 반영하는 가중치',
    expSpawnIntervalWeight: '지수 성장치를 스폰 간격 단축에 반영하는 가중치',
  };
  if (exact[key]) return exact[key];

  const m = key.match(/^buildEarlyBonusByWave\.(\d+)$/);
  if (m) return `${m[1]}웨이브 준비 시간 보정치(추가 초)`;

  return '웨이브 밸런스 값';
}

function describeSpecialMineral(key) {
  const map = {
    minDistanceFromCommand: '특수 미네랄이 커맨드 센터에서 떨어져야 하는 최소 거리',
    radiusMin: '특수 미네랄 최소 반지름',
    totalMultiplier: '특수 미네랄 총량 배율',
    totalBonus: '특수 미네랄 총량 추가 보너스',
    chunkMultiplier: '특수 미네랄 1회 채굴량 배율',
    chunkBonus: '특수 미네랄 1회 채굴량 추가 보너스',
    difficultyMultiplier: '특수 미네랄 채굴 난이도 배율',
    color: '특수 미네랄 기본 색상(16진수)',
    flashColor: '특수 미네랄 피격/채굴 시 점멸 색상',
    minimapColor: '특수 미네랄 미니맵 표시 색상',
    normalColor: '일반 미네랄 기본 색상',
    normalFlashColor: '일반 미네랄 점멸 색상',
    normalMinimapColor: '일반 미네랄 미니맵 색상',
  };
  return map[key] || '특수 미네랄 밸런스 값';
}

function describeKey(category, key) {
  if (category === 'economy') return describeEconomy(key);
  if (category === 'buildings') return describeBuildings(key);
  if (category === 'player') return describePlayer(key);
  if (category === 'miniScv') return describeMiniScv(key);
  if (category === 'barracks') return describeBarracks(key);
  if (category === 'upgrades') return describeUpgrades(key);
  if (category === 'cards') return describeCards(key);
  if (category === 'enemies') return describeEnemies(key);
  if (category === 'waves') return describeWaves(key);
  if (category === 'specialMineral') return describeSpecialMineral(key);
  return '밸런스 항목';
}

function sheetFromCategory(category, payload) {
  const rows = flattenObject(payload)
    .map(({ key, value }) => {
      const type = detectType(value);
      return [
        key,
        type,
        valueToCell(type, value),
        describeKey(category, key),
      ];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  return XLSX.utils.aoa_to_sheet([
    ['key', 'type', 'value', 'description'],
    ...rows,
  ]);
}

function makeGuideSheet(balance) {
  const rows = [
    ['카테고리', '설명', '수정 규칙'],
  ];

  const categories = CATEGORY_ORDER.filter((name) => name in balance);
  for (const category of categories) {
    rows.push([
      category,
      CATEGORY_DESC[category] || '밸런스 카테고리',
      'key는 변경 금지, value만 수정 권장. type(number/boolean/string/json) 유지',
    ]);
  }

  rows.push([]);
  rows.push(['컬럼 설명', '내용', '예시']);
  rows.push(['key', '코드에서 참조하는 항목 경로', 'defs.wall.cost']);
  rows.push(['type', '값의 자료형', 'number / boolean / string / json']);
  rows.push(['value', '실제 적용 값', '50']);
  rows.push(['description', '사람이 읽는 한글 설명', '성벽 건설 비용']);
  rows.push([]);
  rows.push(['주의', '내용', '']);
  rows.push(['1', 'json 타입은 JSON 문법을 지켜야 합니다.', '[0.4,0.56,0.7]']);
  rows.push(['2', '잘못된 타입/문법이면 빌드 시 오류가 납니다.', '']);
  rows.push(['3', '시트 이름은 카테고리명 그대로 유지하세요.', 'economy, waves ...']);

  return XLSX.utils.aoa_to_sheet(rows);
}

function main() {
  const balance = loadBalance();
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeGuideSheet(balance), '가이드');

  const categories = CATEGORY_ORDER.filter((name) => name in balance);
  for (const category of categories) {
    const ws = sheetFromCategory(category, balance[category]);
    XLSX.utils.book_append_sheet(wb, ws, category);
  }

  XLSX.writeFile(wb, OUT_PATH);
  console.log(`created: ${OUT_PATH}`);
}

main();
