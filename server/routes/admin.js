const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const Announcement = require("../models/Announcement");
const Holiday = require("../models/Holiday");
const MealRating = require("../models/MealRating");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const {
  getMonthDates,
  todayKSTStr,
  LUNCH_DEADLINE_HOUR,
  LUNCH_DEADLINE_MINUTE,
  DINNER_DEADLINE_HOUR,
  DINNER_DEADLINE_MINUTE,
  FIXED_HOLIDAYS_MMDD,
  fixedHolidayLabel,
  isWeekendDate,
} = require("../utils/dateUtil");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// 시스템 최초 설치 시 자동 생성되는 "마스터 관리자" 계정의 사번입니다 (server.js의 bootstrapAdmin과 동일 기준).
// 직원 관리에서 다른 직원에게 관리자 권한(role=admin)을 부여해도, 그 직원은 이 사번과 다르므로
// 마스터 관리자로 취급되지 않고 일반 직원과 동일하게 인원 집계/식사 신청에 포함됩니다.
const MASTER_ADMIN_ID = process.env.ADMIN_EMPLOYEE_ID || "admin";

router.use(requireAuth, requireAdmin);

/* ---------------------------- 직원 관리 ---------------------------- */

router.get("/employees", async (req, res) => {
  const list = await Employee.find({}).sort({ department: 1, name: 1 }).lean();
  const withFlag = list.map((e) => ({ ...e, isMasterAdmin: e.employeeId === MASTER_ADMIN_ID }));
  res.json({ employees: withFlag });
});

// totalHeadcount(TO)는 도급회사(단체) 계정에만 의미가 있습니다. 개인 직원이거나 값이 없으면 null로 저장합니다.
function parseTotalHeadcount(raw, employeeType) {
  if (employeeType !== "contractor") return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// role 값을 안전하게 정규화합니다 (user/admin/manager 외 값은 모두 user로 처리).
function normalizeRole(role) {
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "user";
}

// 담당 부서 목록(쉼표 구분 문자열 또는 배열)을 정리된 문자열 배열로 변환합니다. role이 manager가 아니면 빈 배열로 저장합니다.
function parseManagedDepartments(raw, role) {
  if (role !== "manager") return [];
  const arr = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [...new Set(arr.map((d) => String(d).trim()).filter(Boolean))];
}

router.post("/employees", async (req, res) => {
  try {
    const { employeeId, name, department, role, employeeType, totalHeadcount, managedDepartments } = req.body;
    if (!employeeId || !name) {
      return res.status(400).json({ error: "사번과 이름은 필수입니다." });
    }
    const type = employeeType === "contractor" ? "contractor" : "individual";
    const normRole = normalizeRole(role);
    const emp = await Employee.findOneAndUpdate(
      { employeeId: String(employeeId).trim() },
      {
        $set: {
          employeeId: String(employeeId).trim(),
          name: String(name).trim(),
          department: department ? String(department).trim() : "",
          role: normRole,
          managedDepartments: parseManagedDepartments(managedDepartments, normRole),
          employeeType: type,
          totalHeadcount: parseTotalHeadcount(totalHeadcount, type),
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
    const { name, department, role, active, employeeType, totalHeadcount, managedDepartments } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (department !== undefined) update.department = String(department).trim();
    if (role !== undefined) {
      update.role = normalizeRole(role);
      // managedDepartments는 role과 함께 전달될 때만 갱신합니다 (role이 manager가 아니면 자동으로 비웁니다).
      update.managedDepartments = parseManagedDepartments(managedDepartments, update.role);
    } else if (managedDepartments !== undefined) {
      const current = await Employee.findById(req.params.id).lean();
      update.managedDepartments = parseManagedDepartments(managedDepartments, current ? current.role : "user");
    }
    if (active !== undefined) update.active = !!active;
    if (employeeType !== undefined) {
      update.employeeType = employeeType === "contractor" ? "contractor" : "individual";
      update.totalHeadcount = parseTotalHeadcount(totalHeadcount, update.employeeType);
    }
    const emp = await Employee.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "수정 중 오류가 발생했습니다." });
  }
});

// 담당 부서 지정 화면에서 고를 수 있도록, 현재 등록된 부서명 목록(중복 제거)을 반환합니다.
router.get("/departments", async (req, res) => {
  const list = await Employee.distinct("department", { department: { $ne: "" } });
  res.json({ departments: list.sort((a, b) => String(a).localeCompare(String(b), "ko")) });
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

// 완전 삭제 (하드 삭제) - 이미 퇴직 처리(active:false)된 직원만 대상으로 허용, DB 기록에서 완전히 제거
router.delete("/employees/:id/permanent", async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    if (emp.active) {
      return res.status(400).json({ error: "재직 중인 직원은 완전 삭제할 수 없습니다. 먼저 퇴직 처리해주세요." });
    }
    await Employee.deleteOne({ _id: emp._id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "완전 삭제 중 오류가 발생했습니다." });
  }
});

// 도급(단체) 계정이 신청한 총원(TO) 수정 요청을 관리자가 승인 - totalHeadcount에 반영 후 요청 필드 초기화
router.post("/employees/:id/approve-headcount-request", async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    if (emp.requestedHeadcount === null || emp.requestedHeadcount === undefined) {
      return res.status(400).json({ error: "대기 중인 총원 수정 요청이 없습니다." });
    }
    emp.totalHeadcount = emp.requestedHeadcount;
    emp.requestedHeadcount = null;
    emp.requestedHeadcountNote = "";
    emp.requestedHeadcountAt = null;
    await emp.save();
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "승인 처리 중 오류가 발생했습니다." });
  }
});

