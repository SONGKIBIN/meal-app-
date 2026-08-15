const express = require("express");
const ExcelJS = require("exceljs");
const BusRoute = require("../models/BusRoute");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const BusDefaultRide = require("../models/BusDefaultRide");
const BusOperationDay = require("../models/BusOperationDay");
const BusDrivingLog = require("../models/BusDrivingLog");
const { requireAuth, requireBusAdmin, attachVehicleScope } = require("../middleware/auth");
const { getMonthDates } = require("../utils/dateUtil");
const { TRIP_TYPES, AUTO_DEFAULT_TRIP_TYPES, resolveOperationMap, isDefaultOperatingDayBulk } = require("../utils/busOperation");
const { computeRiders } = require("../utils/busRiders");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TRIP_LABEL = { commute: "출근운행", regularLeave: "정시퇴근운행", extendedLeave: "연장퇴근운행" };

router.use(requireAuth, requireBusAdmin, attachVehicleScope);

function inScope(req, vehicleId) {
  return req.vehicleScope === null || req.vehicleScope.includes(String(vehicleId));
}

async function scopedVehicles(req, filter = {}) {
  const q = { ...filter };
  if (req.vehicleScope !== null) q._id = { $in: req.vehicleScope };
  return Vehicle.find(q).populate("routeId").sort({ name: 1 }).lean();
}

/* ---------------------------- 코스(노선) 관리 ---------------------------- */

