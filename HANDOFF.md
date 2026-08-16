# 프로젝트 인수인계 메모 (신흥정밀 식사신청 시스템 / 통근버스)

이 문서는 채팅방 컨텍스트를 정리하고 다른 채팅방으로 이어서 작업하기 위해 작성된 요약입니다.
새 채팅방에서 이 파일을 업로드하거나 내용을 붙여넣고 이어서 작업을 요청하면 됩니다.

## 1. 프로젝트 개요

- **위치**: `/root/meal-app` (이 세션의 클라우드 작업공간 기준 경로. 새 채팅방에서는 동일한 프로젝트를
  다시 업로드하거나, 기존 세션 파일을 이어받아야 합니다.)
- **성격**: 신흥정밀 사내 "식사 신청 시스템"에 "통근버스 신청" 기능을 추가로 개발 중. 식사 신청 기능은
  기존에 완성되어 있었고, 이번 세션들에서는 거의 전적으로 **통근버스 서브시스템**만 반복적으로
  기능 추가/수정했습니다.
- **기술 스택**: Node.js + Express, MongoDB + Mongoose, 프론트엔드는 프레임워크 없는 순수 JS
  (번들러 없음). 3개 국어 i18n(ko/en/zh) 지원 (`public/js/i18n.js`의 `t(key, ...args)` 함수 사용,
  일부 키는 인자를 받는 함수 형태 `(arg) => \`...\`` 로 정의됨).
- **테스트 환경 제약**: 이 세션에는 실제 DB/npm 레지스트리 접근이 없습니다. 검증은 오직
  `node --check <file>` 문법 검사 + 코드 리뷰(서브에이전트 활용)로만 진행했고, 런타임/통합 테스트는
  한 번도 하지 못했습니다. **배포 후 실제 동작 확인이 꼭 필요합니다.**

## 2. 배포/전달 방식 (이 세션에서 매번 반복한 절차)

기능을 수정할 때마다 아래 순서를 따랐습니다. 새 채팅방에서도 이 패턴을 그대로 유지하면 됩니다.

1. 코드 수정
2. 전체 문법 검사:
   ```bash
   cd /root/meal-app && FAIL=0
   for f in $(find server public/js -name "*.js"); do
     node --check "$f" 2>&1 | grep -q . && { echo "FAIL: $f"; FAIL=1; }
   done
   [ $FAIL -eq 0 ] && echo "ALL_OK"
   ```
3. (규모가 크면) `general-purpose` 서브에이전트로 독립적인 코드 리뷰 1회 실행 → 발견된 버그 수정
   - 이 리포에는 `code-reviewer` 에이전트 타입이 없음 (시도해보면 에러). `general-purpose`,
     `Explore`, `Plan` 등만 사용 가능.
4. `CHANGELOG.md`에 "N차" 번호로 항목 추가 (한국어로, 사용자가 이해하기 쉽게 - 무엇이 왜 바뀌었는지)
5. zip 2개 재생성 후 전달:
   ```bash
   cd /root/meal-app
   rm -f /root/meal-app.zip "/root/신흥정밀_식사신청시스템_최종본.zip"
   zip -r /root/meal-app.zip . -x "node_modules/*" -x ".git/*" -x "*.zip"
   zip -r "/root/신흥정밀_식사신청시스템_최종본.zip" . \
     -x "node_modules/*" -x ".git/*" -x "*.zip" \
     -x "guide/build_update_guide.js" -x "guide/build_final_manual.js" -x "guide/build_restore_guide.js"
   ```
   - `meal-app.zip`: 개발용 전체 (guide 스크립트 포함)
   - `신흥정밀_식사신청시스템_최종본.zip`: 실제 배포/납품용 (guide 빌드 스크립트 3개 제외)
6. `SendUserFile`로 두 zip 모두 전달
7. 한국어로 변경 내용 설명 (사용자는 한국어 사용, 개조식/불필요한 격식 없이 자연스럽게)

## 3. 통근버스 서브시스템 — 현재(최종) 데이터 모델

여러 차례 설계가 바뀌었으므로, **가장 최신 상태(2026-08-15, CHANGELOG 20차 기준)** 만 명확히
적습니다. 과거 이력이 궁금하면 `CHANGELOG.md` 전체를 읽으면 됩니다(16차~20차가 통근버스 관련).

### 3.1 핵심 개념 3가지 (헷갈리기 쉬우니 항상 구분)

1. **차량 운행 여부** (`server/utils/busOperation.js`의 `resolveOperationMap`): 그 차량이 그날
   실제로 다니는지. **모든 날짜가 기본적으로 "운행함"**이며, 관리자가 `BusOperationDay`에 예외
   기록을 남긴 날짜/차량/운행구분만 운행하지 않는 것으로 처리됩니다(취소 전용, 평일/주말/공휴일
   구분 없음).
2. **기본 등록 자동 탑승일 여부** (`isDefaultOperatingDay`/`isDefaultOperatingDayBulk`): 평일(월~금)
   이고 공휴일이 아닌 날에만 true. 이 값은 **출근(commute)에만** 의미가 있습니다.