// 총원(TO) 수정 요청 거절 - 요청 필드만 초기화하고 기존 totalHeadcount는 유지
router.post("/employees/:id/reject-headcount-request", async (req, res) => {
  try {
    const emp = await Employee.findByIdAndUpdate(
      req.params.id,
      { $set: { requestedHeadcount: null, requestedHeadcountNote: "", requestedHeadcountAt: null } },
      { new: true }
    );
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
    res.json({ employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "거절 처리 중 오류가 발생했습니다." });
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
    { header: "구분(개인/도급)", key: "employeeType", width: 16 },
    { header: "총원(TO, 도급만)", key: "totalHeadcount", width: 16 },
  ];
  ws.addRow({ employeeId: "10001", name: "홍길동", department: "생산1팀", employeeType: "개인", totalHeadcount: "" });
  ws.addRow({ employeeId: "20001", name: "OO건설(도급)", department: "협력업체", employeeType: "도급", totalHeadcount: 30 });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=employee_template.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

// 직원 명단 엑셀 다운로드 (직원 관리 화면의 상태 필터(전체/재직자/퇴직자)를 그대로 반영합니다)
router.get("/employees/export", async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status === "active") query.active = true;
    else if (status === "inactive") query.active = false;
    const list = await Employee.find(query).sort({ department: 1, name: 1 }).lean();

    const roleLabel = (role) => (role === "admin" ? "관리자" : role === "manager" ? "운영자" : "일반직원");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("직원 목록");
    ws.columns = [
      { header: "사번", key: "employeeId", width: 14 },
      { header: "이름", key: "name", width: 14 },
      { header: "부서", key: "department", width: 20 },
      { header: "권한", key: "role", width: 12 },
      { header: "구분", key: "employeeType", width: 10 },
      { header: "총원(TO)", key: "totalHeadcount", width: 10 },
      { header: "담당 부서(운영자)", key: "managedDepartments", width: 24 },
      { header: "재직여부", key: "active", width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    list.forEach((e) => {
      ws.addRow({
        employeeId: e.employeeId,
        name: e.name,
        department: e.department,
        role: roleLabel(e.role),
        employeeType: e.employeeType === "contractor" ? "도급" : "개인",
        totalHeadcount: e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) ? e.totalHeadcount : "",
        managedDepartments: e.role === "manager" && Array.isArray(e.managedDepartments) ? e.managedDepartments.join(", ") : "",
        active: e.active ? "재직" : "퇴직",
      });
    });
    ws.addRow({});
    ws.addRow({ employeeId: "합계", name: `${list.length}명` });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=employee_list_${todayKSTStr()}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
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
      const typeRaw = String(row["구분(개인/도급)"] ?? row["구분"] ?? row["employeeType"] ?? "").trim();
      const employeeType = typeRaw.includes("도급") || typeRaw.toLowerCase() === "contractor" ? "contractor" : "individual";
      const totalHeadcount = parseTotalHeadcount(
        row["총원(TO, 도급만)"] ?? row["총원(TO)"] ?? row["totalHeadcount"],
        employeeType
      );
      if (!employeeId || !name) {
        errors.push(`${idx + 2}행: 사번 또는 이름이 비어있어 건너뛰었습니다.`);
        continue;
      }
      const existing = await Employee.findOne({ employeeId });
      if (existing) {
        existing.name = name;
        existing.department = department;
        existing.employeeType = employeeType;
        existing.totalHeadcount = totalHeadcount;
        existing.active = true;
        await existing.save();
        updated++;
      } else {
        await Employee.create({ employeeId, name, department, role: "user", employeeType, totalHeadcount, active: true });
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

// 특정 날짜의 "미신청 인원"을 계산합니다.
// - 개인 직원: 해당 끼니에 신청 기록이 없으면 1명으로 계산합니다.
// - 도급회사(단체) 직원: 총원(TO)이 설정되어 있으면 (TO - 신청 인원수)만큼을 미신청 인원으로 계산합니다.
//   TO가 설정되지 않은 도급 계정은 개인 직원과 동일하게(신청 안 하면 1명) 계산합니다.
// 마스터 관리자 계정(MASTER_ADMIN_ID)만 이 시스템으로 직접 식사를 신청하지 않으므로,
// 등록 인원/미신청 인원 집계에서 그 계정만 제외합니다. 다른 직원에게 부여된 관리자 권한(role=admin)은
// 일반 직원과 동일하게 인원 집계와 식사 신청에 포함됩니다.
async function computePendingSummary(date) {
  const employees = await Employee.find({ active: true, employeeId: { $ne: MASTER_ADMIN_ID } }).sort({ department: 1, name: 1 }).lean();
  const applied = await Reservation.find({ date, status: "applied" }).lean();
  const appliedLunchMap = new Map();
  const appliedDinnerMap = new Map();
  for (const r of applied) {
    const map = r.mealType === "lunch" ? appliedLunchMap : appliedDinnerMap;
    map.set(r.employeeId, r.headcount ?? 1);
  }

  function build(map) {
    const list = [];
    let count = 0;
    for (const e of employees) {
      const appliedHeadcount = map.get(e.employeeId);
      if (e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) && e.totalHeadcount >= 0) {
        const applied = appliedHeadcount ?? 0;
        const shortfall = e.totalHeadcount - applied;
        if (shortfall > 0) {
          list.push({ ...e, appliedHeadcount: applied, shortfall });
          count += shortfall;
        }
      } else if (appliedHeadcount === undefined) {
        list.push({ ...e, appliedHeadcount: 0, shortfall: 1 });
        count += 1;
      }
    }
    return { list, count };
  }

  const lunch = build(appliedLunchMap);
  const dinner = build(appliedDinnerMap);
  return {
    totalEmployees: employees.length,
    pendingLunch: lunch.list,
    pendingDinner: dinner.list,
    pendingLunchCount: lunch.count,
    pendingDinnerCount: dinner.count,
  };
}

// 특정 날짜에 아직 신청하지 않은 재직 직원 목록 (중식/석식 각각)
router.get("/reservations/pending", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const summary = await computePendingSummary(date);
  res.json({ date, ...summary });
});

// 관리자 강제 변경 (마감시간/당일취소 제한을 무시하고 신청 또는 취소 처리)
router.put("/reservations/override", async (req, res) => {
  try {
    const { date, mealType, status, headcount, guestCount } = req.body;
    const employeeId = typeof req.body.employeeId === "string" ? req.body.employeeId.trim() : "";
    if (!employeeId || !DATE_RE.test(date || "") || !["lunch", "dinner"].includes(mealType) || !["applied", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const emp = await Employee.findOne({ employeeId });
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });

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

/* ---------------------------- 집계 ---------------------------- */

// 신청 내역(rows)을 개인 직원 / 도급직원 / 내방객(손님)으로 나누어 인원수를 합산합니다.
// Reservation에는 구분(employeeType)이 저장되어 있지 않아 Employee 컬렉션을 조회해 판별하며,
// 이미 삭제되었거나 찾을 수 없는 사번은 개인 직원으로 취급합니다.
// 내방객(guestCount)은 신청자 본인과 별도로 함께 식사하는 손님 인원으로, 개인/도급 인원과 구분해서 집계하되
// 실제 조리해야 할 전체 식수(total)에는 포함합니다.
async function splitByEmployeeType(rows) {
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const emps = ids.length ? await Employee.find({ employeeId: { $in: ids } }, { employeeId: 1, employeeType: 1 }).lean() : [];
  const typeMap = new Map(emps.map((e) => [e.employeeId, e.employeeType]));
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

router.get("/summary/daily", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const rows = await Reservation.find({ date, status: "applied" }).lean();
  const lunch = rows.filter((r) => r.mealType === "lunch");
  const dinner = rows.filter((r) => r.mealType === "dinner");
  const [lunchSplit, dinnerSplit, pending, customHoliday] = await Promise.all([
    splitByEmployeeType(lunch),
    splitByEmployeeType(dinner),
    computePendingSummary(date),
    Holiday.findOne({ date }).lean(),
  ]);
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
    const n = (r.headcount ?? 1) + (r.guestCount ?? 0);
    byDate[r.date][r.mealType === "lunch" ? "lunchCount" : "dinnerCount"] += n;
  }
  // 월간 표에서도 주말/공휴일을 빨간색으로 구분해서 보여주기 위한 정보입니다.
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
  const [lunchSplit, dinnerSplit] = await Promise.all([splitByEmployeeType(lunchRows), splitByEmployeeType(dinnerRows)]);
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
  });
});

/* ---------------------------- 만족도 조사 (관리자 전용) ----------------------------
   식사를 신청한 직원이 정해진 시간대(중식 12:00~13:00 / 석식 17:00~18:00)에 남긴 별점(1~5개, 20~100점) +
   이유(사유)를 부서별로 집계해서 보여줍니다. 이 화면은 관리자 화면에서만 접근 가능합니다(운영자 화면 없음). */

// 부서별로 응답 인원 / 평균 점수 / 별점 분포(1~5개씩 몇 명)를 중식·석식 각각 계산합니다.
function aggregateRatingsByDepartment(ratings) {
  const emptyMeal = () => ({ count: 0, sumScore: 0, star1: 0, star2: 0, star3: 0, star4: 0, star5: 0 });
  const map = new Map();
  for (const r of ratings) {
    const dept = r.department || "(부서 없음)";
    if (!map.has(dept)) map.set(dept, { department: dept, lunch: emptyMeal(), dinner: emptyMeal() });
    const entry = map.get(dept)[r.mealType];
    if (!entry) continue;
    entry.count += 1;
    entry.sumScore += r.score;
    entry[`star${r.stars}`] += 1;
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  const list = [...map.values()].map((e) => ({
    department: e.department,
    lunch: { ...e.lunch, avgScore: e.lunch.count ? round1(e.lunch.sumScore / e.lunch.count) : null },
    dinner: { ...e.dinner, avgScore: e.dinner.count ? round1(e.dinner.sumScore / e.dinner.count) : null },
  }));
  list.sort((a, b) => a.department.localeCompare(b.department, "ko"));
  return list;
}

function ratingOverallStats(ratings, mealType) {
  const list = mealType ? ratings.filter((r) => r.mealType === mealType) : ratings;
  const count = list.length;
  const sumScore = list.reduce((s, r) => s + r.score, 0);
  return { count, avgScore: count ? Math.round((sumScore / count) * 10) / 10 : null };
}

// 특정 날짜의 개별 평가 목록(이유 포함) + 부서별 집계를 함께 내려줍니다.
router.get("/ratings", async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
  const ratings = await MealRating.find({ date }).sort({ department: 1, employeeName: 1 }).lean();
  res.json({
    date,
    ratings,
    byDepartment: aggregateRatingsByDepartment(ratings),
    lunchOverall: ratingOverallStats(ratings, "lunch"),
    dinnerOverall: ratingOverallStats(ratings, "dinner"),
  });
});

// 한 달 치 부서별 집계 (개별 평가/이유는 목록이 너무 많아질 수 있어 월간 화면에서는 집계만 제공합니다)
router.get("/ratings/summary/monthly", async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다 (YYYY-MM)." });
  const [year, mon] = month.split("-").map(Number);
  const dates = getMonthDates(year, mon);
  const ratings = await MealRating.find({ date: { $in: dates } }).lean();
  res.json({
    month,
    byDepartment: aggregateRatingsByDepartment(ratings),
    lunchOverall: ratingOverallStats(ratings, "lunch"),
    dinnerOverall: ratingOverallStats(ratings, "dinner"),
  });
});

router.get("/ratings/export/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다." });
    const ratings = await MealRating.find({ date }).sort({ mealType: 1, department: 1, employeeName: 1 }).lean();
    const byDept = aggregateRatingsByDepartment(ratings);
    const mealLabel = (m) => (m === "lunch" ? "중식" : "석식");

    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("부서별 집계");
    summary.columns = [
      { header: "부서", key: "department", width: 20 },
      { header: "중식 응답인원", key: "lunchCount", width: 14 },
      { header: "중식 평균점수", key: "lunchAvg", width: 14 },
      { header: "석식 응답인원", key: "dinnerCount", width: 14 },
      { header: "석식 평균점수", key: "dinnerAvg", width: 14 },
    ];
    summary.getRow(1).font = { bold: true };
    byDept.forEach((d) => {
      summary.addRow({
        department: d.department,
        lunchCount: d.lunch.count,
        lunchAvg: d.lunch.avgScore ?? "",
        dinnerCount: d.dinner.count,
        dinnerAvg: d.dinner.avgScore ?? "",
      });
    });
    const lunchOverall = ratingOverallStats(ratings, "lunch");
    const dinnerOverall = ratingOverallStats(ratings, "dinner");
    summary.addRow({});
    summary.addRow({
      department: "전체",
      lunchCount: lunchOverall.count,
      lunchAvg: lunchOverall.avgScore ?? "",
      dinnerCount: dinnerOverall.count,
      dinnerAvg: dinnerOverall.avgScore ?? "",
    });

    const detail = wb.addWorksheet("개별 평가 상세");
    detail.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 8 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "별점", key: "stars", width: 8 },
      { header: "점수", key: "score", width: 8 },
      { header: "이유", key: "reason", width: 40 },
    ];
    detail.getRow(1).font = { bold: true };
    ratings.forEach((r) => {
      detail.addRow({
        date: r.date,
        mealType: mealLabel(r.mealType),
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        department: r.department,
        stars: r.stars,
        score: r.score,
        reason: r.reason,
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=satisfaction_${date}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
});

router.get("/ratings/export/monthly", async (req, res) => {
  try {
    const { month } = req.query;
    if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다." });
    const [year, mon] = month.split("-").map(Number);
    const dates = getMonthDates(year, mon);
    const ratings = await MealRating.find({ date: { $in: dates } }).sort({ department: 1, date: 1 }).lean();
    const byDept = aggregateRatingsByDepartment(ratings);

    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("월간 부서별 집계");
    summary.columns = [
      { header: "부서", key: "department", width: 20 },
      { header: "중식 응답인원", key: "lunchCount", width: 14 },
      { header: "중식 평균점수", key: "lunchAvg", width: 14 },
      { header: "석식 응답인원", key: "dinnerCount", width: 14 },
      { header: "석식 평균점수", key: "dinnerAvg", width: 14 },
    ];
    summary.getRow(1).font = { bold: true };
    byDept.forEach((d) => {
      summary.addRow({
        department: d.department,
        lunchCount: d.lunch.count,
        lunchAvg: d.lunch.avgScore ?? "",
        dinnerCount: d.dinner.count,
        dinnerAvg: d.dinner.avgScore ?? "",
      });
    });
    const lunchOverall = ratingOverallStats(ratings, "lunch");
    const dinnerOverall = ratingOverallStats(ratings, "dinner");
    summary.addRow({});
    summary.addRow({
      department: "전체",
      lunchCount: lunchOverall.count,
      lunchAvg: lunchOverall.avgScore ?? "",
      dinnerCount: dinnerOverall.count,
      dinnerAvg: dinnerOverall.avgScore ?? "",
    });

    const detail = wb.addWorksheet("일자별 상세");
    detail.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "구분", key: "mealType", width: 8 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "별점", key: "stars", width: 8 },
      { header: "점수", key: "score", width: 8 },
      { header: "이유", key: "reason", width: 40 },
    ];
    detail.getRow(1).font = { bold: true };
    ratings.forEach((r) => {
      detail.addRow({
        date: r.date,
        mealType: r.mealType === "lunch" ? "중식" : "석식",
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        department: r.department,
        stars: r.stars,
        score: r.score,
        reason: r.reason,
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=satisfaction_${month}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
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

    // 요약 시트: 일자별 집계 (내방객 포함 전체 식수)
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
    let totalLunch = 0;
    let totalLunchGuest = 0;
    let totalDinner = 0;
    let totalDinnerGuest = 0;
    for (const d of dates) {
      summary.addRow({ date: d, lunch: byDate[d].lunch, lunchGuest: byDate[d].lunchGuest, dinner: byDate[d].dinner, dinnerGuest: byDate[d].dinnerGuest });
      totalLunch += byDate[d].lunch;
      totalLunchGuest += byDate[d].lunchGuest;
      totalDinner += byDate[d].dinner;
      totalDinnerGuest += byDate[d].dinnerGuest;
    }
    summary.addRow({});
    summary.addRow({ date: "합계", lunch: totalLunch, lunchGuest: totalLunchGuest, dinner: totalDinner, dinnerGuest: totalDinnerGuest });

    // 상세 시트: 전체 신청 내역
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

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=meal_${month}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
});

/* ---------------------------- 설정 (마감시간) ---------------------------- */

router.get("/settings", async (req, res) => {
  let s = await Settings.findOne({ key: "global" });
  if (!s) {
    s = await Settings.create({
      key: "global",
      lunchDeadlineHour: LUNCH_DEADLINE_HOUR,
      lunchDeadlineMinute: LUNCH_DEADLINE_MINUTE,
      dinnerDeadlineHour: DINNER_DEADLINE_HOUR,
      dinnerDeadlineMinute: DINNER_DEADLINE_MINUTE,
    });
  }
  res.json({ settings: s });
});

router.put("/settings", async (req, res) => {
  const lunchHour = parseInt(req.body.lunchDeadlineHour, 10);
  const lunchMinute = parseInt(req.body.lunchDeadlineMinute, 10);
  const dinnerHour = parseInt(req.body.dinnerDeadlineHour, 10);
  const dinnerMinute = parseInt(req.body.dinnerDeadlineMinute, 10);
  const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  const validMinute = (m) => Number.isInteger(m) && m >= 0 && m <= 59;
  if (!validHour(lunchHour) || !validMinute(lunchMinute) || !validHour(dinnerHour) || !validMinute(dinnerMinute)) {
    return res.status(400).json({ error: "올바른 시(0~23)와 분(0~59)을 중식/석식 모두 입력해주세요." });
  }
  const s = await Settings.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        lunchDeadlineHour: lunchHour,
        lunchDeadlineMinute: lunchMinute,
        dinnerDeadlineHour: dinnerHour,
        dinnerDeadlineMinute: dinnerMinute,
      },
    },
    { upsert: true, new: true }
  );
  res.json({ settings: s });
});

/* ---------------------------- 공휴일 관리 ---------------------------- */
// 신정/삼일절 등 매년 날짜가 고정된 양력 공휴일은 자동으로 빨간색으로 표시되며 별도 등록이 필요 없습니다.
// 설날/추석 연휴처럼 해마다 날짜가 바뀌는 공휴일이나 대체공휴일·임시공휴일만 이 화면에서 등록하면 됩니다.

router.get("/holidays", async (req, res) => {
  const list = await Holiday.find({}).sort({ date: 1 }).lean();
  res.json({ holidays: list, fixedHolidays: FIXED_HOLIDAYS_MMDD });
});

router.post("/holidays", async (req, res) => {
  try {
    const { date, label } = req.body;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "날짜는 YYYY-MM-DD 형식으로 입력해주세요." });
    const h = await Holiday.findOneAndUpdate(
      { date },
      { $set: { date, label: label ? String(label).trim().slice(0, 60) : "" } },
      { upsert: true, new: true }
    );
    res.json({ holiday: h });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "공휴일 등록 중 오류가 발생했습니다." });
  }
});

