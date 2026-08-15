const express = require("express");
const bcrypt = require("bcryptjs");
const Employee = require("../models/Employee");
const Settings = require("../models/Settings");
const Vehicle = require("../models/Vehicle");
const { requireAuth, requireMasterAdmin } = require("../middleware/auth");

const router = express.Router();

// 이 라우터의 모든 엔드포인트는 마스터 관리자(사번 admin, server.js bootstrapAdmin 기준) 전용입니다.
// 일반 관리자(role=admin)는 requireMasterAdmin에서 403으로 차단되며, 프론트엔드에서도
// isMasterAdmin이 아니면 "개발자 모드" 메뉴 자체를 렌더링하지 않습니다.
router.use(requireAuth, requireMasterAdmin);

// 마스터 관리자 비밀번호 변경
router.post("/change-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "새 비밀번호는 6자 이상으로 입력해주세요." });
    }
    const emp = await Employee.findOne({ employeeId: req.user.employeeId });
    if (!emp) return res.status(404).json({ error: "계정 정보를 찾을 수 없습니다." });

    if (emp.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: "현재 비밀번호를 입력해주세요." });
      }
      const ok = await bcrypt.compare(String(currentPassword), emp.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "현재 비밀번호가 일치하지 않습니다." });
      }
    }
    emp.passwordHash = await bcrypt.hash(newPassword, 10);
    await emp.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 비밀번호만 다시 확인 (민감한 작업 전 재확인용)
async function verifyPassword(employeeId, password) {
  const emp = await Employee.findOne({ employeeId });
  if (!emp) return false;
  if (!emp.passwordHash) return true; // 아직 비밀번호 미설정(구버전) - 예외적으로 통과
  if (!password) return false;
  return bcrypt.compare(String(password), emp.passwordHash);
}

// 통근버스 기능 공개 여부 조회
router.get("/bus-system", async (req, res) => {
  try {
    const s = await Settings.findOne({ key: "global" }).lean();
    res.json({ enabled: !!(s && s.busSystemEnabled), note: (s && s.busSystemNote) || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 통근버스 기능 공개 여부 변경 (비공개 개발자 모드 ON/OFF). 안전을 위해 비밀번호를 다시 확인합니다.
router.post("/bus-system", async (req, res) => {
  try {
    const { enabled, note, password } = req.body;
    const ok = await verifyPassword(req.user.employeeId, password);
    if (!ok) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다." });
    }
    const s = await Settings.findOneAndUpdate(
      { key: "global" },
      { $set: { busSystemEnabled: !!enabled, busSystemNote: typeof note === "string" ? note.trim().slice(0, 300) : "" } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, enabled: !!s.busSystemEnabled, note: s.busSystemNote || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 통근버스 권한(관리 관리자/기사) 부여 대상 선택을 위한 재직 직원 목록
router.get("/employees", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = { active: true };
    if (q) {
      filter.$or = [
        { employeeId: new RegExp(q, "i") },
        { name: new RegExp(q, "i") },
        { department: new RegExp(q, "i") },
      ];
    }
    const employees = await Employee.find(filter)
      .select("employeeId name department role busAdmin managedVehicles busDriver driverVehicleId email")
      .sort({ department: 1, name: 1 })
      .lean();
    res.json({ employees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 통근 차량 관리 관리자 / 기사 권한 부여 (master 전용). role(식수신청 관리자/부서운영자)은 기존과 동일하게
// [관리자] 화면의 직원 관리에서 부여합니다 - 여기서는 통근버스 전용 권한만 다룹니다.
router.put("/employees/:employeeId/bus-permissions", async (req, res) => {
  try {
    const { busAdmin, managedVehicles, busDriver, driverVehicleId } = req.body;
    const update = {};
    if (busAdmin !== undefined) update.busAdmin = !!busAdmin;
    if (managedVehicles !== undefined) {
      update.managedVehicles = Array.isArray(managedVehicles) ? managedVehicles.filter(Boolean) : [];
    }
    if (busDriver !== undefined) update.busDriver = !!busDriver;
    if (driverVehicleId !== undefined) {
      update.driverVehicleId = typeof driverVehicleId === "string" ? driverVehicleId : "";
    }
    if (update.busDriver === false) {
      update.driverVehicleId = "";
    }
    if (update.driverVehicleId) {
      const v = await Vehicle.findById(update.driverVehicleId).lean();
      if (!v) return res.status(400).json({ error: "존재하지 않는 차량입니다." });
    }

    // 차량-기사는 1:1 배정이 기본이므로, 이 차량에 이미 배정되어 있던 다른 기사가 있다면
    // 먼저 그 기사의 배정을 해제해 데이터가 어긋나지 않도록 합니다.
    if (update.driverVehicleId) {
      await Employee.updateMany(
        { driverVehicleId: update.driverVehicleId, employeeId: { $ne: req.params.employeeId } },
        { $set: { driverVehicleId: "" } }
      );
    }

    const emp = await Employee.findOneAndUpdate(
      { employeeId: req.params.employeeId },
      { $set: update },
      { new: true }
    ).select("employeeId name department role busAdmin managedVehicles busDriver driverVehicleId email");
    if (!emp) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });

    // 이 차량에 다른 기사가 배정되어 있었다면(차량-기사는 1:1 배정을 기본으로 함) 함께 갱신합니다.
    if (update.driverVehicleId) {
      await Vehicle.findByIdAndUpdate(update.driverVehicleId, { $set: { driverEmployeeId: emp.employeeId } });
    }
    // 기사 권한을 끄거나 다른 차량으로 옮긴 경우, 이전에 배정되어 있던 차량의 driverEmployeeId도 비워줍니다.
    if (update.driverVehicleId !== undefined) {
      await Vehicle.updateMany(
        { driverEmployeeId: emp.employeeId, _id: { $ne: update.driverVehicleId || null } },
        { $set: { driverEmployeeId: "" } }
      );
    }

    res.json({ ok: true, employee: emp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
