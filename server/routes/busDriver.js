const express = require("express");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const BusDrivingLog = require("../models/BusDrivingLog");
const { requireAuth, requireBusDriver } = require("../middleware/auth");
const { TRIP_TYPES, resolveOperationMap } = require("../utils/busOperation");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRIP_LABEL = { commute: "출근운행", regularLeave: "정시퇴근운행", extendedLeave: "연장퇴근운행" };

router.use(requireAuth, requireBusDriver);

// 기사 본인 차량의 오늘(또는 지정 날짜) 운행 정보 + 다른 모든 차량의 운행여부/인원 현황(읽기 전용)을 함께 내려줍니다.
router.get("/today", async (req, res) => {
  try {
    const date = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const vehicles = await Vehicle.find({ active: true }).populate("routeId").sort({ name: 1 }).lean();
    const vehicleIds = vehicles.map((v) => String(v._id));

    const { map: opMap } = await resolveOperationMap(date, vehicleIds);
    const rides = await BusRide.find({ date, status: "applied", vehicleId: { $in: vehicleIds } }).lean();
    const headcountMap = new Map();
    for (const r of rides) {
      const key = `${String(r.vehicleId)}_${r.tripType}`;
      headcountMap.set(key, (headcountMap.get(key) || 0) + (r.headcount || 1));
    }
    const logs = await BusDrivingLog.find({ date, vehicleId: { $in: vehicleIds } }).lean();
    const logMap = new Map(logs.map((l) => [`${String(l.vehicleId)}_${l.tripType}`, l]));

    const buildVehicle = (v) => ({
      vehicleId: String(v._id),
      name: v.name,
      routeName: v.routeId ? v.routeId.name : "",
      isMine: v.driverEmployeeId === req.user.employeeId,
      trips: TRIP_TYPES.map((tripType) => {
        const log = logMap.get(`${String(v._id)}_${tripType}`);
        return {
          tripType,
          label: TRIP_LABEL[tripType],
          enabled: opMap[String(v._id)] ? opMap[String(v._id)][tripType].enabled : false,
          appliedHeadcount: headcountMap.get(`${String(v._id)}_${tripType}`) || 0,
          operated: log ? log.operated : null,
          actualHeadcount: log ? log.actualHeadcount : null,
          note: log ? log.note : "",
        };
      }),
    });

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