router.get("/routes", async (req, res) => {
  try {
    const routes = await BusRoute.find({}).sort({ order: 1, name: 1 }).lean();
    res.json({ routes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/routes", async (req, res) => {
  try {
    const { name, stops, order } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "코스 이름을 입력해주세요." });
    const stopList = Array.isArray(stops) ? stops.map((s) => String(s).trim()).filter(Boolean) : [];
    const route = await BusRoute.create({ name: String(name).trim(), stops: stopList, order: Number(order) || 0 });
    res.json({ ok: true, route });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "이미 존재하는 코스 이름입니다." });
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.put("/routes/:id", async (req, res) => {
  try {
    const { name, stops, order, active } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (stops !== undefined) update.stops = Array.isArray(stops) ? stops.map((s) => String(s).trim()).filter(Boolean) : [];
    if (order !== undefined) update.order = Number(order) || 0;
    if (active !== undefined) update.active = !!active;
    const route = await BusRoute.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!route) return res.status(404).json({ error: "코스를 찾을 수 없습니다." });
    res.json({ ok: true, route });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.delete("/routes/:id", async (req, res) => {
  try {
    const inUse = await Vehicle.exists({ routeId: req.params.id, active: true });
    if (inUse) return res.status(400).json({ error: "이 코스를 사용 중인 차량이 있어 삭제할 수 없습니다. 먼저 차량을 정리해주세요." });
    await BusRoute.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

/* ---------------------------- 차량 관리 ---------------------------- */

router.get("/vehicles", async (req, res) => {
  try {
    const vehicles = await scopedVehicles(req);
    res.json({
      vehicles: vehicles.map((v) => ({
        _id: v._id,
        name: v.name,
        active: v.active,
        capacity: v.capacity,
        driverEmployeeId: v.driverEmployeeId,
        routeId: v.routeId ? v.routeId._id : null,
        routeName: v.routeId ? v.routeId.name : "",
        stops: v.routeId ? v.routeId.stops : [],
      })),
      allVehicles: req.vehicleScope === null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/vehicles", async (req, res) => {
  try {
    const { name, routeId, capacity } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "차량 이름을 입력해주세요." });
    const route = await BusRoute.findById(routeId).lean();
    if (!route) return res.status(400).json({ error: "존재하지 않는 코스입니다." });
    const vehicle = await Vehicle.create({
      name: String(name).trim(),
      routeId,
      capacity: Number.isInteger(Number(capacity)) ? Number(capacity) : null,
    });
    res.json({ ok: true, vehicle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.put("/vehicles/:id", async (req, res) => {
  try {
    if (!inScope(req, req.params.id)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
    const { name, routeId, capacity, active } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (routeId !== undefined) {
      const route = await BusRoute.findById(routeId).lean();
      if (!route) return res.status(400).json({ error: "존재하지 않는 코스입니다." });
      update.routeId = routeId;
    }
    if (capacity !== undefined) update.capacity = Number.isInteger(Number(capacity)) ? Number(capacity) : null;
    if (active !== undefined) update.active = !!active;
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!vehicle) return res.status(404).json({ error: "차량을 찾을 수 없습니다." });
    res.json({ ok: true, vehicle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.delete("/vehicles/:id", async (req, res) => {
  try {
    if (!inScope(req, req.params.id)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
    await Vehicle.findByIdAndUpdate(req.params.id, { $set: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

/* ---------------------------- 날짜별 운행 여부 지정 ---------------------------- */
// 모든 날짜는 기본적으로 운행하는 것으로 처리되며, 여기서 특정 날짜/차량/운행구분만 명시적으로 꺼서(취소해서) 예외로 관리합니다.

router.get("/operation", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
    const vehicles = await scopedVehicles(req, { active: true });
    const vehicleIds = vehicles.map((v) => String(v._id));
    const { defaultOn, map } = await resolveOperationMap(date, vehicleIds);
    res.json({
      date,
      defaultOn,
      vehicles: vehicles.map((v) => ({
        vehicleId: String(v._id),
        name: v.name,
        routeName: v.routeId ? v.routeId.name : "",
        trips: TRIP_TYPES.map((tripType) => ({ tripType, label: TRIP_LABEL[tripType], ...map[String(v._id)][tripType] })),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/operation", async (req, res) => {
  try {
    const { date, tripType, vehicleId, enabled, note } = req.body;
    if (!DATE_RE.test(date || "") || !TRIP_TYPES.includes(tripType) || !vehicleId) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    if (!inScope(req, vehicleId)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
    const doc = await BusOperationDay.findOneAndUpdate(
      { date, tripType, vehicleId },
      { $set: { enabled: !!enabled, note: typeof note === "string" ? note.trim().slice(0, 200) : "" } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, operation: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 지정을 지우고 기본값(운행함)으로 되돌립니다.
router.delete("/operation", async (req, res) => {
  try {
    const { date, tripType, vehicleId } = req.body;
    if (!DATE_RE.test(date || "") || !TRIP_TYPES.includes(tripType) || !vehicleId) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    if (!inScope(req, vehicleId)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
    await BusOperationDay.deleteOne({ date, tripType, vehicleId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 관리자가 특정 직원의 승차를 대신 취소합니다 (담당 차량 범위 내에서만 가능).
// rideId가 있으면 그날 명시적으로 신청된 건을 취소하고, 없으면(기본 등록에 의한 자동 탑승자)
// employeeId/date/tripType으로 "그날만 취소" 예외 기록을 새로 남깁니다(기본 등록 자체는 유지됨).
router.delete("/ride", async (req, res) => {
  try {
    const { rideId, employeeId, date, tripType, vehicleId } = req.body;
    if (rideId) {
      const ride = await BusRide.findById(rideId);
      if (!ride) return res.status(404).json({ error: "신청 내역을 찾을 수 없습니다." });
      if (!inScope(req, ride.vehicleId)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
      ride.status = "cancelled";
      ride.headcount = 0;
      await ride.save();
      return res.json({ ok: true });
    }

    if (!employeeId || !DATE_RE.test(date || "") || !TRIP_TYPES.includes(tripType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    // 명시적으로 신청된 내역이 있다면(정시퇴근/연장퇴근처럼 자동 탑승 대상이 아닌 운행구분은 항상 이
    // 경우입니다) 기본 등록 여부와 상관없이 그 신청부터 취소합니다.
    const existing = await BusRide.findOne({ employeeId, date, tripType });
    if (existing) {
      if (!inScope(req, existing.vehicleId)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
      if (vehicleId && String(existing.vehicleId) !== String(vehicleId)) {
        return res.status(400).json({ error: "탑승 내역을 찾을 수 없습니다." });
      }
      existing.status = "cancelled";
      existing.headcount = 0;
      await existing.save();
      return res.json({ ok: true });
    }

    // 명시적 신청이 없다면, 자동 탑승 대상 운행구분(현재는 출근만)의 기본 등록에 의한 자동 탑승자인지
    // 확인합니다. 그 외에는 애초에 취소할 내역이 없습니다.
    const isDefaultDay = AUTO_DEFAULT_TRIP_TYPES.includes(tripType) && (await isDefaultOperatingDayBulk([date]))[date];
    const def = isDefaultDay ? await BusDefaultRide.findOne({ employeeId, tripType }).lean() : null;
    if (!def) return res.status(404).json({ error: "탑승 내역을 찾을 수 없습니다." });
    if (!inScope(req, def.vehicleId)) return res.status(403).json({ error: "담당 차량이 아닙니다." });
    if (vehicleId && String(def.vehicleId) !== String(vehicleId)) {
      return res.status(400).json({ error: "탑승 내역을 찾을 수 없습니다." });
    }
    await BusRide.create({
      employeeId,
      employeeName: def.employeeName,
      department: def.department,
      date,
      tripType,
      vehicleId: def.vehicleId,
      routeId: def.routeId,
      routeName: def.routeName,
      vehicleName: def.vehicleName,
      stop: def.stop,
      status: "cancelled",
      headcount: 0,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

/* ---------------------------- 일일/월간 인원 집계 ---------------------------- */

async function dailyRiders(req, date) {
  const vehicles = await scopedVehicles(req, { active: true });
  const vehicleIds = vehicles.map((v) => String(v._id));
  const isDefaultDay = await isDefaultOperatingDayBulk([date]).then((m) => m[date]);
  const { map: opMap } = await resolveOperationMap(date, vehicleIds);
  const allDefaults = vehicleIds.length ? await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [];
  // 명시 신청/취소 기록은 담당 차량으로 미리 필터링하지 않고 그날 전체를 조회합니다. 직원이 담당 범위
  // 밖의 다른 차량으로 그날만 바꿔 탄 경우까지 알아야만, 담당 차량의 기본 등록자를 올바르게 제외할 수
  // 있기 때문입니다(그렇지 않으면 이미 다른 차량으로 옮겨 탄 사람이 원래 차량에 유령으로 남아 인원이
  // 부풀려집니다). 최종 출력은 computeRiders가 vehicleIds(담당 차량)로만 걸러줍니다.
  const explicitForDate = await BusRide.find({ date }).lean();

  const sortRiders = (list) => list.slice().sort((a, b) => (a.department || "").localeCompare(b.department || "") || (a.employeeName || "").localeCompare(b.employeeName || ""));

  const vehicleSummaries = vehicles.map((v) => {
    const vId = String(v._id);
    return {
      vehicleId: vId,
      name: v.name,
      routeName: v.routeId ? v.routeId.name : "",
      trips: TRIP_TYPES.map((tripType) => {
        const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
        const riders = sortRiders(ridersByVehicle[vId] || []);
        const count = riders.reduce((sum, r) => sum + (r.headcount || 1), 0);
        return { tripType, label: TRIP_LABEL[tripType], count, riders };
      }),
    };
  });
  return { vehicles: vehicleSummaries, isDefaultDay };
}

router.get("/summary/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
    const result = await dailyRiders(req, date);
    res.json({ date, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 특정 기간(월간 집계 등)의 날짜별 트립타입별 탑승 인원 합계를 계산합니다.
// 기본 등록에 의한 자동 탑승자 + 그날 명시적으로 신청한 사람을 모두 포함합니다.
async function monthlyDailyTotals(req, dates) {
  const vehicles = await scopedVehicles(req, { active: true });
  const vehicleIds = vehicles.map((v) => String(v._id));
  const defaultDayMap = await isDefaultOperatingDayBulk(dates);
  const allDefaults = vehicleIds.length ? await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [];
  // dailyRiders()와 동일한 이유로, 명시 신청/취소는 담당 차량으로 필터링하지 않고 기간 전체를 조회합니다.
  const monthExplicit = await BusRide.find({ date: { $in: dates } }).lean();

  const byDate = {};
  for (const date of dates) {
    byDate[date] = { date, commute: 0, regularLeave: 0, extendedLeave: 0 };
    const { map: opMap } = await resolveOperationMap(date, vehicleIds);
    const isDefaultDay = !!defaultDayMap[date];
    const explicitForDate = monthExplicit.filter((r) => r.date === date);
    for (const tripType of TRIP_TYPES) {
      const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
      let sum = 0;
      for (const vId of vehicleIds) sum += (ridersByVehicle[vId] || []).reduce((s, r) => s + (r.headcount || 1), 0);
      byDate[date][tripType] = sum;
    }
  }
  return byDate;
}

router.get("/summary/monthly", async (req, res) => {
  try {
    const { month } = req.query;
    if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다 (YYYY-MM)." });
    const [year, mon] = month.split("-").map(Number);
    const dates = getMonthDates(year, mon);
    const byDate = await monthlyDailyTotals(req, dates);

    const totals = { commute: 0, regularLeave: 0, extendedLeave: 0 };
    for (const d of dates) {
      totals.commute += byDate[d].commute;
      totals.regularLeave += byDate[d].regularLeave;
      totals.extendedLeave += byDate[d].extendedLeave;
    }
    res.json({ month, days: dates.map((d) => byDate[d]), totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/export/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다." });
    const { vehicles } = await dailyRiders(req, date);

    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("차량별 집계");
    summary.columns = [
      { header: "차량", key: "vehicle", width: 16 },
      { header: "코스", key: "route", width: 16 },
      { header: "출근운행", key: "commute", width: 12 },
      { header: "정시퇴근운행", key: "regularLeave", width: 14 },
      { header: "연장퇴근운행", key: "extendedLeave", width: 14 },
    ];
    summary.getRow(1).font = { bold: true };
    vehicles.forEach((v) => {
      const row = { vehicle: v.name, route: v.routeName };
      v.trips.forEach((t) => (row[t.tripType] = t.count));
      summary.addRow(row);
    });

    const detail = wb.addWorksheet("탑승자 명단");
    detail.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "운행구분", key: "tripType", width: 14 },
      { header: "차량", key: "vehicle", width: 14 },
      { header: "정류장", key: "stop", width: 12 },
      { header: "사번", key: "employeeId", width: 12 },
      { header: "이름", key: "employeeName", width: 14 },
      { header: "부서", key: "department", width: 18 },
      { header: "인원", key: "headcount", width: 8 },
      { header: "구분", key: "source", width: 10 },
    ];
    detail.getRow(1).font = { bold: true };
    vehicles.forEach((v) => {
      v.trips.forEach((t) => {
        t.riders.forEach((r) => {
          detail.addRow({
            date,
            tripType: TRIP_LABEL[t.tripType],
            vehicle: v.name,
            stop: r.stop,
            employeeId: r.employeeId,
            employeeName: r.employeeName,
            department: r.department,
            headcount: r.headcount,
            source: r.source === "default" ? "기본등록" : "신청",
          });
        });
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=bus_${date}.xlsx`);
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
    const byDate = await monthlyDailyTotals(req, dates);

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(`${month} 월간 집계`);
    sheet.columns = [
      { header: "날짜", key: "date", width: 12 },
      { header: "출근운행", key: "commute", width: 12 },
      { header: "정시퇴근운행", key: "regularLeave", width: 14 },
      { header: "연장퇴근운행", key: "extendedLeave", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    dates.forEach((d) => sheet.addRow(byDate[d]));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=bus_${month}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "엑셀 생성 중 오류가 발생했습니다." });
  }
});

/* ---------------------------- 운행 일지 조회 ---------------------------- */

router.get("/driving-log", async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)." });
    const vehicles = await scopedVehicles(req, { active: true });
    const vehicleIds = vehicles.map((v) => v._id);
    const logs = await BusDrivingLog.find({ date, vehicleId: { $in: vehicleIds } }).lean();
    const logMap = new Map(logs.map((l) => [`${String(l.vehicleId)}_${l.tripType}`, l]));
    res.json({
      date,
      vehicles: vehicles.map((v) => ({
        vehicleId: String(v._id),
        name: v.name,
        routeName: v.routeId ? v.routeId.name : "",
        trips: TRIP_TYPES.map((tripType) => {
          const log = logMap.get(`${String(v._id)}_${tripType}`);
          return {
            tripType,
            label: TRIP_LABEL[tripType],
            operated: log ? log.operated : null,
            actualHeadcount: log ? log.actualHeadcount : null,
            note: log ? log.note : "",
            driverName: log ? log.driverName : "",
            submittedAt: log ? log.submittedAt : null,
          };
        }),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
