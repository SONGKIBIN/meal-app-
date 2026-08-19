const express = require("express");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const BusDefaultRide = require("../models/BusDefaultRide");
const BusDrivingLog = require("../models/BusDrivingLog");
const { requireAuth, requireBusDriver } = require("../middleware/auth");
const { getWeekDates, getMonthDates } = require("../utils/dateUtil");
const { TRIP_TYPES, resolveOperationMap, isDefaultOperatingDayBulk } = require("../utils/busOperation");
const { computeRiders } = require("../utils/busRiders");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TRIP_LABEL = { commute: "출근운행", regularLeave: "정시퇴근운행", extendedLeave: "연장퇴근운행" };

router.use(requireAuth, requireBusDriver);

// 기사 본인 차량의 오늘(또는 지정 날짜) 운행 정보 + 다른 모든 차량의 운행여부/탑승자 명단(전체 기사 공통 열람)을 함께 내려줍니다.
router.get("/today", async (req, res) => {
  try {
    const date = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const vehicles = await Vehicle.find({ active: true }).populate("routeId").sort({ name: 1 }).lean();
    const vehicleIds = vehicles.map((v) => String(v._id));

    const { map: opMap } = await resolveOperationMap(date, vehicleIds);
    const isDefaultDay = (await isDefaultOperatingDayBulk([date]))[date];
    const allDefaults = vehicleIds.length ? await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [];
    const explicitForDate = vehicleIds.length ? await BusRide.find({ date, vehicleId: { $in: vehicleIds } }).lean() : [];
    const logs = await BusDrivingLog.find({ date, vehicleId: { $in: vehicleIds } }).lean();
    const logMap = new Map(logs.map((l) => [`${String(l.vehicleId)}_${l.tripType}`, l]));

    const buildVehicle = (v) => {
      const vId = String(v._id);
      return {
        vehicleId: vId,
        name: v.name,
        routeName: v.routeId ? v.routeId.name : "",
        isMine: v.driverEmployeeId === req.user.employeeId,
        trips: TRIP_TYPES.map((tripType) => {
          const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
          const riders = (ridersByVehicle[vId] || []).slice().sort((a, b) => (a.department || "").localeCompare(b.department || "") || (a.employeeName || "").localeCompare(b.employeeName || ""));
          const log = logMap.get(`${vId}_${tripType}`);
          return {
            tripType,
            label: TRIP_LABEL[tripType],
            enabled: opMap[vId] ? opMap[vId][tripType].enabled : false,
            appliedHeadcount: riders.reduce((sum, r) => sum + (r.headcount || 1), 0),
            riders,
            operated: log ? log.operated : null,
            actualHeadcount: log ? log.actualHeadcount : null,
            note: log ? log.note : "",
          };
        }),
      };
    };

    const myVehicle = vehicles.find((v) => v.driverEmployeeId === req.user.employeeId);

    res.json({
      date,
      myVehicle: myVehicle ? buildVehicle(myVehicle) : null,
      vehicles: vehicles.map(buildVehicle),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 주간단위 운행명령: 이번 주(월~일) 각 차량 x 운행구분별 운행 여부와 탑승자 명단(사번/부서/이름)을
// 읽기 전용으로 보여줍니다. (운행 여부/신청 취소 지정 자체는 통근 차량 관리 관리자/마스터만 가능 - 기사는 확인만 가능)
router.get("/week-operation", async (req, res) => {
  try {
    const anchor = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const week = getWeekDates(anchor);
    const vehicles = await Vehicle.find({ active: true }).populate("routeId").sort({ name: 1 }).lean();
    const vehicleIds = vehicles.map((v) => String(v._id));

    const defaultDayMap = await isDefaultOperatingDayBulk(week);
    const allDefaults = vehicleIds.length ? await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [];
    const weekExplicit = vehicleIds.length ? await BusRide.find({ date: { $in: week }, vehicleId: { $in: vehicleIds } }).lean() : [];

    const days = [];
    for (const date of week) {
      const { map: opMap } = await resolveOperationMap(date, vehicleIds);
      const isDefaultDay = !!defaultDayMap[date];
      const explicitForDate = weekExplicit.filter((r) => r.date === date);
      days.push({
        date,
        vehicles: vehicles.map((v) => {
          const vId = String(v._id);
          return {
            vehicleId: vId,
            name: v.name,
            routeName: v.routeId ? v.routeId.name : "",
            trips: TRIP_TYPES.map((tripType) => {
              const enabled = opMap[vId] ? opMap[vId][tripType].enabled : false;
              const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
              const riders = (ridersByVehicle[vId] || []).slice().sort((a, b) => (a.department || "").localeCompare(b.department || "") || (a.employeeName || "").localeCompare(b.employeeName || ""));
              return {
                tripType,
                label: TRIP_LABEL[tripType],
                enabled,
                appliedHeadcount: riders.reduce((sum, r) => sum + (r.headcount || 1), 0),
                riders,
              };
            }),
          };
        }),
      });
    }
    res.json({ week, days });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 월별집계: 이번 달 각 차량의 날짜별 탑승 인원수(기본 등록 + 명시 신청 합산)를 보여줍니다.
router.get("/summary/monthly", async (req, res) => {
  try {
    const { month } = req.query;
    if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 파라미터가 필요합니다 (YYYY-MM)." });
    const [year, mon] = month.split("-").map(Number);
    const dates = getMonthDates(year, mon);
    const vehicles = await Vehicle.find({ active: true }).populate("routeId").sort({ name: 1 }).lean();
    const vehicleIds = vehicles.map((v) => String(v._id));
    const defaultDayMap = await isDefaultOperatingDayBulk(dates);
    const allDefaults = vehicleIds.length ? await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [];
    const monthExplicit = vehicleIds.length ? await BusRide.find({ date: { $in: dates }, vehicleId: { $in: vehicleIds } }).lean() : [];

    const perVehicleDaily = {};
    vehicleIds.forEach((id) => (perVehicleDaily[id] = dates.map((d) => ({ date: d, commute: 0, regularLeave: 0, extendedLeave: 0 }))));

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const { map: opMap } = await resolveOperationMap(date, vehicleIds);
      const isDefaultDay = !!defaultDayMap[date];
      const explicitForDate = monthExplicit.filter((r) => r.date === date);
      for (const tripType of TRIP_TYPES) {
        const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
        for (const vId of vehicleIds) {
          perVehicleDaily[vId][i][tripType] = (ridersByVehicle[vId] || []).reduce((sum, r) => sum + (r.headcount || 1), 0);
        }
      }
    }

    res.json({
      month,
      dates,
      vehicles: vehicles.map((v) => {
        const vId = String(v._id);
        const daily = perVehicleDaily[vId];
        const totals = { commute: 0, regularLeave: 0, extendedLeave: 0 };
        daily.forEach((d) => {
          totals.commute += d.commute;
          totals.regularLeave += d.regularLeave;
          totals.extendedLeave += d.extendedLeave;
        });
        return { vehicleId: vId, name: v.name, routeName: v.routeId ? v.routeId.name : "", daily, totals };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 운행 일지 등록/수정. 본인이 배정된 차량만 기록할 수 있습니다 (마스터 관리자는 예외적으로 모든 차량 기록 가능).
router.post("/log", async (req, res) => {
  try {
    const { date, tripType, vehicleId, operated, actualHeadcount, note } = req.body;
    if (!DATE_RE.test(date || "") || !TRIP_TYPES.includes(tripType) || !vehicleId) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const vehicle = await Vehicle.findById(vehicleId).lean();
    if (!vehicle) return res.status(400).json({ error: "존재하지 않는 차량입니다." });
    if (!req.user.isMasterAdmin && vehicle.driverEmployeeId !== req.user.employeeId) {
      return res.status(403).json({ error: "본인이 배정된 차량만 운행 일지를 기록할 수 있습니다." });
    }
    const n = actualHeadcount === undefined || actualHeadcount === null || actualHeadcount === "" ? null : parseInt(actualHeadcount, 10);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 9999)) {
      return res.status(400).json({ error: "실제 탑승 인원은 0 이상의 숫자로 입력해주세요." });
    }
    const doc = await BusDrivingLog.findOneAndUpdate(
      { date, tripType, vehicleId },
      {
        $set: {
          driverEmployeeId: req.user.employeeId,
          driverName: req.user.name,
          operated: typeof operated === "boolean" ? operated : null,
          actualHeadcount: n,
          note: typeof note === "string" ? note.trim().slice(0, 200) : "",
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true, log: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
