const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  Numbering, LevelFormat, convertInchesToTwip,
} = require("docx");

const PAGE_WIDTH = 12240; // US Letter, DXA
const PAGE_HEIGHT = 15840;

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 120 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, bold: !!opts.bold, color: opts.color, size: opts.size })],
    spacing: { after: 140 },
  });
}
function pRuns(runs, opts = {}) {
  return new Paragraph({ children: runs, spacing: { after: 140 } });
}
function step(n, title, body) {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: `STEP ${n}. `, bold: true, color: "2563EB" }),
        new TextRun({ text: title, bold: true }),
      ],
      spacing: { before: 200, after: 80 },
    }),
    ...(Array.isArray(body) ? body : [p(body)]),
  ];
}
function bullets(items, opts = {}) {
  return items.map(
    (item) =>
      new Paragraph({
        text: item,
        numbering: { reference: opts.numbered ? "numbered-list" : "bullet-list", level: 0 },
        spacing: { after: 60 },
      })
  );
}
function note(text) {
  return new Paragraph({
    children: [new TextRun({ text: `※ ${text}`, italics: true, color: "6B7280" })],
    spacing: { after: 140 },
    indent: { left: 200 },
  });
}
function codeBlock(lines) {
  return new Paragraph({
    children: (Array.isArray(lines) ? lines : [lines]).flatMap((line, i, arr) => {
      const run = new TextRun({ text: line, font: "Consolas", size: 20 });
      return i < arr.length - 1 ? [run, new TextRun({ break: 1 })] : [run];
    }),
    shading: { type: ShadingType.CLEAR, fill: "F0F2F6" },
    border: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "E2E5EB" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "E2E5EB" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "E2E5EB" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "E2E5EB" },
    },
    spacing: { before: 80, after: 160 },
    indent: { left: 100, right: 100 },
  });
}

function envRow(nameText, valueText, header) {
  const cellOpts = { verticalAlign: "center", margins: { top: 60, bottom: 60, left: 100, right: 100 } };
  const mk = (text, width, bold) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, fill: "EEF1F6" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: bold || header, font: bold ? "Consolas" : undefined })] })],
      ...cellOpts,
    });
  return new TableRow({
    children: [mk(nameText, 3200, true), mk(valueText, 6400, false)],
  });
}

