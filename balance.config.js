(() => {
  window.GAME_BALANCE = {
    "economy": {
      "enemyKillReward": 2,
      "manualWorkerCost": 15,
      "playerDeathPenalty": 60,
      "repairMineralPerHp": 0.28,
      "startResources": 320
    },
    "buildings": {
      "basePopulation": 10,
      "defs": {
        "barracks": {
          "color": "#66b8ff",
          "cost": 130,
          "h": 1,
          "hp": 760,
          "w": 1
        },
        "command": {
          "color": "#53f18a",
          "cost": 360,
          "h": 2,
          "hp": 3200,
          "w": 2
        },
        "supply": {
          "color": "#88ffde",
          "cost": 115,
          "h": 1,
          "hp": 540,
          "w": 1
        },
        "turret": {
          "color": "#ffc85b",
          "cost": 120,
          "h": 1,
          "hp": 620,
          "w": 1
        },
        "upgrade": {
          "color": "#d487ff",
          "cost": 170,
          "h": 1,
          "hp": 520,
          "w": 1
        },
        "wall": {
          "color": "#9daab6",
          "cost": 50,
          "h": 1,
          "hp": 1500,
          "w": 1
        }
      },
      "hpLevelScalePerLevel": 0.52,
      "supplyPopBonus": 5,
      "turretUpgradeCostBase": 1.35,
      "turretUpgradeCostPerLevel": 0.75
    },
    "player": {
      "baseDamage": 14,
      "baseDefense": 1,
      "baseMaxHp": 240,
      "baseSpeed": 185,
      "mineRate": 0.75
    },
    "miniScv": {
      "baseDamage": 4,
      "baseMaxHp": 70,
      "baseSpeed": 90,
      "carryChunkMul": 0.8,
      "mineRate": 1.05
    },
    "barracks": {
      "levels": [
        {
          "interval": 30,
          "maxUnits": 4,
          "statMul": 1
        },
        {
          "interval": 22,
          "maxUnits": 6,
          "statMul": 1.28
        },
        {
          "interval": 16,
          "maxUnits": 8,
          "statMul": 1.62
        }
      ],
      "soldier": {
        "baseDamage": 11,
        "baseMaxHp": 80,
        "baseRange": 140,
        "baseSpeed": 92,
        "damagePerLevel": 4,
        "hpPerLevel": 30,
        "rangePerLevel": 20,
        "shootCooldown": 0.62,
        "speedPerLevel": 5,
        "speedStatMulFactor": 2
      },
      "upgradeCostBase": 170,
      "upgradeCostPerLevel": 180
    },
    "upgrades": {
      "attack": {
        "baseCost": 130,
        "gainPerLevel": 0.12
      },
      "costScale": 1.5,
      "defense": {
        "baseCost": 120,
        "gainPerLevel": 1
      },
      "hp": {
        "baseCost": 140,
        "gainPerLevel": 0.15
      },
      "speed": {
        "baseCost": 110,
        "gainPerLevel": 0.1
      }
    },
    "cards": {
      "barracksRate": 0.18,
      "baseRepairRatio": 0.3,
      "mineralRain": 220,
      "scvMineSpeed": 0.2,
      "supplyBonus": 4,
      "towerRange": 0.1,
      "turretDamage": 0.2,
      "wallHp": 0.3
    },
    "enemies": {
      "composition": {
        "chargerChanceBase": 0.26,
        "chargerChanceCap": 0.4,
        "chargerChanceGrowthPerWave": 0.02,
        "chargerStartWave": 8,
        "rangedChanceBase": 0.62,
        "rangedChanceCap": 0.76,
        "rangedChanceGrowthPerWave": 0.02,
        "rangedStartWave": 4
      },
      "deathExplosionChance": 0.28,
      "scale": {
        "easeBase": 0.58,
        "easeWeight": 0.42,
        "perWave": 0.2
      },
      "types": {
        "boss": {
          "attackRange": 28,
          "damage": 42,
          "hp": 1350,
          "shootRange": 250,
          "speed": 56
        },
        "charger": {
          "attackRange": 18,
          "damage": 27,
          "hp": 118,
          "shootRange": 0,
          "speed": 84
        },
        "grunt": {
          "attackRange": 18,
          "damage": 20,
          "hp": 92,
          "shootRange": 0,
          "speed": 64
        },
        "ranged": {
          "attackRange": 28,
          "damage": 18,
          "hp": 74,
          "shootRange": 195,
          "speed": 60
        }
      }
    },
    "waves": {
      "buildDurationBase": 18,
      "buildDurationMin": 8,
      "buildDurationPerWave": 0.18,
      "buildEarlyBonusByWave": {
        "2": 4,
        "3": 2,
        "4": 1
      },
      "combatDurationBase": 56,
      "combatDurationBonusCap": 40,
      "combatDurationPerWave": 1.8,
      "easeByWave": [
        0.4,
        0.56,
        0.7,
        0.8,
        0.88,
        0.94,
        0.97,
        0.99
      ],
      "firstWaveBuildDuration": 40,
      "firstWaveBurst": 1,
      "spawnBurstBase": 2,
      "spawnBurstEaseBase": 0.55,
      "spawnBurstEaseWeight": 0.45,
      "spawnBurstMax": 6,
      "spawnBurstStepWave": 5,
      "spawnInitialCooldown": 0.18,
      "spawnIntervalBase": 0.72,
      "spawnIntervalEasePenalty": 1.15,
      "spawnIntervalFloor": 0.15,
      "spawnIntervalMin": 0.13,
      "spawnIntervalPerWave": 0.012,
      "spawnTotalBase": 16,
      "spawnTotalMin": 8,
      "spawnTotalPerWave": 5.4
    },
    "specialMineral": {
      "chunkBonus": 18,
      "chunkMultiplier": 1.9,
      "color": "#7bf4ff",
      "difficultyMultiplier": 1.3,
      "flashColor": "#f3feff",
      "minDistanceFromCommand": 560,
      "minimapColor": "#6fe9ff",
      "normalColor": "#ffd76a",
      "normalFlashColor": "#fff8cc",
      "normalMinimapColor": "#f7dc6d",
      "radiusMin": 16,
      "totalBonus": 380,
      "totalMultiplier": 2.6
    }
  };
})();
