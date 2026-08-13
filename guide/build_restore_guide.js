const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat,
} = require("docx");

const PAGE_WIDTH = 12240;
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
function bullets(items) {
  return items.map(
    (item) =>
      new Paragraph({
        text: item,
        numbering: { reference: "bullet-list", level: 0 },
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
function warn(text) {
  return new Paragraph({
    children: [new TextRun({ text: `⚠ ${text}`, bold: true, color: "B91C1C" })],
    spacing: { after: 140 },
    indent: { left: 200 },
  });
}

function scenarioTable(rows) {
  const cellOpts = { verticalAlign: "center", margins: { top: 80, bottom: 80, left: 100, right: 100 } };
  const mk = (text, width, header) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, fill: "EEF1F6" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
      ...cellOpts,
    });
  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [4400, 5200],
    rows: rows.map(([a, b], i) => new TableRow({ children: [mk(a, 4400, i === 0), mk(b, 5200, i === 0)] })),
  });
}

function memoTable(rows) {
  const cellOpts = { verticalAlign: "center", margins: { top: 80, bottom: 80, left: 100, right: 100 } };
  const mk = (text, width, header) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, fill: "EEF1F6" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
      ...cellOpts,
    });
  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [3200, 6400],
    rows: rows.map(([a, b], i) => new TableRow({ children: [mk(a, 3200, i === 0), mk(b, 6400, i === 0)] })),
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }],
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
          children: [new TextRun({ text: "복원(재해 복구) 안내", bold: true, size: 32 })],
          spacing: { after: 200 },
        }),
        p(
          "이 문서는 PC나 서버에 문제가 생겼을 때, 당황하지 않고 빠르게 복구할 수 있도록 상황별 대처 방법을 정리한 안내서입니다. " +
            "함께 전달된 meal-app.zip 파일과 이 문서를 회사 내 안전한 곳(구글 드라이브, 회사 공용 문서함 등)에 보관해두세요."
        ),

        h1("핵심 개념: 이 시스템은 3곳에 나뉘어 있습니다"),
        p("내 PC가 고장 나도 직원들이 실제로 쓰는 사이트는 멈추지 않습니다. 아래 3가지가 서로 분리되어 각각 클라우드에 보관되기 때문입니다."),
        scenarioTable([
          ["구분", "보관 위치"],
          ["프로그램 코드 (기능)", "GitHub 저장소 (+ 이 zip 파일은 예비 백업)"],
          ["데이터 (직원 명단·신청 내역)", "MongoDB Atlas (클라우드 데이터베이스, PC와 무관)"],
          ["실제 서비스 실행", "Render (클라우드 서버, PC와 무관)"],
        ]),
        note("내 PC나 노트북은 '코드를 수정하거나 업데이트할 때'만 필요합니다. 평소 서비스 운영에는 PC가 필요 없습니다."),

        h1("상황별 대처 방법"),

        h2("A. 내 PC(노트북)가 고장났을 때 — 가장 흔한 경우"),
        ...bullets([
          "직원들이 쓰는 사이트는 그대로 정상 동작합니다. 급하게 할 일은 없습니다.",
          "새 PC(또는 스마트폰 브라우저)에서 github.com, render.com, mongodb.com(Atlas) 에 각각 로그인만 하면 예전처럼 다시 관리할 수 있습니다.",
          "이 zip 파일은 혹시 GitHub 저장소 자체도 함께 잃어버렸을 때를 대비한 예비 백업용입니다.",
        ]),

        h2("B. Render 서비스가 실수로 삭제/오류가 났을 때"),
        ...bullets([
          "'식사신청시스템_설치가이드.docx'의 3단계(Render에 배포)만 다시 진행하면 됩니다.",
          "이때 MONGODB_URI 값을 기존에 쓰던 값 그대로 입력하면, 기존 직원 명단과 신청 내역이 데이터베이스에 그대로 남아있어 데이터 손실 없이 복구됩니다.",
          "다만 새로 만들면 사이트 주소(URL)가 바뀔 수 있습니다 (예: meal-app-y7j2.onrender.com → 다른 임의 주소). 새 주소를 직원들에게 다시 공지해주세요.",
        ]),

        h2("C. GitHub 저장소가 삭제/손상되었을 때"),
        ...bullets([
          "이 zip 파일의 압축을 풀어서 '설치가이드'의 1단계(GitHub에 코드 올리기)대로 새 저장소를 만들고 다시 업로드합니다.",
          "Render 대시보드에서 이 새 저장소를 다시 연결(또는 새 서비스 생성)하면 됩니다. 이때도 MONGODB_URI를 기존 값 그대로 쓰면 데이터는 유지됩니다.",
        ]),

        h2("D. MongoDB Atlas(데이터베이스)가 삭제되었을 때 — 가장 심각한 경우"),
        warn("이 경우는 시스템에 자동 복구 기능이 없습니다. 아래 '정기 백업 습관'을 반드시 지켜주세요."),
        ...bullets([
          "정기적으로 받아둔 '데이터 백업 다운로드'(JSON 파일)가 있다면, 개발자의 도움을 받아 새 데이터베이스에 다시 입력할 수 있습니다 (자동 업로드 기능은 현재 없고, 참고용 원본 자료로 사용됩니다).",
          "백업 파일이 없다면 직원 명단은 [관리자] → [직원 관리] → [등록 양식 다운로드]로 엑셀 서식을 받아 다시 일괄 등록할 수 있지만, 과거 신청 내역(누가 언제 신청했는지 기록)은 복구할 수 없습니다.",
        ]),

        h1("정기 백업 습관을 권장합니다"),
        p("한 달에 한 번 정도 아래 방법으로 데이터를 내 컴퓨터에 저장해두면, 위 D번 같은 최악의 상황에서도 최소한의 자료를 지킬 수 있습니다."),
        ...bullets([
          "관리자로 로그인 → [관리자] → [설정] 탭 → '데이터 백업 다운로드' 버튼 클릭 → 파일을 안전한 곳(구글 드라이브 등)에 보관",
          "가능하면 이 zip 파일도 새 업데이트를 받을 때마다 최신 버전으로 교체해서 보관해주세요.",
        ]),

        h1("지금 미리 안전하게 메모해두면 좋은 값들"),
        p("아래 값들은 Render 대시보드의 'Environment' 화면에서 언제든 확인할 수 있지만, 만약을 대비해 비밀번호 관리자나 회사 보안 문서함 등 별도의 안전한 곳에도 적어두시길 권장합니다 (이 문서나 zip 파일에는 실제 값이 포함되어 있지 않습니다, 보안을 위해 의도적으로 비워두었습니다)."),
        memoTable([
          ["항목", "메모"],
          ["현재 서비스 접속 주소 (URL)", ""],
          ["GitHub 계정 (아이디/이메일)", ""],
          ["Render 계정 (아이디/이메일)", ""],
          ["MongoDB Atlas 계정 (아이디/이메일)", ""],
          ["MONGODB_URI (연결 문자열)", ""],
          ["JWT_SECRET", ""],
          ["ADMIN_EMPLOYEE_ID / ADMIN_NAME", ""],
          ["VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY", ""],
          ["CRON_SECRET", ""],
        ]),
        note("이 표는 인쇄하거나 화면에 직접 타이핑해서 채운 뒤, 회사 금고나 비밀번호 관리자 등 신뢰할 수 있는 곳에 보관하세요."),

        h1("이 zip 파일에 포함된 내용"),
        ...bullets([
          "전체 프로그램 소스코드 (server, public 폴더 등) — 오늘 기준 최종본",
          "식사신청시스템_설치가이드.docx — 처음부터 새로 설치할 때 사용",
          "업데이트_배포가이드.docx — 이미 운영 중인 사이트에 기능 업데이트를 반영할 때 사용",
          "직원용_이용안내.docx — 직원들에게 배포하는 1장짜리 사용법 안내",
          "이 문서(복원_안내.docx) — 문제 발생 시 대처 방법",
          "CHANGELOG.md — 지금까지 추가된 전체 기능 이력",
        ]),
        note("이 파일들만 있으면 PC나 서버에 어떤 문제가 생기더라도, 개발자의 추가 도움 없이도 웬만한 상황은 이 문서를 보고 스스로 복구하실 수 있습니다."),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "복원_안내.docx");
  fs.writeFileSync(out, buf);
  console.log("Written:", out);
});