3. **자동 탑승 대상 운행구분** (`AUTO_DEFAULT_TRIP_TYPES = ["commute"]`, busOperation.js에 정의):
   출근만 "기본 등록"에 의해 자동으로 탑승자 명단에 포함됩니다. 정시퇴근(regularLeave)/연장퇴근
   (extendedLeave)은 등록은 하지만 자동 탑승되지 않습니다(아래 3.3 참고).

### 3.2 "내가 타는 차" 기본 등록 (`BusDefaultRide` 모델)

- 트립타입(commute/regularLeave/extendedLeave)당 **딱 1개만** 등록 가능 (요일별 등록 방식은
  18차에서 도입했다가 20차에서 폐지함). Unique index: `{employeeId, tripType}`.
- 한 번 등록하면 계속 고정되고, 화면에서 "수정" 버튼으로 언제든 변경 가능.
- 출근: 등록해두면 평일(공휴일 제외)마다 자동으로 탑승자 명단에 포함됨. 특정 날짜만 못 타면
  `BusRide`에 "취소" 예외 기록을 남김(등록 자체는 유지).
- 정시퇴근/연장퇴근: 등록은 "평소 타는 차"를 기억해두는 참고용일 뿐, 자동 탑승되지 않음. 아래
  3.3 참고.

### 3.3 정시퇴근 vs 연장퇴근 상호 배타 처리 (`MUTUALLY_EXCLUSIVE_TRIP_GROUPS`)

- 하루에 퇴근은 한 번뿐이므로, 정시퇴근/연장퇴근은 그날그날 **둘 중 하나만 명시적으로 신청**해야
  탑승자 명단에 포함됩니다(자동 탑승 없음).
- 프론트엔드(`bus.js`)에서 기본 차량이 등록되어 있으면 차량을 다시 고를 필요 없이 "신청" 버튼
  한 번으로 신청 가능 (`POST /bus/ride`에서 `vehicleId`를 생략하면 서버가 등록된 기본 차량을
  자동으로 사용).
- 정시퇴근을 신청한 상태에서 연장퇴근을 신청하면(또는 반대), 서버(`server/routes/bus.js`의
  `cancelMutuallyExclusiveSiblings` 함수)가 같은 날짜의 반대쪽 신청을 자동으로 취소 처리함.
  프론트엔드는 이 사실을 `siblingApplied` 필드로 안내 문구만 보여줌(막지는 않음).

### 3.4 순수 함수 `computeRiders` (`server/utils/busRiders.js`)

```
computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitRowsForDate)
```
- DB 호출 없는 순수 함수. 호출부에서 필요한 데이터를 미리 조회해서 넘겨줘야 함.
- `isDefaultDay && AUTO_DEFAULT_TRIP_TYPES.includes(tripType)` 일 때만 기본 등록을 자동
  탑승자로 포함. 그 외에는 `explicitRowsForDate` 중 `status: "applied"` 인 것만 포함.
- **호출부 6곳** 모두 이 시그니처(6개 인자, `dayOfWeek` 파라미터 없음)로 통일되어 있어야 함:
  `server/routes/bus.js` (GET /week), `server/routes/busAdmin.js` (dailyRiders,
  monthlyDailyTotals), `server/routes/busDriver.js` (GET /today, GET /week-operation, GET
  /summary/monthly), `server/routes/cron.js` (busDailyLogEmail 잡).

### 3.5 주요 파일 맵 (통근버스 관련만)

| 파일 | 역할 |
|---|---|
| `server/models/BusDefaultRide.js` | 기본 등록 (트립타입당 1개, unique `{employeeId, tripType}`) |
| `server/models/BusRide.js` | 특정 날짜의 명시적 신청/취소 기록 (`status: applied/cancelled`) |
| `server/models/BusOperationDay.js` | 관리자가 지정한 차량 운행 예외 (기본은 항상 운행함) |
| `server/models/BusDrivingLog.js` | 기사가 기록하는 실제 운행 일지 |
| `server/models/Vehicle.js` / `BusRoute.js` | 차량 3대(평택/공도/안성) 및 코스/정류장 |
| `server/utils/busOperation.js` | `TRIP_TYPES`, `AUTO_DEFAULT_TRIP_TYPES`, `MUTUALLY_EXCLUSIVE_TRIP_GROUPS`, `resolveOperationMap`, `isDefaultOperatingDay(Bulk)` |
| `server/utils/busRiders.js` | `computeRiders` 순수 함수 |
| `server/utils/dateUtil.js` | KST 날짜 유틸 (`weekdayOf`, `getWeekDates`, `getMonthDates` 등) |
| `server/routes/bus.js` | 직원용 API (`/bus/status`, `/routes`, `/default`, `/week`, `/ride`) |
| `server/routes/busAdmin.js` | 통근차량 관리 관리자용 API (차량/코스 관리, 운행일 지정, 신청 취소, 일일/월간 집계, 엑셀) |
| `server/routes/busDriver.js` | 기사용 API (`/today`, `/week-operation`, `/summary/monthly`, `/log`) |
| `server/routes/cron.js` | 전일 운행일지 이메일 발송 잡 (매일 08:00 KST) 등 통근버스 관련 크론 포함 |
| `public/js/bus.js` | 직원용 화면 (탭: 출근/정시퇴근/연장퇴근, 기본 등록 카드, 주간 신청 그리드) |
| `public/js/busAdminUi.js` | 통근차량 관리 관리자 화면 |
| `public/js/driverUi.js` | 기사 모드 화면 (당일운행/주간운행명령/월별집계 탭) |
| `public/js/i18n.js` | 다국어 텍스트 (ko/en/zh) — bus 관련 키는 `bus`/`driver`/`ba` 접두어 |
| `server/scripts/migrate-busDefaultRide-single.js` | 1회성 마이그레이션 스크립트 (아래 4번 참고) |

