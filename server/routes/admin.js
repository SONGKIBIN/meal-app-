const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getMonthDates, todayKSTStr } = require("../utils/dateUtil");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

router.use(requireAuth, requireAdmin);

/* ---------------------------- 직원 관리 ---------------------------- */

router.get("/employees", async (req, res) => {
  const list = await Employee.find({}).sort({ department: 1, name: 1 }).lean();
  res.json({ employees: list });
});

router.post("/employees", async (req, res) => {
  try {
    const { employeeId, name, department, role } = req.body;
    if (!employeeId || !name) {
      return res.status(400).json({ error: "사번과 이름은 필수입니다." });
    }
    const emp = await Employee.findOneAndUpdate(
      { employeeId: String(employeeId).trim() },
      {
        $set: {
          employeeId: String(employeeId).trim(),
          name: String(name).trim(),
          department: department ? String(department).trim() : "",
          role: role === "admin" ? "admin" : "user",
          active: true,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "저장 중 오류가 발생했습니다." });
  }
});

router.put("/employees/:id", async (req, res) => {
  try {
    const { name, department, role, active } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (department !== undefined) update.department = String(department).trim();
    if (role !== undefined) update.role = role === "admin" ? "admin" : "user";
    if (active !== undefined) update.active = !!active;
    const emp = await Employee.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "수정 중 오류가 발생했습니다." });
  }
});

// 소프트 삭제 (재직 여부를 false로 변경 - 기록 보존을 위해 완전 삭제하지 않음)
router.delete("/employees/:id", async (req, res) => {
  try {
    const emp = await Employee.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "삭제 중 오류가 발생했습니다." });
  }
});