function envTable(rows) {
  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [3200, 6400],
    rows,
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }],
      },
      {
        reference: "numbered-list",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: "식사 신청 시스템", bold: true, size: 44, color: "1D4ED8" })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "업데이트(기능 추가) 배포 가이드", bold: true, size: 32 })],
          spacing: { after: 200 },
        }),
        p(
          "이미 운영 중인 사이트(https://meal-app-y7j2.onrender.com)에 새로 추가된 기능을 반영하는 방법을 " +
            "처음 설치할 때와 똑같이 클릭 하나하나까지 순서대로 안내합니다. 컴퓨터를 잘 몰라도 그대로 따라 하시면 됩니다."
        ),
        note("업데이트를 진행해도 지금까지 저장된 직원 명단과 신청 내역은 전혀 사라지지 않습니다. 안심하고 진행하세요."),

        h1("전체 순서 한눈에 보기"),
        ...bullets(
          [
            "① 새 파일을 GitHub 저장소에 올리기 (필수)",
            "② 휴대폰 알림 기능을 쓰고 싶다면 Render에 환경변수 4개 추가 (선택)",
            "③ 휴대폰 알림 기능을 쓰고 싶다면 무료 알림 서비스(cron-job.org) 설정 (선택)",
            "④ Render 자동 재배포 확인",
            "⑤ 새로 추가된 기능 둘러보기",
          ],
          { numbered: false }
        ),
        note("②, ③번은 건너뛰어도 나머지 모든 기능(신청/취소, 미신청자 확인, 식단표, 공지사항, 직원 검색, 데이터 백업, 마감시간 변경, 앱 설치 등)은 정상적으로 동작합니다. 휴대폰 알림 기능만 별도 선택 사항입니다."),

        h1("① 새 파일을 GitHub 저장소에 올리기"),
        ...step(1, "업데이트된 파일 내려받기", [
          p("제가 보내드린 meal-app.zip 파일을 컴퓨터의 '다운로드' 폴더에 저장한 뒤, 압축을 풀어주세요."),
          p("Windows: 파일을 마우스 오른쪽 버튼으로 클릭 → '압축 풀기' 선택"),
          p("Mac: 파일을 더블 클릭하면 자동으로 압축이 풀립니다."),
          note("압축을 풀면 meal-app 이라는 이름의 폴더가 생기고, 그 안에 public, server 같은 폴더와 여러 파일이 들어 있습니다."),
        ]),
        ...step(2, "GitHub 저장소 열기", [
          p("웹 브라우저에서 GitHub에 로그인한 뒤, 처음 설치할 때 만들었던 저장소(meal-app-)로 들어갑니다."),
          note("주소창에 github.com 입력 → 로그인 → 오른쪽 위 내 프로필 클릭 → Your repositories → meal-app- 클릭"),
        ]),
        ...step(3, "파일 업로드 화면 열기", [
          p("저장소 페이지에서 초록색 'Code' 버튼 근처, 파일 목록 위쪽에 있는 'Add file' 버튼을 클릭한 뒤 'Upload files'를 선택합니다."),
        ]),
        ...step(4, "압축 푼 폴더의 내용을 통째로 끌어다 놓기", [
          p("1단계에서 압축을 푼 meal-app 폴더를 열고, 그 안에 있는 모든 파일과 폴더를 전체 선택합니다."),
          p("Windows: 폴더 안에서 Ctrl + A → Mac: 폴더 안에서 Cmd + A"),
          p("전체 선택한 상태에서 그대로 마우스로 끌어(드래그) GitHub 업로드 화면의 점선 박스 안에 놓습니다."),
          note("meal-app 폴더 자체가 아니라, 그 폴더 '안에 있는' public, server, package.json 같은 항목들을 선택해서 옮겨야 합니다."),
          note("이름이 같은 파일은 자동으로 새 내용으로 덮어써지고, 새로 생긴 파일(server/routes/push.js 등)은 자동으로 추가됩니다. 직접 하나씩 지우거나 고를 필요가 없습니다."),
        ]),
        ...step(5, "커밋(저장) 하기", [
          p("파일이 모두 올라올 때까지 잠시 기다립니다 (인터넷 속도에 따라 1~3분)."),
          p("화면 아래로 내려가면 'Commit changes' 영역이 있습니다. 메시지 칸에 '기능 업데이트'라고 입력합니다."),
          p("초록색 'Commit changes' 버튼을 클릭합니다."),
        ]),

        h1("② (선택) 휴대폰 알림 기능 켜기 위한 환경변수 추가"),
        p("마감 임박 알림과 관리자 일일 집계 알림을 휴대폰으로 받으려면, Render에 아래 4개 값을 추가로 입력해야 합니다. 필요 없으시면 이 단계는 건너뛰고 바로 ④번으로 이동하셔도 됩니다."),
        ...step(1, "Render Environment 화면 열기", [
          p("render.com에 로그인 → 내 서비스(meal-app-) 클릭 → 왼쪽 메뉴에서 'Environment' 클릭"),
        ]),
        ...step(2, "아래 4개 값을 'Add Environment Variable' 버튼으로 하나씩 추가", [
          envTable([
            envRow("Key (키)", "Value (값)", true),
            envRow("VAPID_PUBLIC_KEY", "BFi481FUogzNJ6jyMsruShX5OwujXSxwVp5_SZTRruyewgwD9baJNjTy1PFpKKKtLkBLDB6wDK2jaYPxeOK4vGQ"),
            envRow("VAPID_PRIVATE_KEY", "vtexqAiEalYvyarRUNbqo2qhKFL9Qbas-r71mS52H_E"),
            envRow("VAPID_SUBJECT", "mailto:polarisbin04@naver.com"),
            envRow("CRON_SECRET", "meal2026secret (원하시는 다른 영문/숫자 조합으로 바꾸셔도 됩니다)"),
          ]),
          note("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 값은 이 시스템 전용으로 미리 만들어둔 값이니, 위에 적힌 그대로 정확하게(띄어쓰기 없이) 입력해주세요."),
          note("CRON_SECRET은 다음 단계(③)에서 다시 사용되니 잊지 않도록 메모해두세요."),
        ]),
        ...step(3, "저장하기", [
          p("오른쪽 위 'Save Changes' 버튼을 클릭합니다. 저장하면 사이트가 자동으로 다시 시작됩니다 (1~2분 소요, 정상입니다)."),
        ]),

        h1("③ (선택) 무료 알림 서비스(cron-job.org)로 알림 예약 걸기"),
        p("Render 무료 요금제는 정해진 시간에 자동으로 실행되는 '알람 기능'이 없기 때문에, 무료 외부 서비스가 대신 정해진 시간마다 우리 사이트에 신호를 보내주도록 설정합니다."),
        ...step(1, "cron-job.org 가입", [
          p("웹 브라우저에서 cron-job.org 로 접속 → 오른쪽 위 'Sign up' 클릭 → 이메일로 무료 회원가입"),
        ]),
        ...step(2, "새 작업(cronjob) 만들기", [
          p("로그인 후 'Create cronjob' 버튼 클릭"),
          p("Title(제목): 식사신청 알림 이라고 입력"),
          pRuns([
            new TextRun({ text: "Address(주소, URL): " }),
            new TextRun({ text: "https://meal-app-y7j2.onrender.com/api/cron/tick?secret=meal2026secret", font: "Consolas", size: 20 }),
          ]),
          note("주소 맨 뒤 secret= 다음 부분은 ②단계에서 CRON_SECRET에 입력한 값과 반드시 똑같아야 합니다. ②단계를 건너뛰고 CRON_SECRET을 설정하지 않았다면 ?secret=meal2026secret 부분은 빼고 주소만 입력해도 됩니다."),
          p("Execution schedule(실행 주기): 'Every 10 minutes' 또는 'Every 15 minutes'로 선택"),
          p("모두 입력했으면 아래 'Create' 또는 'Save' 버튼을 클릭합니다."),
        ]),
        note("이 서비스는 사이트가 잠들지 않도록 깨워주는 효과도 함께 있어서, 직원들이 접속할 때 로딩이 오래 걸리는 문제도 줄어듭니다."),

        h1("④ Render 자동 재배포 확인"),
        ...step(1, "재배포 진행 상황 보기", [
          p("render.com → 내 서비스(meal-app-) → 왼쪽 메뉴 'Events' 클릭"),
          p("가장 위에 새 배포가 진행 중인 것이 보이면 정상입니다. 보통 2~5분 정도 걸립니다."),
        ]),
        ...step(2, "완료 확인", [
          p("화면에 초록색으로 'meal-app- is live!' 라는 문구가 뜨면 성공적으로 반영된 것입니다."),
          note("혹시 2단계(환경변수 추가)만 하고 1단계(파일 업로드)는 아직이라면, 재배포가 시작되지 않을 수 있습니다. 그럴 때는 화면 오른쪽 위 'Manual Deploy' 버튼 → 'Deploy latest commit'을 눌러주세요."),
        ]),

        h1("⑤ 새로 추가된 기능 둘러보기"),
        h2("관리자 화면"),
        ...bullets([
          "신청 현황 탭: 화면 아래쪽에 '미신청 직원' 목록이 추가되어, 아직 신청하지 않은 직원을 한눈에 볼 수 있습니다.",
          "미신청 직원 목록의 각 행(인원수 칸 오른쪽)에 '신청' 버튼이 추가되어, 위쪽 사번 입력칸에 직접 입력하지 않고도 목록에서 바로 대신 신청 처리를 할 수 있습니다. 도급 직원은 버튼을 누르면 신청 인원수를 입력하는 창(총원 기준 기본값)이 뜨고, 개인 직원은 바로 1명으로 신청됩니다.",
          "직원 관리 탭: 검색창에 이름/사번/부서를 입력하면 바로 필터링됩니다. 목록은 부서별 가나다순으로 정렬되어 있습니다.",
          "직원 관리 탭(신규): '엑셀 다운로드' 버튼으로 현재 선택된 필터(전체/재직자/퇴직자) 기준 직원 명단을 엑셀 파일로 내려받을 수 있고, '인쇄' 버튼으로 화면에 보이는 목록을 바로 인쇄할 수 있습니다.",
          "식단표 관리 탭(신규): '이번 주'/'다음 주' 버튼으로 주를 선택한 뒤, 식단표 이미지를 업로드하거나 메모를 입력하고 저장할 수 있습니다.",
          "설정 탭(신규): 당일 신청 마감 시(시/분)를 원하는 값으로 바꾸고 저장하면 즉시 적용됩니다(재배포 불필요). 공지사항을 새로 올리거나 종료할 수 있고, '데이터 백업 다운로드' 버튼으로 전체 데이터를 내 컴퓨터에 파일로 저장할 수 있습니다.",
        ]),
        h2("부서 운영자(제한된 관리자) 권한 (신규)"),
        ...bullets([
          "직원 관리 탭에서 특정 직원을 수정할 때 '권한'을 '운영자'로 바꾸면, 바로 아래 '담당 부서' 체크박스 목록이 나타납니다. 그 직원의 소속 부서는 자동으로 포함되고, 여기서 추가로 관리하게 하고 싶은 부서를 체크박스로 원하는 만큼(2개, 3개 이상도 자유롭게) 선택한 뒤 저장하면 됩니다.",
          "목록에 아직 없는 새 부서명은 옆의 입력칸에 이름을 입력하고 '추가' 버튼을 누르면 체크된 상태로 새 항목이 만들어집니다.",
          "운영자로 지정된 직원이 로그인하면 '내 식사 신청' 화면과 함께 '부서 운영자' 탭이 새로 나타납니다. 이 탭에서는 담당 부서에 한해 신청 현황 확인과 신청/취소 대신 처리, 일일·월간 집계 확인 및 엑셀 다운로드·인쇄를 할 수 있습니다.",
          "운영자는 담당 부서 소속 직원의 이름/구분(개인·도급)/총원(TO)/재직 여부는 수정할 수 있지만, 새 직원을 등록하거나 삭제(퇴직 처리)할 수는 없습니다. 부서 이동이나 관리자·운영자 권한 부여도 할 수 없고, 이 작업들은 전체 관리자만 할 수 있습니다.",
          "담당 부서는 관리자가 직원 관리 화면에서 언제든 새로 추가하거나 변경할 수 있고, 운영자가 다시 로그인하지 않아도 바로 반영됩니다.",
          "신청 현황 탭의 '미신청 직원' 목록에 '신청' 버튼이 추가되어, 사번을 직접 입력하지 않고도 목록에서 바로 대신 신청 처리를 할 수 있습니다. 도급 직원은 버튼을 누르면 신청 인원수를 입력하는 창(총원 기준 기본값)이 뜨고, 개인 직원은 바로 1명으로 신청됩니다. 이미 신청된 건을 취소할 때는 기존과 동일하게 '신청 현황' 표의 '취소' 버튼을 사용합니다.",
        ]),
        h2("직원 관리 탭 — 인원 현황 / 정렬 / 재직·퇴직 구분 (신규)"),
        ...bullets([
          "화면 맨 위에 개인 인원 / 도급사 총원(TO) / 합계가 요약 카드로 표시됩니다.",
          "검색창 옆 '정렬' 드롭다운에서 부서별 / 가나다순 / 사번별 / 재직자별 정렬을 즉시 바꿀 수 있습니다.",
          "그 아래 '전체 / 재직자 / 퇴직자' 탭을 눌러 재직 중인 직원과 퇴직한 직원을 구분해서 볼 수 있습니다 (기본은 재직자만 표시).",
          "퇴직자 목록에서는 '복직' 버튼으로 다시 재직 상태로 되돌리거나, '완전 삭제' 버튼으로 기록까지 영구적으로 지울 수 있습니다.",
          "완전 삭제는 되돌릴 수 없으니, 실수로 퇴직 처리한 직원이 아니라 정말 기록을 지워도 되는 경우에만 사용해주세요.",
          "정렬 드롭다운에 '권한별'이 추가되어, 관리자 → 일반직원 순으로 묶어서 볼 수 있습니다.",
        ]),
        h2("도급(단체) 계정 총원(TO) 수정 요청 (신규)"),
        ...bullets([
          "도급팀 계정이 총원 수정을 요청하면, 관리자 '직원 관리' 탭 상단에 노란 대기 카드가 나타납니다.",
          "요청 인원과 사유를 확인한 뒤 '승인'을 누르면 즉시 총원(TO)에 반영되고, '거절'을 누르면 기존 총원이 그대로 유지됩니다.",
        ]),
        h2("마스터 관리자 전용 화면 (신규)"),
        ...bullets([
          "시스템 최초 설치 시 자동 생성되는 '마스터 관리자' 계정(기본 사번 admin)으로 로그인하면 '내 식사 신청' 메뉴가 보이지 않고, 바로 관리자 화면으로 이동합니다. 이 계정은 직원 관리 탭의 등록 인원 요약과 '미신청 인원' 집계에서도 자동으로 제외됩니다.",
          "직원 관리 화면에서 다른 직원에게 나중에 관리자 권한을 부여한 경우에는 예전과 동일하게 관리자 화면과 '내 식사 신청' 화면을 모두 사용할 수 있고, 인원 집계에도 정상적으로 포함되며 식사 신청도 그대로 할 수 있습니다.",
          "기존에 로그인해 있던 관리자 계정은 로그아웃 후 다시 로그인해야 이 구분이 정확히 반영됩니다.",
        ]),
        h2("일일 집계 · 월간 집계 개편 (신규)"),
        ...bullets([
          "일일 집계 탭: 중식/석식별로 '신청자 명단'과 '미신청자 명단'을 각각 표로 나눠서 확인할 수 있습니다.",
          "일일 집계·월간 집계 상단 요약 카드에 일반직원과 도급직원 인원을 나누어 보여주고, 파란색으로 강조된 카드에 통합 합계도 함께 표시됩니다.",
          "예) 일반직원 중식 00명, 도급직원 중식 00명, 중식 합계 000명 / 일반직원 석식 00명, 도급직원 석식 00명, 석식 합계 000명",
        ]),
        h2("직원 화면"),
        ...bullets([
          "오늘 아직 신청하지 않았다면, 접속 시 자동으로 신청을 안내하는 팝업이 한 번 뜹니다.",
          "관리자가 공지사항을 올리면 화면 위쪽에 주황색 안내 배너로 표시됩니다.",
          "'식단표 보기' 버튼을 누르면 이번 주 / 다음 주 식단표를 확인할 수 있습니다.",
          "화면 위쪽 '앱 설치' 버튼을 누르면 PC 바탕화면이나 휴대폰 홈 화면에 앱처럼 설치할 수 있습니다.",
          "'휴대폰 알림 받기' 버튼을 누르고 알림을 허용하면, 마감 임박 알림을 받을 수 있습니다(②③단계를 진행한 경우에만 동작).",
        ]),
        h2("로그인 자동 저장 + 접속 링크·QR 공유 (신규)"),
        ...bullets([
          "로그인에 성공하면 사번과 이름이 그 기기에 저장되어, 다음에 접속했을 때 로그인 입력칸에 자동으로 채워집니다.",
          "로그인 후 화면 위쪽 '접속 링크 공유' 버튼을 누르면 사이트 주소를 복사하거나 QR코드를 스캔해서 다른 직원에게 바로 전달할 수 있습니다.",
        ]),
        h2("도급(단체) 계정 화면 (신규)"),
        ...bullets([
          "도급팀 사번으로 로그인하면 화면 위쪽 사용자 표시와 주간 달력 위쪽 카드에 '도급' 표시 대신 부서명 + 이름(예: 협력업체 OO건설)이 함께 표시됩니다.",
          "주간 달력 위쪽에 현재 등록된 총원(TO)이 카드로 표시됩니다.",
          "총원이 실제 인원과 다르면 '총원 수정 요청' 버튼을 눌러 원하는 인원수와 사유를 입력해 관리자에게 바로 보낼 수 있습니다 (관리자 승인 후 반영).",
          "각 날짜의 중식/석식 입력란 아래에 '신청 인원 / 총원' 과 '미신청' 인원이 함께 표시됩니다.",
        ]),
        h2("업데이트 확인 버튼 (신규)"),
        ...bullets([
          "로그인 화면 맨 아래에 '업데이트 확인' 버튼이 추가되었습니다.",
          "특히 PC 바탕화면이나 휴대폰 홈 화면에 '앱처럼' 설치해서 쓰는 경우, 예전 화면이 계속 보이거나 새 기능이 안 보이면 이 버튼을 눌러주세요. 저장된 캐시를 정리하고 최신 버전을 새로 받아옵니다.",
        ]),
        h2("주말·공휴일 빨간색 표시 (신규)"),
        ...bullets([
          "주간 달력에서 평일 신청 버튼은 기존과 동일하게 파란색으로 보이고, 토요일·일요일과 공휴일은 날짜·요일 글자와 신청 버튼이 빨간색으로 구분되어 표시됩니다.",
          "이미 신청 완료된 초록색 버튼이나, 마감시간이 지나 비활성화된 회색 버튼은 주말·공휴일이어도 색이 바뀌지 않고 그대로 유지됩니다.",
          "신정·삼일절·어린이날·현충일·광복절·개천절·한글날·크리스마스처럼 매년 날짜가 고정된 양력 공휴일은 별도 설정 없이 자동으로 빨간색 표시됩니다.",
          "설날·추석 연휴처럼 해마다 날짜가 바뀌는 공휴일이나 대체공휴일·임시공휴일은 관리자 화면 '설정' 탭의 '공휴일 관리'에서 날짜와 이름(선택)을 입력해 등록하면 됩니다. 등록한 공휴일은 목록에서 언제든 삭제할 수 있습니다.",
          "등록된 공휴일은 일일 집계 화면 제목 옆과 월간 집계 표에도 빨간색으로 함께 표시됩니다.",
        ]),
        h2("내방객(손님) 식수 신청 (신규)"),
        ...bullets([
          "개인 직원이 중식 또는 석식을 신청하면, 신청 버튼 바로 아래에 '내방객' 입력칸이 나타납니다. 손님·내방객과 함께 식사할 경우 인원수(0~99명)를 입력하고 저장 버튼을 누르면 됩니다.",
          "내방객 인원 등록·수정은 해당 끼니의 신청·취소와 동일한 마감시간까지만 가능합니다.",
          "신청을 취소하면 등록해두었던 내방객 인원도 함께 0으로 초기화됩니다.",
          "도급(단체) 계정은 총원(TO)으로 이미 전체 인원을 직접 입력하는 방식이라 내방객 입력칸이 별도로 나타나지 않습니다.",
          "관리자 화면의 신청 현황·일일 집계·월간 집계 모두 '일반직원 / 도급직원 / 내방객' 인원을 각각 구분된 카드로 보여주고, 조리에 필요한 전체 합계에는 내방객 인원까지 포함해서 계산됩니다.",
          "일일 집계·월간 집계 엑셀 다운로드 파일에도 내방객 인원 열과 합계가 함께 포함됩니다.",
        ]),
        h2("아이폰·아이패드 홈 화면 설치 (신규)"),
        ...bullets([
          "그동안 '앱 설치' 버튼은 안드로이드/PC 크롬에서만 나타났는데, 이번 업데이트로 아이폰·아이패드에서 접속해도 버튼이 나타납니다.",
          "아이폰·아이패드의 Safari는 자동 설치를 지원하지 않기 때문에, 버튼을 누르면 'Safari 공유 버튼 → 홈 화면에 추가' 방법을 그림 대신 3단계 글로 안내하는 팝업이 뜹니다. 안내에 따라 직접 몇 번만 탭하면 설치됩니다.",
          "홈 화면에 추가한 뒤 아이콘을 눌러 실행하면 Safari 주소창 없이 다른 앱처럼 전체화면으로 열리고, 홈 화면 아이콘 아래에는 '신흥정밀 식사신청'이라는 이름이 표시됩니다.",
          "이미 홈 화면에 설치해서 실행 중인 경우에는(아이폰·아이패드·안드로이드·PC 모두) '앱 설치' 버튼이 자동으로 사라집니다.",
        ]),
        note("카카오톡·네이버 앱 등에서 링크를 눌러 '앱 안 브라우저'로 열었을 때는 아이폰에서 '홈 화면에 추가' 기능 자체가 보이지 않을 수 있습니다. 이 경우 화면 아래 '다른 브라우저로 열기'(또는 '⋮' 메뉴) → Safari로 열기를 선택한 뒤 설치를 진행해주세요."),

        h1("자주 묻는 질문"),
        h2("Q. 알림이 오지 않아요."),
        ...bullets([
          "②단계에서 VAPID 값 4개를 정확히 입력하고 저장했는지 확인해주세요.",
          "③단계에서 cron-job.org에 작업을 만들었는지, 그리고 'Last execution' 결과가 성공(초록색)인지 확인해주세요.",
          "휴대폰/PC의 브라우저 알림 권한을 '허용'으로 눌렀는지 확인해주세요(실수로 '차단'을 누른 경우, 브라우저 설정에서 다시 허용으로 바꿔야 합니다).",
          "아이폰(iOS)은 사이트를 먼저 '홈 화면에 추가'로 설치한 뒤, 그 아이콘으로 들어가서 '휴대폰 알림 받기'를 눌러야 알림이 동작합니다.",
        ]),
        h2("Q. 마감 시간을 9시 30분에서 9시로 바꾸고 싶어요."),
        p("파일 업로드가 끝난 뒤, 관리자로 로그인 → 설정 탭에서 시(9), 분(0)을 입력하고 저장 버튼을 누르면 바로 적용됩니다. 별도로 다시 배포할 필요가 없습니다."),
        h2("Q. 업로드 도중 실수를 한 것 같아요."),
        p("직원 명단과 신청 내역은 GitHub가 아니라 MongoDB라는 별도의 데이터베이스에 저장되어 있어서, GitHub 파일을 다시 올려도 데이터에는 전혀 영향이 없습니다. 이 가이드를 처음부터 다시 따라 하시면 됩니다."),
        h2("Q. 식단표 이미지가 안 올라가요."),
        p("이미지 파일 용량은 4MB 이하로 준비해주세요. 엑셀로 만든 주간 식단표라면, 가로(landscape) 방향으로 한 페이지에 맞춰 캡처(스크린샷)한 뒤 jpg 또는 png 파일로 업로드하시면 깔끔하게 나옵니다."),
        h2("Q. 설날/추석 연휴에 색이 빨간색으로 안 바뀌어요."),
        p("설날·추석 연휴는 매년 날짜가 달라 자동으로 인식되지 않습니다. 관리자로 로그인 → 설정 탭 → '공휴일 관리'에서 해당 날짜를 하나씩 등록해주세요 (예: 연휴 3일이면 3번 등록). 신정·삼일절처럼 날짜가 고정된 공휴일은 등록하지 않아도 자동으로 빨간색으로 표시됩니다."),
        h2("Q. 아이폰에서 '앱 설치' 버튼을 눌러도 설치 창이 안 떠요."),
        p("아이폰은 안드로이드와 달리 버튼 한 번으로 자동 설치되지 않고, 대신 Safari에서 직접 '공유 → 홈 화면에 추가'를 눌러야 합니다. '앱 설치' 버튼을 누르면 그 방법을 안내하는 팝업이 뜨니, 팝업의 안내대로 따라 하시면 됩니다. 만약 팝업조차 뜨지 않는다면 카카오톡·네이버 앱 안의 '인앱 브라우저'로 열려 있을 가능성이 높습니다 — 화면 오른쪽 아래(또는 '⋮') 메뉴에서 'Safari로 열기'를 선택한 뒤 다시 시도해주세요."),

        new Paragraph({ text: "", spacing: { before: 300 } }),
        note("궁금한 점이 있으면 처음 설치를 도와드렸던 것처럼 화면을 캡처해서 보여주시면 함께 확인해드릴 수 있습니다."),
      ],
    },
  ],
});

const outPath = path.join(__dirname, "업데이트_배포가이드.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("Written:", outPath);
});
