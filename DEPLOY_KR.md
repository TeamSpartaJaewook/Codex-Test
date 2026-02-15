# Mineral Survivor 배포 가이드 (호스팅 서비스용)

## 1) 현재 구조
- 프론트엔드 + API 서버가 `server.js` 하나로 동작합니다.
- 랭킹/아이디 데이터는 서버 파일(`DATA_DIR/leaderboard.json`)에 저장됩니다.

## 2) 필수 환경변수
- `PORT`: 호스팅 서비스가 자동 주입하는 포트(보통 자동)
- `HOST`: `0.0.0.0` 권장
- `DATA_DIR`: 랭킹 파일 저장 경로
- `ALLOWED_ORIGINS`: CORS 허용 도메인(쉼표 구분)

예시:
```bash
HOST=0.0.0.0
DATA_DIR=/var/data
ALLOWED_ORIGINS=https://game.example.com
```

## 3) 호스팅 서비스에 올리기 (공통)
1. 이 프로젝트를 Git 저장소로 올립니다.
2. 호스팅 서비스에서 Node Web Service 생성
3. Runtime: Node 20+ 선택
4. Start Command: `npm start`
5. Environment 변수 설정 (`HOST`, `DATA_DIR`, 필요시 `ALLOWED_ORIGINS`)
6. 배포 후 `/api/health` 응답 확인

## 4) 데이터 영속성(중요)
- 이 프로젝트 랭킹은 파일에 저장됩니다.
- 호스팅 인스턴스가 재시작되면 파일이 초기화되는 서비스가 많습니다.
- 반드시 **Persistent Disk/Volume**을 붙이고 `DATA_DIR`를 그 경로로 설정하세요.

## 5) 도메인 연결 절차
1. 도메인 구매 (가비아/Cloudflare/Namecheap 등)
2. 호스팅 서비스에서 Custom Domain 추가
3. 호스팅 서비스가 안내한 DNS 레코드 등록
   - 루트 도메인: 보통 `A` 레코드
   - 서브도메인(`www`): 보통 `CNAME`
4. DNS 전파 후 SSL(HTTPS) 발급 완료 확인

## 6) 프론트/백 분리 배포 시
- `index.html`의 아래 값을 API 서버 도메인으로 설정:
```html
<meta name="api-base" content="https://api.example.com" />
```
- 그리고 API 서버의 `ALLOWED_ORIGINS`에 프론트 도메인을 넣으세요:
```bash
ALLOWED_ORIGINS=https://game.example.com
```

## 7) 현재 아이디 정책
- `POST /api/register`로 최초 등록된 아이디만 사용됩니다.
- 이미 존재하는 아이디는 시작 불가(`ID_EXISTS`)입니다.