router.delete("/holidays/:id", async (req, res) => {
  const h = await Holiday.findByIdAndDelete(req.params.id);
  if (!h) return res.status(404).json({ error: "공휴일을 찾을 수 없습니다." });
  res.json({ ok: true });
});

/* ---------------------------- 공지사항 관리 ---------------------------- */

router.get("/announcements", async (req, res) => {
  const list = await Announcement.find({}).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ announcements: list });
});

// 새 공지 게시 (기존에 활성화된 공지가 있으면 자동으로 종료 처리)
router.post("/announcements", async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "공지 내용을 입력해주세요." });
  await Announcement.updateMany({ active: true }, { $set: { active: false } });
  const a = await Announcement.create({ message: message.trim(), active: true });
  res.json({ announcement: a });
});

router.put("/announcements/:id/deactivate", async (req, res) => {
  const a = await Announcement.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
  if (!a) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
  res.json({ announcement: a });
});

// 공지 게시글을 완전히 삭제합니다 (종료와 달리 목록에서도 사라집니다).
router.delete("/announcements/:id", async (req, res) => {
  const a = await Announcement.findByIdAndDelete(req.params.id);
  if (!a) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
  res.json({ ok: true });
});

/* ---------------------------- 데이터 백업 ---------------------------- */

// 전체 데이터(직원, 신청내역, 설정, 공지)를 JSON 파일로 내려받습니다.
// 관리자가 직접 PC에 보관해두는 백업용이며, 필요 시 개발자가 복원할 때 참고할 수 있습니다.
router.get("/backup", async (req, res) => {
  try {
    const [employees, reservations, settings, announcements] = await Promise.all([
      Employee.find({}).lean(),
      Reservation.find({}).lean(),
      Settings.findOne({ key: "global" }).lean(),
      Announcement.find({}).lean(),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      employees,
      reservations,
      settings,
      announcements,
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=meal_app_backup_${todayKSTStr()}.json`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "백업 생성 중 오류가 발생했습니다." });
  }
});

module.exports = router;
