const express = require("express");
const ExcelJS = require("exceljs");

const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const Holiday = require("../models/Holiday");
const { requireAuth, attachManagerScope } = require("../middleware/auth");
const { getMonthDates, fixedHolidayLabel, isWeekendDate } = require("../utils/dateUtil");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// 부서 운영자(role=manager) 전용 화면입니다. 모든 라우트는 로그인 + 부서 운영자 확인을 거치며,
// attachManagerScope가 이 운영자가 실제로 조회/관리할 수 있는 부서 목록을 req.scopeDepartments에 채워줍니다
// (본인 소속 부서 + 관리자가 추가로 지정한 담당 부서). 조회/수정 대상은 항상 이 목록에 속한 부서의
// 직원으로 제한됩니다.
router.use(requireAuth, attachManagerScope);

// 이 운영자가 조회 가능한 부서 목록 (화면 상단에 표시용)
router.get("/meta", async (req, res) => {
  res.json({ departments: req.scopeDepartments });
});

async function scopedEmployees(scope) {
  if (!scope.length) return [];
  return Employee.find({ department: { $in: scope } }).sort({ department: 1, name: 1 }).lean();
}

/* ---------------------------- 인원 관리 (담당 부서 한정, 수정만 가능) ---------------------------- */

router.get("/employees", async (req, res) => {
  const list = await scopedEmployees(req.scopeDepartments);
  res.json({ employees: list });
});

// 운영자는 직원을 새로 등록하거나 완전히/소프트 삭제할 수 없습니다. 담당 부서 소속 직원의
// 이름/구분(개인·도급)/총원(TO)/재직 여부만 수정할 수 있고, 부서 이동이나 권한(role) 변경은 할 수 없습니다.
router.put("/employees/:id", async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    if (!req.scopeDepartments.includes(emp.department)) {
      return res.status(403).json({ error: "담당 부서 소속 직원만 수정할 수 있습니다." });
    }
    const { name, active, employeeType, totalHeadcount } = req.body;
    if (name !== undefined) emp.name = String(name).trim();
    if (active !== undefined) emp.active = !!active;
    if (employeeType !== undefined) {
      emp.employeeType = employeeType === "contractor" ? "contractor" : "individual";
      if (emp.employeeType === "contractor") {
        const n = parseInt(totalHeadcount, 10);
        emp.totalHeadcount = Number.isInteger(n) && n >= 0 ? n : null;
      } else {
        emp.totalHeadcount = null;
      }
    }
    await emp.save();
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "수정 중 오류가 발생했습니다." });
  }
});

/* ---------------------------- 신청 현황 / 신청·취소 처리 ---------------------------- */

router.get("/reservations", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const scope = req.scopeDepartments;
  if (!scope.length) return res.json({ date, lunch: [], dinner: [], lunchCount: 0, dinnerCount: 0, lunchGuestCount: 0, dinnerGuestCount: 0 });
  const rows = await Reservation.find({ date, status: "applied", department: { $in: scope } })
    .sort({ department: 1, employeeName: 1 })
    .lean();
  const lunch = rows.filter((r) => r.mealType === "lunch");
  const dinner = rows.filter((r) => r.mealType === "dinner");
  const sumHeadcount = (list) => list.reduce((s, r) => s + (r.headcount ?? 1), 0);
  const sumGuest = (list) => list.reduce((s, r) => s + (r.guestCount ?? 0), 0);
  res.json({
    date,
    lunch,
    dinner,
    lunchCount: sumHeadcount(lunch),
    dinnerCount: sumHeadcount(dinner),
    lunchGuestCount: sumGuest(lunch),
    dinnerGuestCount: sumGuest(dinner),
  });
});

