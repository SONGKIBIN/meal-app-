const express = require("express");
const Settings = require("../models/Settings");
const BusRoute = require("../models/BusRoute");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const Holiday = require("../models/Holiday");
const { requireAuth } = require("../middleware/auth");
const { getWeekDates, fixedHolidayLabel, isWeekendDate } = require("../utils/dateUtil");
const { TRIP_TYPES, resolveOperationMap } = require("../utils/busOperation");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireAuth);

// 이 계정이 통근버스 메뉴를 볼 수 있는지 계산합니다. 전사 공개(busSystemEnabled) 전이라도
// 마스터 관리자/통근차량 관리 관리자/기사 본인은 미리 확인해볼 수 있습니다.
async function computeVisible(req) {
  if (req.user.isMasterAdmin || req.user.busAdmin || req.user.busDriver) return true;
  const s = await Settings.findOne({ key: "global" }).lean();
  return !!(s && s.busSystemEnabled);
}

router.get("/status", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    res.json({ visible });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/routes", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    if (!visible) return res.status(403).json({ error: "통근버스 기능이 아직 공개되지 않았습니다." });
    const routes = await BusRoute.find({ active: true }).sort({ order: 1, name: 1 }).lean();
    res.json({ routes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 주간(월~일) 승차 신청 현황: 날짜 x 운행구분(출근/정시퇴근/연장퇴근)별로 선택 가능한 차량과
// 본인 신청 여부를 함께 내려줍니다.
router.get("/week", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    if (!visible) return res.status(403).json({ error: "통근버스 기능이 아직 공개되지 않았습니다." });

    const anchor = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : undefined;
    const week = getWeekDates(anchor || new Date().toISOString().slice(0, 10));

    const vehicles = await Vehicle.find({ active: true }).populate("routeId").sort({ name: 1 }).lean();
    const vehicleList = vehicles
      .filter((v) => v.routeId) // 코스가 삭제된 차량은 제외
      .map((v) => ({
        vehicleId: String(v._id),
        name: v.name,
        routeId: String(v.routeId._id),
        routeName: v.routeId.name,
        stops: v.routeId.stops || [],
      }));
    const vehicleIds = vehicleList.map((v) => v.vehicleId);

    const customHolidays = await Holiday.find({ date: { $in: week } }).lean();
    const customHolidayMap = new Map(customHolidays.map((h) => [h.date, h.label || ""]));

    const myRides = await BusRide.find({ employeeId: req.user.employeeId, date: { $in: week }, status: "applied" }).lean();
    const myMap = new Map(myRides.map((r) => [`${r.date}_${r.tripType}`, r]));

    const allApplied = await BusRide.find({ date: { $in: week }, status: "applied" }).lean();
    const headcountMap = new Map(); // `${date}_${tripType}_${vehicleId}` -> sum
    for (const r of allApplied) {
      const key = `${r.date}_${r.tripType}_${String(r.vehicleId)}`;
      headcountMap.set(key, (headcountMap.get(key) || 0) + (r.headcount || 1));
    }

    const days = [];
    for (const date of week) {
      const { map: opMap } = await resolveOperationMap(date, vehicleIds);
      const customLabel = customHolidayMap.get(date);
      const fixedLabel = fixedHolidayLabel(date);
      const holidayLabel = customLabel !== undefined ? customLabel : fixedLabel;
      const dayType = customLabel !== undefined || fixedLabel ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday";

      const tripInfo = {};
      for (const tripType of TRIP_TYPES) {
        const my = myMap.get(`${date}_${tripType}`);
        tripInfo[tripType] = {
          vehicles: vehicleList.map((v) => ({
            vehicleId: v.vehicleId,
            name: v.name,
            routeName: v.routeName,
            stops: v.stops,
            enabled: opMap[v.vehicleId] ? opMap[v.vehicleId][tripType].enabled : false,
            appliedHeadcount: headcountMap.get(`${date}_${tripType}_${v.vehicleId}`) || 0,
          })),
          my: my
            ? {
                applied: true,
                vehicleId: String(my.vehicleId),
                vehicleName: my.vehicleName,
                routeName: my.routeName,
                stop: my.stop,
                headcount: my.headcount,
              }
            : { applied: false },
        };
      }

      days.push({ date, dayType, holidayLabel: holidayLabel || "", ...tripInfo });
    }

    res.json({ week, days, vehicles: vehicleList });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 승차 신청 (도급/단체 계정은 headcount로 인원수를 함께 전달)
router.post("/ride", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    if (!visible) return res.status(403).json({ error: "통근버스 기능이 아직 공개되지 않았습니다." });

    const { date, tripType, vehicleId, stop } = req.body;
    if (!DATE_RE.test(date) || !TRIP_TYPES.includes(tripType) || !vehicleId) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const vehicle = await Vehicle.findById(vehicleId).populate("routeId").lean();
    if (!vehicle || !vehicle.active || !vehicle.routeId) {
      return res.status(400).json({ error: "존재하지 않는 차량입니다." });
    }
    const stopText = typeof stop === "string" ? stop.trim() : "";
    if (!stopText || !(vehicle.routeId.stops || []).includes(stopText)) {
      return res.status(400).json({ error: "탑승 정류장을 올바르게 선택해주세요." });
    }

    const { map: opMap } = await resolveOperationMap(date, [String(vehicle._id)], [tripType]);
    const enabled = opMap[String(vehicle._id)] && opMap[String(vehicle._id)][tripType].enabled;
    if (!enabled) {
      return res.status(403).json({ error: "선택하신 날짜/운행구분은 운행하지 않습니다." });
    }

    const isContractor = req.user.employeeType === "contractor";
    let headcount = 1;
    if (isContractor) {
      const n = parseInt(req.body.headcount, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9999) {
        return res.status(400).json({ error: "인원수는 1 이상 9999 이하의 숫자로 입력해주세요." });
      }
      headcount = n;
    }

    await BusRide.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, tripType },
      {
        $set: {
          status: "applied",
          employeeName: req.user.name,
          department: req.user.department,
          vehicleId: vehicle._id,
          routeId: vehicle.routeId._id,
          routeName: vehicle.routeId.name,
          vehicleName: vehicle.name,
          stop: stopText,
          headcount,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 승차 신청 취소
router.delete("/ride", async (req, res) => {
  try {
    const { date, tripType } = req.body;
    if (!DATE_RE.test(date) || !TRIP_TYPES.includes(tripType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    await BusRide.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, tripType },
      { $set: { status: "cancelled", headcount: 0 } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
