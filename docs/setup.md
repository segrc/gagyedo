# 설치·운영 메모

카드를 끌고 더블클릭해서 만드는 족보·가계도 편집기입니다. 서버 없이 동작하는 정적 웹앱이라
`site/` 폴더를 그대로 올리면 됩니다.

## 들어 있는 것

| 파일 | 역할 |
| --- | --- |
| `index.html` | 앱 전체 (화면·기능) |
| `fonts/` | Pretendard, Pretendard JP 글꼴과 라이선스(OFL) |
| `icons/`, `manifest.webmanifest` | 앱 설치용 아이콘과 정보 |
| `sw.js` | 오프라인에서도 열리게 하는 캐시 |
| `og.png` | 링크를 공유할 때 보이는 미리보기 이미지 |
| `_headers` | Cloudflare Pages용 캐시 설정 |

## Cloudflare Pages에 올리기 (Git 없이)

1. Cloudflare 계정을 만들고 대시보드에 로그인합니다.
2. **Workers & Pages → 만들기(Create) → Pages → 에셋 업로드(Upload assets)** 를 고릅니다. (화면 이름은 Cloudflare 업데이트에 따라 조금 다를 수 있습니다)
3. 프로젝트 이름을 정합니다. 이 이름이 주소가 됩니다 (예: `gagyedo` → `gagyedo.pages.dev`).
4. `site/` 폴더를 통째로 끌어다 놓고 **배포(Deploy)** 를 누릅니다.
5. 나온 주소로 들어가면 바로 쓸 수 있습니다. 원하면 **사용자 지정 도메인**을 연결하세요.

수정한 버전을 다시 올릴 때는 같은 프로젝트에서 **새 배포 만들기**로 폴더를 다시 올리고,
`sw.js` 맨 위의 `VERSION` 숫자를 하나 올려 주세요 (예: `gagyedo-v2`). 그래야 이미 설치한 사람도 새 버전을 받습니다.

GitHub Pages, Netlify 같은 다른 정적 호스팅에도 그대로 올릴 수 있습니다 (`_headers`는 Netlify도 읽습니다).

## 데이터는 어디에 저장되나요

- 가계도는 기본적으로 **쓰는 사람의 기기, 그 브라우저 안(IndexedDB)** 에만 저장됩니다.
- ⋯ → **다른 기기와 동기화**를 켜면 동기화 코드 하나로 서버(Cloudflare D1)에 올라가고, 같은 코드를 넣은 다른 기기에서도 보입니다 (아래 ‘동기화 서버 만들기’).
- 동기화를 쓰지 않을 때는 ⋯ 메뉴의 **모든 판 백업**으로 받은 파일을 다른 곳에서 **백업 파일 불러오기** 하면 옮겨집니다.
- 브라우저의 사이트 데이터를 지우면 가계도도 지워집니다. 백업을 권장하는 안내가 2주에 한 번쯤 뜹니다.
- 처음 여는 사람에게는 ‘예시 가계도 · 전주 최씨’ 판(최명길 가계, 한국민족문화대백과 기준)이 하나 들어 있습니다.

## 서버 두 개 만들기 (공유 링크 · 동기화)

둘 다 무료 한도 안에서 돌아갑니다. Worker 이름을 아래와 똑같이 지어야 편집기가 찾아갑니다.

**① 짧은 공유 링크 — `workers/share.js`**
1. **Storage & Databases → KV** → `gagyedo-shares` 만들기
2. **Workers & Pages → Create → Worker** → 이름 `gagyedo-share` → Edit code에 붙여넣고 Deploy
3. Settings → Bindings → KV namespace: 변수 이름 `SHARES` → `gagyedo-shares`
4. 확인: `https://gagyedo-share.j-segrc.workers.dev/` 를 열면 ‘가계도 편집기 공유 서버’

**② 다른 기기와 동기화 — `workers/sync.js`**
1. **Storage & Databases → D1 SQL Database → Create** → 이름 `gagyedo-sync`
2. **Workers & Pages → Create → Worker** → 이름 `gagyedo-sync` → Edit code에 붙여넣고 Deploy
3. Settings → Bindings → D1 database: 변수 이름 `DB` → `gagyedo-sync`
4. 확인: `https://gagyedo-sync.j-segrc.workers.dev/ABCD-ABCD-ABCD-ABCD` 를 열면 `{"error":"not found"}` (‘DB 바인딩이 없습니다’가 나오면 3번을 다시)
5. 표(accounts · boards · history)는 처음 동기화할 때 저절로 만들어집니다.

### 관리자로서 코드 찾아 주기 · 되돌리기

D1 → `gagyedo-sync` → **Console**에서 SQL로 봅니다.

