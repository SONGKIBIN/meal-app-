const express = require("express");
const Settings = require("../models/Settings");
const BusRoute = require("../models/BusRoute");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const BusDefaultRide = require("../models/BusDefaultRide");
const Holiday = require("../models/Holiday");
const { requireAuth } = require("../middleware/auth");
const { getWeekDates, fixedHolidayLabel, isWeekendDate } = require("../utils/dateUtil");
const { TRIP_TYPES, resolveOperationMap, isDefaultOperatingDayBulk, isDefaultOperatingDay } = require("../utils/busOperation");
const { computeRiders } = require("../utils/busRiders");

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

// 내 기본(평소) 탑승 차량 등록 현황 조회. 트립타입(출근/정시퇴근/연장퇴근)별로 최대 1개씩 등록할 수 있습니다.
router.get("/default", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    if (!visible) return res.status(403).json({ error: "통근버스 기능이 아직 공개되지 않았습니다." });
    const defaults = await BusDefaultRide.find({ employeeId: req.user.employeeId }).lean();
    const byTrip = new Map(defaults.map((d) => [d.tripType, d]));
    res.json({
      defaults: TRIP_TYPES.map((tripType) => {
        const d = byTrip.get(tripType);
        return d
          ? {
              tripType,
              vehicleId: String(d.vehicleId),
              vehicleName: d.vehicleName,
              routeName: d.routeName,
              stop: d.stop,
              headcount: d.headcount,
            }
          : { tripType, vehicleId: null };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 내 기본 탑승 차량 등록/수정/해지. vehicleId를 비워서 보내면 해당 트립타입의 기본 등록을 해지합니다.
router.post("/default", async (req, res) => {
  try {
    const visible = await computeVisible(req);
    if (!visible) return res.status(403).json({ error: "통근버스 기능이 아직 공개되지 않았습니다." });

    const { tripType, vehicleId, stop } = req.body;
    if (!TRIP_TYPES.includes(tripType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }

    if (!vehicleId) {
      await BusDefaultRide.deleteOne({ employeeId: req.user.employeeId, tripType });
      return res.json({ ok: true, removed: true });
    }

    const vehicle = await Vehicle.findById(vehicleId).populate("routeId").lean();
    if (!vehicle || !vehicle.active || !vehicle.routeId) {
      return res.status(400).json({ error: "존재하지 않는 차량입니다." });
    }
    const stopText = typeof stop === "string" ? stop.trim() : "";
    if (!stopText || !(vehicle.routeId.stops || []).includes(stopText)) {
      return res.status(400).json({ error: "탑승 정류장을 올바르게 선택해주세요." });
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

    await BusDefaultRide.findOneAndUpdate(
      { employeeId: req.user.employeeId, tripType },
      {
        $set: {
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
    // 새로 기본 차량을 등록/변경했다면, 앞으로는 그 차량을 기준으로 자동 탑승되므로 과거에 남아있던
    // "그날만 취소" 예외 기록이 혼란을 주지 않도록 유지합니다(미래 날짜 예외 기록은 건드리지 않음 - 사용자가
    // 이미 특정 날짜를 취소해두었다면 그 의사를 존중합니다).
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 주간(월~일) 승차 신청 현황: 날짜 x 운행구분(출근/정시퇴근/연장퇴근)별로 선택 가능한 차량과
// 본인 탑승 여부(기본 등록에 의한 자동 탑승 포함)를 함께 내려줍니다.
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
    const defaultDayMap = await isDefaultOperatingDayBulk(week);

    const allDefaults = await BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean();
    const myDefaultMap = new Map(
      allDefaults.filter((d) => d.employeeId === req.user.employeeId).map((d) => [d.tripType, d])
    );

    const weekExplicit = await BusRide.find({ date: { $in: week }, vehicleId: { $in: vehicleIds } }).lean();

    const days = [];
    for (const date of week) {
      const { map: opMap } = await resolveOperationMap(date, vehicleIds);
      const customLabel = customHolidayMap.get(date);
      const fixedLabel = fixedHolidayLabel(date);
      const holidayLabel = customLabel !== undefined ? customLabel : fixedLabel;
      const dayType = customLabel !== undefined || fixedLabel ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday";
      const isDefaultDay = !!defaultDayMap[date];
      const explicitForDate = weekExplicit.filter((r) => r.date === date);
      const myExplicitRow = explicitForDate.find((r) => r.employeeId === req.user.employeeId);

      const tripInfo = {};
      for (const tripType of TRIP_TYPES) {
        const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
        const myExplicit = explicitForDate.find((r) => r.tripType === tripType && r.employeeId === req.user.employeeId);
        const myDefault = myDefaultMap.get(tripType);

        let my = { riding: false, via: null };
        if (myExplicit && myExplicit.status === "applied") {
          my = {
            riding: true,
            via: "explicit",
            vehicleId: String(myExplicit.vehicleId),
            vehicleName: myExplicit.vehicleName,
            routeName: myExplicit.routeName,
            stop: myExplicit.stop,
            headcount: myExplicit.headcount,
          };
        } else if (myExplicit && myExplicit.status === "cancelled") {
          my = { riding: false, via: myDefault ? "cancelled" : null };
        } else if (isDefaultDay && myDefault) {
          const vId = String(myDefault.vehicleId);
          const enabled = opMap[vId] && opMap[vId][tripType] && opMap[vId][tripType].enabled;
          my = enabled
            ? {
                riding: true,
                via: "default",
                vehicleId: vId,
                vehicleName: myDefault.vehicleName,
                routeName: myDefault.routeName,
                stop: myDefault.stop,
                headcount: myDefault.headcount,
              }
            : { riding: false, via: "default_disabled" };
        }

        tripInfo[tripType] = {
          vehicles: vehicleList.map((v) => ({
            vehicleId: v.vehicleId,
            name: v.name,
            routeName: v.routeName,
            stops: v.stops,
            enabled: opMap[v.vehicleId] ? opMap[v.vehicleId][tripType].enabled : false,
            appliedHeadcount: (ridersByVehicle[v.vehicleId] || []).reduce((sum, r) => sum + (r.headcount || 1), 0),
          })),
          my,
          hasDefault: !!myDefault,
          isDefaultDay,
        };
      }

      days.push({ date, dayType, holidayLabel: holidayLabel || "", ...tripInfo });
    }

    res.json({
      week,
      days,
      vehicles: vehicleList,
      myDefaults: TRIP_TYPES.map((tripType) => {
        const d = myDefaultMap.get(tripType);
        return d
          ? {
              tripType,
              vehicleId: String(d.vehicleId),
              vehicleName: d.vehicleName,
              routeName: d.routeName,
              stop: d.stop,
              headcount: d.headcount,
            }
          : { tripType, vehicleId: null };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 승차 신청 (기본 운행일이 아닌 날의 신청, 또는 기본 등록과 다른 차량으로 그날만 바꿔 타는 경우.
// 도급/단체 계정은 headcount로 인원수를 함께 전달)
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

// 승차 신청 취소. 그날 명시적으로 신청했던 경우는 그 신청을 취소하고, 기본 등록에 의해 자동 탑승 중이던
// 경우에는 "그날만 취소" 예외 기록을 새로 남깁니다(기본 등록 자체는 유지되어 다음 날부터 다시 자동 적용됨).
router.delete("/ride", async (req, res) => {
  try {
    const { date, tripType } = req.body;
    if (!DATE_RE.test(date) || !TRIP_TYPES.includes(tripType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const existing = await BusRide.findOne({ employeeId: req.user.employeeId, date, tripType });
    if (existing) {
      existing.status = "cancelled";
      existing.headcount = 0;
      await existing.save();
      return res.json({ ok: true });
    }
    const isDefaultDay = await isDefaultOperatingDay(date);
    const def = isDefaultDay ? await BusDefaultRide.findOne({ employeeId: req.user.employeeId, tripType }) : null;
    if (!def) {
      return res.status(400).json({ error: "취소할 신청 내역이 없습니다." });
    }
    await BusRide.create({
      employeeId: req.user.employeeId,
      employeeName: req.user.name,
      department: req.user.department,
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

module.exports = router;