// 엑셀 일괄 등록 템플릿 다운로드
router.get("/employees/import-template", async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("직원명단");
  ws.columns = [
    { header: "사번", key: "employeeId", width: 15 },
    { header: "이름", key: "name", width: 15 },
    { header: "부서", key: "department", width: 20 },
  ];
  ws.addRow({ employeeId: "10001", name: "홍길동", department: "생산1팀" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=employee_template.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

// 엑셀 일괄 등록 (열 헤더: 사번, 이름, 부서)
router.post("/employees/import", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const [idx, row] of rows.entries()) {
      const employeeId = String(row["사번"] ?? row["employeeId"] ?? "").trim();
      const name = String(row["이름"] ?? row["name"] ?? "").trim();
      const department = String(row["부서"] ?? row["department"] ?? "").trim();
      if (!employeeId || !name) {
        errors.push(`${idx + 2}행: 사번 또는 이름이 비어있어 건너뛰었습니다.`);
        continue;
      }
      const existing = await Employee.findOne({ employeeId });
      if (existing) {
        existing.name = name;
        existing.department = department;
        existing.active = true;
        await existing.save();
        updated++;
      } else {
        await Employee.create({ employeeId, name, department, role: "user", active: true });
        created++;
      }
    }

    res.json({ created, updated, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 처리 중 오류가 발생했습니다. 파일 형식을 확인해주세요." });
  }
});

/* ---------------------------- 예약 조회/수정 ---------------------------- */

// 특정 날짜의 전체 신청 현황 (관리자용 상세 목록)
router.get("/reservations", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const rows = await Reservation.find({ date, status: "applied" }).sort({ department: 1, employeeName: 1 }).lean();
  const lunch = rows.filter((r) => r.mealType === "lunch");
  const dinner = rows.filter((r) => r.mealType === "dinner");
  res.json({ date, lunch, dinner, lunchCount: lunch.length, dinnerCount: dinner.length });
});

// 관리자 강제 변경 (마감시간/당일취소 제한을 무시하고 신청 또는 취소 처리)
router.put("/reservations/override", async (req, res) => {
  try {
    const { employeeId, date, mealType, status } = req.body;
    if (!DATE_RE.test(date || "") || !["lunch", "dinner"].includes(mealType) || !["applied", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const emp = await Employee.findOne({ employeeId });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });

    const updated = await Reservation.findOneAndUpdate(
      { employeeId, date, mealType },
      {
        $set: {
          status,
          employeeName: emp.name,
          department: emp.department,
          modifiedByAdmin: true,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ reservation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
});

/* ---------------------------- 집계 ---------------------------- */

router.get("/summary/daily", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const rows = await Reservation.find({ date, status: "applied" }).lean();
  const lunch = rows.filter((r) => r.mealType === "lunch");
  const dinner = rows.filter((r) => r.mealType === "dinner");
  res.json({
    date,
    lunchCount: lunch.length,
    dinnerCount: dinner.length,
    lunch,
    dinner,
  });
});

router.get("/summary/monthly", async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다 (YYYY-MM)." });
  const [year, mon] = month.split("-").map(Number);
  const dates = getMonthDates(year, mon);
  const rows = await Reservation.find({ date: { $in: dates }, status: "applied" }).lean();

  const byDate = {};
  for (const d of dates) byDate[d] = { date: d, lunchCount: 0, dinnerCount: 0 };
  for (const r of rows) {
    byDate[r.date][r.mealType === "lunch" ? "lunchCount" : "dinnerCount"]++;
  }
  const days = dates.map((d) => byDate[d]);
  const totalLunch = days.reduce((s, d) => s + d.lunchCount, 0);
  const totalDinner = days.reduce((s, d) => s + d.dinnerCount, 0);
  res.json({ month, days, totalLunch, totalDinner });
});

/* ---------------------------- 엑셀 내보내기 ---------------------------- */

router.get("/export/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다." });
    const rows = await Reservation.find({ date, status: "applied" }).sort({ mealType: 1, department: 1, employeeName: 1 }).lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${date} 신청현황`);
    ws.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "관리자수정", key: "modifiedByAdmin", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => {
      ws.addRow({
        date: r.date,
        mealType: r.mealType === "lunch" ? "중식" : "석식",
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        department: r.department,
        modifiedByAdmin: r.modifiedByAdmin ? "O" : "",
      });
    });
    const lunchCount = rows.filter((r) => r.mealType === "lunch").length;
    const dinnerCount = rows.filter((r) => r.mealType === "dinner").length;
    ws.addRow({});
    ws.addRow({ date: "합계", mealType: `중식 ${lunchCount}명 / 석식 ${dinnerCount}명` });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=meal_${date}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
});

router.get("/export/monthly", async (req, res) => {
  try {
    const { month } = req.query;
    if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다." });
    const [year, mon] = month.split("-").map(Number);
    const dates = getMonthDates(year, mon);
    const rows = await Reservation.find({ date: { $in: dates }, status: "applied" }).lean();

    const wb = new ExcelJS.Workbook();

    // 요약 시트: 일자별 집계
    const summary = wb.addWorksheet("월간 집계");
    summary.columns = [
      { header: "날짜", key: "date", width: 14 },
      { header: "중식 인원", key: "lunch", width: 12 },
      { header: "석식 인원", key: "dinner", width: 12 },
    ];
    summary.getRow(1).font = { bold: true };
    const byDate = {};
    for (const d of dates) byDate[d] = { lunch: 0, dinner: 0 };
    for (const r of rows) byDate[r.date][r.mealType]++;
    let totalLunch = 0;
    let totalDinner = 0;
    for (const d of dates) {
      summary.addRow({ date: d, lunch: byDate[d].lunch, dinner: byDate[d].dinner });
      totalLunch += byDate[d].lunch;
      totalDinner += byDate[d].dinner;
    }
    summary.addRow({});
    summary.addRow({ date: "합계", lunch: totalLunch, dinner: totalDinner });

    // 상세 시트: 전체 신청 내역
    const detail = wb.addWorksheet("상세 내역");
    detail.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
    ];
    detail.getRow(1).font = { bold: true };
    rows
      .sort((a, b) => (a.date + a.mealType).localeCompare(b.date + b.mealType))
      .forEach((r) => {
        detail.addRow({
          date: r.date,
          mealType: r.mealType === "lunch" ? "중식" : "석식",
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          department: r.department,
        });
      });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=meal_${month}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
});

module.exports = router;