// admin.js의 computePendingSummary와 동일한 로직을 담당 부서 범위로 제한해서 계산합니다.
async function computeScopedPendingSummary(date, scope) {
  const employees = scope.length
    ? await Employee.find({ active: true, department: { $in: scope } }).sort({ department: 1, name: 1 }).lean()
    : [];
  // 신청(status: applied)한 사람뿐 아니라, 명시적으로 "안 먹어요"를 등록한(declinedHeadcount > 0)
  // 사람도 함께 가져와야 "안 먹어요"를 선택한 사람이 "미신청(미정)" 명단에 잘못 섞이지 않습니다.
  const rows = employees.length ? await Reservation.find({ date, $or: [{ status: "applied" }, { declinedHeadcount: { $gt: 0 } }] }).lean() : [];
  const appliedLunchMap = new Map();
  const appliedDinnerMap = new Map();
  const declinedLunchMap = new Map();
  const declinedDinnerMap = new Map();
  for (const r of rows) {
    if (r.status === "applied") {
      const map = r.mealType === "lunch" ? appliedLunchMap : appliedDinnerMap;
      map.set(r.employeeId, r.headcount ?? 1);
    }
    if (r.declinedHeadcount > 0) {
      const map = r.mealType === "lunch" ? declinedLunchMap : declinedDinnerMap;
      map.set(r.employeeId, r.declinedHeadcount);
    }
  }

  // 도급(단체) 계정은 총원 중 일부만 신청/일부만 안 먹음으로 등록했을 수 있어(둘 다 부분적으로
  // 존재 가능), 안 먹어요를 등록했다고 해서 그 계정 전체를 미신청 계산에서 제외하면 안 됩니다.
  // 개인 직원은 한 사람이므로 안 먹어요를 등록했으면 더 이상 미정이 아니라 완전히 제외합니다.
  function build(appliedMap, declinedMap) {
    const list = [];
    let count = 0;
    for (const e of employees) {
      const appliedHeadcount = appliedMap.get(e.employeeId);
      const declinedHeadcount = declinedMap.get(e.employeeId) ?? 0;
      if (e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) && e.totalHeadcount > 0) {
        const applied2 = appliedHeadcount ?? 0;
        const shortfall = e.totalHeadcount - applied2 - declinedHeadcount;
        if (shortfall > 0) {
          list.push({ ...e, appliedHeadcount: applied2, shortfall });
          count += shortfall;
        }
      } else {
        if (declinedHeadcount > 0) continue;
        if (appliedHeadcount === undefined) {
          list.push({ ...e, appliedHeadcount: 0, shortfall: 1 });
          count += 1;
        }
      }
    }
    return { list, count };
  }

  function buildDeclined(declinedMap) {
    const list = [];
    let count = 0;
    for (const e of employees) {
      const n = declinedMap.get(e.employeeId);
      if (n) {
        list.push({ ...e, declinedHeadcount: n });
        count += n;
      }
    }
    return { list, count };
  }

  const lunch = build(appliedLunchMap, declinedLunchMap);
  const dinner = build(appliedDinnerMap, declinedDinnerMap);
  const declinedLunch = buildDeclined(declinedLunchMap);
  const declinedDinner = buildDeclined(declinedDinnerMap);
  return {
    totalEmployees: employees.length,
    pendingLunch: lunch.list,
    pendingDinner: dinner.list,
    pendingLunchCount: lunch.count,
    pendingDinnerCount: dinner.count,
    declinedLunch: declinedLunch.list,
    declinedDinner: declinedDinner.list,
    declinedLunchCount: declinedLunch.count,
    declinedDinnerCount: declinedDinner.count,
  };
}

router.get("/reservations/pending", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const summary = await computeScopedPendingSummary(date, req.scopeDepartments);
  res.json({ date, ...summary });
});

