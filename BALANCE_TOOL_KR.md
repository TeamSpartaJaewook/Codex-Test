# 밸런스 관리 (Google Sheets URL 기반)

엑셀/CSV 없이 Google Sheets에서 직접 관리하고, URL로 가져와 자동 빌드합니다.

## 0) Google Sheets 준비
- 시트 문서 공유: **링크가 있는 모든 사용자 - 뷰어**
- 권장: **파일 > 공유 > 웹에 게시**도 켜기
- 시트 탭 이름은 카테고리명으로 사용됨
  - 예: `economy`, `buildings`, `player`, `miniScv`, `barracks`, `upgrades`, `cards`, `enemies`, `waves`, `specialMineral`

## 1) 각 시트 포맷
각 시트 첫 헤더(어느 행이든 가능):
- `key,type,value,description`
- 또는 한글: `키,타입,값,설명`

값 예시:
- `spawnTotalPerWave,number,5.4,`
- `easeByWave,json,"[0.4,0.56,0.7,0.8]",`
- `defs.wall.cost,number,50,`

## 2) URL 등록
```bash
npm run balance:set-url -- "https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit"
```

옵션:
- 특정 시트만 사용:
```bash
npm run balance:set-url -- "<URL>" --sheets economy,buildings,waves,enemies
```

## 3) 수동 빌드
```bash
npm run balance:build
```
- Google Sheets -> `/Users/jw.ryu/Desktop/codex-game/balance.config.js` 생성

## 4) 자동 빌드(변경 감시)
```bash
npm run balance:watch
```
- 기본 8초 간격으로 시트 변경 감지 후 자동 재빌드
- 간격 변경:
```bash
npm run balance:watch -- --interval 5
```

## 5) 개발/배포 시 자동 반영
- `npm run dev`, `npm start` 전에 `predev/prestart`에서 자동으로 `balance:build` 실행
- 즉, 시트 수정 후 서버 재시작하면 최신 밸런스 반영

## 조회 명령
```bash
npm run balance:list
npm run balance:list -- waves.
npm run balance:get -- waves.spawnTotalPerWave
```