## 4. 미해결/후속 조치 필요 항목

1. **⚠️ 프로덕션 DB 마이그레이션 미실행**: 18차(요일별 등록)에서 20차(트립타입당 1개)로
   되돌리면서 스키마가 바뀜(`BusDefaultRide`의 unique index가
   `{employeeId, tripType, dayOfWeek}` → `{employeeId, tripType}`로 변경). 만약 실제
   배포 서버에 18차 버전이 이미 운영되어 직원들이 요일별로 여러 개 등록해둔 데이터가 있다면,
   배포 시 반드시 아래를 1회 실행해야 함:
   ```bash
   MONGODB_URI="mongodb://..." node server/scripts/migrate-busDefaultRide-single.js
   ```
   이미 트립타입당 1개씩만 등록되어 있었다면(요일별 등록을 실제로 활용한 사람이 없었다면) 실행하지
   않아도 무방. **이 세션은 실제 DB에 접근할 수 없어서 이 스크립트를 프로덕션에 대해 실행/검증해본
   적이 없음** — 새 채팅방에서 실행 결과를 확인하거나, 사용자에게 직접 실행을 안내해야 할 수 있음.
2. **실제 배포 후 동작 확인 전무**: 이 세션 내내 `node --check` 문법 검사와 코드 리뷰만 했고,
   실제로 서버를 띄우거나 화면에서 클릭해본 적이 없음. 배포 후 실제 신청/취소/자동전환 플로우를
   꼭 한 번 실사용 테스트해봐야 함.
3. `server/models/BusOperationDay.js`의 헤더 주석은 최신 규칙(모든 날짜 기본 운행함)에 맞게
   19차 이전에 이미 수정 완료 — 추가 조치 불필요(참고용으로만 남김).
4. 특별히 열려 있는 다른 버그/요청은 없음. 사용자가 마지막으로 요청한 3가지(요일별 등록 폐지,
   출근 고정+정시/연장퇴근 선택제, 하루 하나만 선택 가능)는 모두 구현·리뷰·전달 완료됨(20차).

## 5. 최근 변경 이력 요약 (CHANGELOG.md 16~20차 압축)

- **15차**: 통근버스 신청 기능 최초 도입 (평일 기본 운행, 특근일은 관리자가 지정, 비공개 개발자 모드)
- **16차**: "기본 차량 등록" 방식 도입 (트립타입당 1개, 평일 자동 탑승 + 예외 취소)
- **17차**: 출근/정시�퇴근/연장퇴근 탭 분리 (직원/관리자/기사 화면) + 차량운행 기본값을
  "항상 운행함, 예외만 취소"로 변경
- **18차**: 기본 등록을 요일별(월~금) 그리드 방식으로 확장 (트립타입 x 요일마다 다른 차량 등록 가능)
  — **20차에서 폐지됨**
- **19차**: 기사모드 [주간 운행명령] 화면에 탑승 인원수·탑승자(사번/부서/이름) 명단 추가
- **20차 (최신)**: 18차의 요일별 등록을 폐지하고 트립타입당 1개 고정 등록으로 복귀. 정시퇴근/
  연장퇴근은 자동 탑승 폐지 → 하루에 하나만 명시적으로 선택(신청), 반대쪽 신청 시 자동 취소.
  1회성 마이그레이션 스크립트 추가.

## 6. 사용자 정보 / 커뮤니케이션 스타일

- 사용자는 한국어로 짧고 직접적으로 요청함 (예: "출근은 한번 퇴근도 한번이야"). 애매한 부분은
  `AskUserQuestion`으로 짧은 객관식 질문을 던져 확인한 뒤 진행하는 방식이 잘 맞았음.
- 큰 설계 변경 요청이 반복적으로 들어옴 — 매번 이전 설계를 완전히 갈아엎는 경우가 많았으므로,
  새 요청이 들어오면 "이번엔 정말 이게 최종인지" 요약해서 확인하며 진행하는 게 안전함.
- 완료 후에는 항상 두 zip을 전달하고, 한국어로 무엇이 어떻게 바뀌었는지 간결하게 설명하는 패턴을
  선호함(과도한 formatting 없이 자연스러운 문장으로).

---
*이 문서는 2026-08-16 기준 세션 상태를 정리한 것입니다. 새 채팅방에서는 이 문서와 함께
`/root/meal-app` 프로젝트 전체(zip)를 첨부하면 바로 이어서 작업할 수 있습니다.*