```sql
-- 코드를 만들 때 적은 ‘찾기용 이름·연락처’로 코드 찾기
SELECT code, hint, datetime(created/1000,'unixepoch','+9 hours') AS 만든날, datetime(seen/1000,'unixepoch','+9 hours') AS 마지막접속
FROM accounts WHERE hint LIKE '%홍길동%';

-- 그 코드의 판 목록
SELECT id, title, rev, datetime(updated/1000,'unixepoch','+9 hours') AS 고친날, deleted FROM boards WHERE code='XXXX-XXXX-XXXX-XXXX';

-- 실수로 지우거나 덮어쓴 판을 이전 버전으로 되돌리기 (판마다 최근 20개 보관)
SELECT rev, title, datetime(saved/1000,'unixepoch','+9 hours') FROM history WHERE code='XXXX-XXXX-XXXX-XXXX' AND id='판id' ORDER BY rev DESC;
UPDATE boards SET data=(SELECT data FROM history WHERE code='XXXX-XXXX-XXXX-XXXX' AND id='판id' AND rev=되돌릴rev),
  deleted=0, rev=rev+1, updated=strftime('%s','now')*1000 WHERE code='XXXX-XXXX-XXXX-XXXX' AND id='판id';
```

- 찾기용 이름을 적지 않고 코드를 잃어버리면 관리자도 누구의 것인지 알 수 없습니다 (마지막 접속 시각·판 제목으로 짐작하는 정도).
- 서버에 올라간 가계도는 관리자(D1 소유자)가 볼 수 있습니다. 코드를 아는 사람은 누구나 그 판들을 받을 수 있습니다.

## 앱처럼 설치하기

크롬·엣지에서 주소창 오른쪽의 **앱 설치** 아이콘(또는 메뉴 → 앱 → 설치)을 누르면 바탕화면 아이콘으로 실행됩니다.
아이폰·아이패드는 사파리 **공유 → 홈 화면에 추가**. 설치 후에는 인터넷이 끊겨도 열립니다.

## 내 컴퓨터에서 미리 보기

`index.html`을 더블클릭해도 열리지만 앱 설치·오프라인 기능은 웹 주소(https)에서만 동작합니다.
파이썬이 있다면 `site/` 폴더에서 `python -m http.server 8000` 을 실행하고 `http://localhost:8000` 으로 열어 보세요.

## 링크 미리보기 이미지

`og.png`가 트위터·카카오톡 등에서 링크 미리보기로 쓰입니다. 일부 서비스는 전체 주소가 필요하니,
배포 후 `index.html`의 `<meta property="og:image" content="og.png">` 를
`https://내주소/og.png` 로 바꾸면 더 확실합니다.

## 방문 통계 보기 (Cloudflare Web Analytics)

`index.html` 맨 아래에 Web Analytics 코드(토큰 388481d1…)가 이미 들어 있습니다. 다시 올리기만 하면 대시보드 → **Web Analytics** 에서 통계가 보입니다.

(참고) Pages 프로젝트로 올렸다면 아래처럼 대시보드에서 켜는 방법도 있지만, 이 경우 코드가 두 번 들어가지 않게 `index.html`의 코드를 지우세요.

1. Cloudflare 대시보드 → **Workers & Pages** → 이 프로젝트를 고릅니다.
2. **Metrics** 탭에서 Web Analytics의 **사용(Enable)** 을 누릅니다.
3. 폴더를 **한 번 다시 배포**합니다. 통계 코드는 다음 배포부터 자동으로 들어갑니다.
4. 대시보드 → **Web Analytics** 에서 방문자 수, 많이 본 페이지, 유입 경로, 나라·기기, 로딩 속도를 봅니다.

- 무료이고, 가계도 내용은 통계에 들어가지 않습니다 (페이지 방문 정보만 집계).
- 앱 안에서 누른 버튼(이미지 저장 등) 같은 세부 동작은 Web Analytics가 집계하지 않습니다.
- Cloudflare Pages가 아닌 곳에 올렸다면 `index.html` 맨 아래 주석의 안내대로 코드 한 줄을 넣으면 됩니다.

## 구글 검색에 올리기

1. https://search.google.com/search-console 에서 **속성 추가 → URL 접두어** → `https://gagyedo.j-segrc.workers.dev/` 입력
2. 소유 확인 방법으로 **HTML 파일**을 고르고 `google…….html` 파일을 받아 `site/` 폴더 맨 위에 넣고 다시 배포 → **확인**
3. 왼쪽 **Sitemaps**에서 `sitemap.xml` 제출
4. **URL 검사**에 `https://gagyedo.j-segrc.workers.dev/` 와 `/about.html` 을 넣고 **색인 생성 요청**

- `about.html`은 검색용 소개 페이지입니다. 기능이 늘면 이 페이지 글도 고쳐 주세요.
- 주소가 바뀌면 `robots.txt`, `sitemap.xml`, `index.html`·`about.html`의 canonical·og 주소를 함께 바꾸세요.