// 담당 부서 소속 직원에 한해, 마감시간과 관계없이 신청/취소를 대신 처리할 수 있습니다.
router.put("/reservations/override", async (req, res) => {
  try {
    const { date, mealType, status, headcount, guestCount } = req.body;
    const employeeId = typeof req.body.employeeId === "string" ? req.body.employeeId.trim() : "";
    if (!employeeId || !DATE_RE.test(date || "") || !["lunch", "dinner"].includes(mealType) || !["applied", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const emp = await Employee.findOne({ employeeId });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    if (!req.scopeDepartments.includes(emp.department)) {
      return res.status(403).json({ error: "담당 부서 소속 직원만 신청/취소를 처리할 수 있습니다." });
    }

    const set = {
      status,
      employeeName: emp.name,
      department: emp.department,
      modifiedByAdmin: true,
    };
    const n = parseInt(headcount, 10);
    if (Number.isInteger(n) && n >= 0) set.headcount = n;
    const g = parseInt(guestCount, 10);
    if (Number.isInteger(g) && g >= 0) set.guestCount = g;
    if (status === "cancelled" && !Number.isInteger(g)) set.guestCount = 0;
    // 개인 직원을 운영자가 강제로 "신청" 처리하면, 그 사람이 이전에 등록해둔 "안 먹어요" 표시와
    // 앞뒤가 안 맞으므로 함께 해제합니다. 도급(단체) 계정은 신청 인원과 안 먹는 인원이 별개 숫자로
    // 동시에 존재할 수 있으므로 건드리지 않습니다.
    if (status === "applied" && emp.employeeType !== "contractor") set.declinedHeadcount = 0;

    const updated = await Reservation.findOneAndUpdate(
      { employeeId, date, mealType },
      { $set: set },
      { upsert: true, new: true }
    );
    res.json({ reservation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
});

/* ---------------------------- 집계 (담당 부서 한정) ---------------------------- */

// admin.js의 splitByEmployeeType과 동일하되, 이미 담당 부서로 필터링된 rows를 받습니다.
function splitByEmployeeTypeSync(rows, typeMap) {
  let individual = 0;
  let contractor = 0;
  let guest = 0;
  for (const r of rows) {
    const hc = r.headcount ?? 1;
    guest += r.guestCount ?? 0;
    if (typeMap.get(r.employeeId) === "contractor") contractor += hc;
    else individual += hc;
  }
  return { individual, contractor, guest, total: individual + contractor + guest };
}

async function buildEmployeeTypeMap(rows) {
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const emps = ids.length ? await Employee.find({ employeeId: { $in: ids } }, { employeeId: 1, employeeType: 1 }).lean() : [];
  return new Map(emps.map((e) => [e.employeeId, e.employeeType]));
}

router.get("/summary/daily", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const scope = req.scopeDepartments;
  const rows = scope.length ? await Reservation.find({ date, status: "applied", department: { $in: scope } }).lean() : [];
  const lunch = rows.filter((r) => r.mealType === "lunch");
  const dinner = rows.filter((r) => r.mealType === "dinner");
  const [typeMap, pending, customHoliday] = await Promise.all([
    buildEmployeeTypeMap(rows),
    computeScopedPendingSummary(date, scope),
    Holiday.findOne({ date }).lean(),
  ]);
  const lunchSplit = splitByEmployeeTypeSync(lunch, typeMap);
  const dinnerSplit = splitByEmployeeTypeSync(dinner, typeMap);
  const fixedLabel = fixedHolidayLabel(date);
  const holidayLabel = customHoliday ? customHoliday.label || "" : fixedLabel;
  const dayType = customHoliday || fixedLabel ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday";
  res.json({
    date,
    dayType,
    holidayLabel: holidayLabel || "",
    lunchCount: lunchSplit.total,
    dinnerCount: dinnerSplit.total,
    individualLunchCount: lunchSplit.individual,
    contractorLunchCount: lunchSplit.contractor,
    guestLunchCount: lunchSplit.guest,
    individualDinnerCount: dinnerSplit.individual,
    contractorDinnerCount: dinnerSplit.contractor,
    guestDinnerCount: dinnerSplit.guest,
    pendingLunchCount: pending.pendingLunchCount,
    pendingDinnerCount: pending.pendingDinnerCount,
    pendingLunch: pending.pendingLunch,
    pendingDinner: pending.pendingDinner,
    declinedLunchCount: pending.declinedLunchCount,
    declinedDinnerCount: pending.declinedDinnerCount,
    declinedLunch: pending.declinedLunch,
    declinedDinner: pending.declinedDinner,
    lunch,
    dinner,
  });
});

router.get("/summary/monthly", async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다 (YYYY-MM)." });
  const scope = req.scopeDepartments;
  const [year, mon] = month.split("-").map(Number);
  const dates = getMonthDates(year, mon);
  const rows = scope.length ? await Reservation.find({ date: { $in: dates }, status: "applied", department: { $in: scope } }).lean() : [];
  const declinedRows = scope.length
    ? await Reservation.find({ date: { $in: dates }, declinedHeadcount: { $gt: 0 }, department: { $in: scope } }).lean()
    : [];

  const byDate = {};
  for (const d of dates) byDate[d] = { date: d, lunchCount: 0, dinnerCount: 0, declinedLunchCount: 0, declinedDinnerCount: 0 };
  for (const r of rows) {
    const n = (r.headcount ?? 1) + (r.guestCount ?? 0);
    byDate[r.date][r.mealType === "lunch" ? "lunchCount" : "dinnerCount"] += n;
  }
  let declinedTotalLunch = 0;
  let declinedTotalDinner = 0;
  for (const r of declinedRows) {
    byDate[r.date][r.mealType === "lunch" ? "declinedLunchCount" : "declinedDinnerCount"] += r.declinedHeadcount;
    if (r.mealType === "lunch") declinedTotalLunch += r.declinedHeadcount;
    else declinedTotalDinner += r.declinedHeadcount;
  }
  const customHolidays = await Holiday.find({ date: { $in: dates } }).lean();
  const customHolidayMap = new Map(customHolidays.map((h) => [h.date, h.label || ""]));
  for (const d of dates) {
    const customLabel = customHolidayMap.get(d);
    const fixedLabel = fixedHolidayLabel(d);
    const holidayLabel = customLabel !== undefined ? customLabel : fixedLabel;
    byDate[d].dayType = customLabel !== undefined || fixedLabel ? "holiday" : isWeekendDate(d) ? "weekend" : "weekday";
    byDate[d].holidayLabel = holidayLabel || "";
  }
  const days = dates.map((d) => byDate[d]);
  const lunchRows = rows.filter((r) => r.mealType === "lunch");
  const dinnerRows = rows.filter((r) => r.mealType === "dinner");
  const typeMap = await buildEmployeeTypeMap(rows);
  const lunchSplit = splitByEmployeeTypeSync(lunchRows, typeMap);
  const dinnerSplit = splitByEmployeeTypeSync(dinnerRows, typeMap);
  res.json({
    month,
    days,
    totalLunch: lunchSplit.total,
    totalDinner: dinnerSplit.total,
    individualTotalLunch: lunchSplit.individual,
    contractorTotalLunch: lunchSplit.contractor,
    guestTotalLunch: lunchSplit.guest,
    individualTotalDinner: dinnerSplit.individual,
    contractorTotalDinner: dinnerSplit.contractor,
    guestTotalDinner: dinnerSplit.guest,
    declinedTotalLunch,
    declinedTotalDinner,
  });
});

/* ---------------------------- 엑셀 내보내기 (담당 부서 한정) ---------------------------- */

router.get("/export/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다." });
    const scope = req.scopeDepartments;
    const rows = scope.length
      ? await Reservation.find({ date, status: "applied", department: { $in: scope } })
          .sort({ mealType: 1, department: 1, employeeName: 1 })
          .lean()
      : [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${date} 신청현황`);
    ws.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "인원수", key: "headcount", width: 10 },
      { header: "내방객", key: "guestCount", width: 10 },
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
        headcount: r.headcount ?? 1,
        guestCount: r.guestCount ?? 0,
        modifiedByAdmin: r.modifiedByAdmin ? "O" : "",
      });
    });
    const sumHeadcount = (list) => list.reduce((s, r) => s + (r.headcount ?? 1), 0);
    const sumGuest = (list) => list.reduce((s, r) => s + (r.guestCount ?? 0), 0);
    const lunchRowsX = rows.filter((r) => r.mealType === "lunch");
    const dinnerRowsX = rows.filter((r) => r.mealType === "dinner");
    const lunchEmpCount = sumHeadcount(lunchRowsX);
    const dinnerEmpCount = sumHeadcount(dinnerRowsX);
    const lunchGuestCount = sumGuest(lunchRowsX);
    const dinnerGuestCount = sumGuest(dinnerRowsX);
    ws.addRow({});
    ws.addRow({
      date: "합계",
      mealType: `중식 ${lunchEmpCount + lunchGuestCount}명(직원 ${lunchEmpCount}명 + 내방객 ${lunchGuestCount}명) / 석식 ${dinnerEmpCount + dinnerGuestCount}명(직원 ${dinnerEmpCount}명 + 내방객 ${dinnerGuestCount}명)`,
    });

    // "안 먹어요" 명단 시트
    const declinedRows = scope.length
      ? await Reservation.find({ date, declinedHeadcount: { $gt: 0 }, department: { $in: scope } })
          .sort({ mealType: 1, department: 1, employeeName: 1 })
          .lean()
      : [];
    const declinedWs = wb.addWorksheet("안 먹어요");
    declinedWs.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "안 먹는 인원수", key: "declinedHeadcount", width: 14 },
    ];
    declinedWs.getRow(1).font = { bold: true };
    declinedRows.forEach((r) => {
      declinedWs.addRow({
        date: r.date,
        mealType: r.mealType === "lunch" ? "중식" : "석식",
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        department: r.department,
        declinedHeadcount: r.declinedHeadcount,
      });
    });
    const declinedLunchTotal = declinedRows.filter((r) => r.mealType === "lunch").reduce((s, r) => s + r.declinedHeadcount, 0);
    const declinedDinnerTotal = declinedRows.filter((r) => r.mealType === "dinner").reduce((s, r) => s + r.declinedHeadcount, 0);
    declinedWs.addRow({});
    declinedWs.addRow({ date: "합계", mealType: `중식 안 먹어요 ${declinedLunchTotal}명 / 석식 안 먹어요 ${declinedDinnerTotal}명` });

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
    const scope = req.scopeDepartments;
    const [year, mon] = month.split("-").map(Number);
    const dates = getMonthDates(year, mon);
    const rows = scope.length ? await Reservation.find({ date: { $in: dates }, status: "applied", department: { $in: scope } }).lean() : [];

    const wb = new ExcelJS.Workbook();

    const summary = wb.addWorksheet("월간 집계");
    summary.columns = [
      { header: "날짜", key: "date", width: 14 },
      { header: "중식 인원", key: "lunch", width: 12 },
      { header: "중식 내방객", key: "lunchGuest", width: 12 },
      { header: "석식 인원", key: "dinner", width: 12 },
      { header: "석식 내방객", key: "dinnerGuest", width: 12 },
    ];
    summary.getRow(1).font = { bold: true };
    const byDate = {};
    for (const d of dates) byDate[d] = { lunch: 0, lunchGuest: 0, dinner: 0, dinnerGuest: 0 };
    for (const r of rows) {
      byDate[r.date][r.mealType] += r.headcount ?? 1;
      byDate[r.date][r.mealType === "lunch" ? "lunchGuest" : "dinnerGuest"] += r.guestCount ?? 0;
    }
    let totalLunch = 0, totalLunchGuest = 0, totalDinner = 0, totalDinnerGuest = 0;
    for (const d of dates) {
      summary.addRow({ date: d, lunch: byDate[d].lunch, lunchGuest: byDate[d].lunchGuest, dinner: byDate[d].dinner, dinnerGuest: byDate[d].dinnerGuest });
      totalLunch += byDate[d].lunch;
      totalLunchGuest += byDate[d].lunchGuest;
      totalDinner += byDate[d].dinner;
      totalDinnerGuest += byDate[d].dinnerGuest;
    }
    summary.addRow({});
    summary.addRow({ date: "합계", lunch: totalLunch, lunchGuest: totalLunchGuest, dinner: totalDinner, dinnerGuest: totalDinnerGuest });

    const detail = wb.addWorksheet("상세 내역");
    detail.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "인원수", key: "headcount", width: 10 },
      { header: "내방객", key: "guestCount", width: 10 },
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
          headcount: r.headcount ?? 1,
          guestCount: r.guestCount ?? 0,
        });
      });

    // "안 먹어요" 명단 시트 (이번 달)
    const declinedRows = scope.length
      ? await Reservation.find({ date: { $in: dates }, declinedHeadcount: { $gt: 0 }, department: { $in: scope } })
          .sort({ date: 1, mealType: 1, department: 1, employeeName: 1 })
          .lean()
      : [];
    const declinedWs = wb.addWorksheet("안 먹어요");
    declinedWs.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 10 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "안 먹는 인원수", key: "declinedHeadcount", width: 14 },
    ];
    declinedWs.getRow(1).font = { bold: true };
    declinedRows.forEach((r) => {
      declinedWs.addRow({
        date: r.date,
        mealType: r.mealType === "lunch" ? "중식" : "석식",
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        department: r.department,
        declinedHeadcount: r.declinedHeadcount,
      });
    });
    const declinedLunchTotal = declinedRows.filter((r) => r.mealType === "lunch").reduce((s, r) => s + r.declinedHeadcount, 0);
    const declinedDinnerTotal = declinedRows.filter((r) => r.mealType === "dinner").reduce((s, r) => s + r.declinedHeadcount, 0);
    declinedWs.addRow({});
    declinedWs.addRow({ date: "합계", mealType: `중식 안 먹어요 ${declinedLunchTotal}명 / 석식 안 먹어요 ${declinedDinnerTotal}명` });

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
