const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Employee = require("../models/Employee");

const router = express.Router();

// 시스템 최초 설치 시 자동 생성되는 "마스터 관리자" 계정의 사번입니다 (server.js의 bootstrapAdmin과 동일 기준).
// 이후 직원 관리에서 다른 직원에게 관리자 권한을 부여해도, 그 직원은 이 사번과 다르므로 마스터 관리자로 취급되지 않습니다.
const MASTER_ADMIN_ID = process.env.ADMIN_EMPLOYEE_ID || "admin";

router.post("/login", async (req, res) => {
  try {
    const { employeeId, name, password } = req.body;
    if (!employeeId || !name) {
      return res.status(400).json({ error: "사번과 이름을 모두 입력해주세요." });
    }
    const employee = await Employee.findOne({
      employeeId: String(employeeId).trim(),
      name: String(name).trim(),
      active: true,
    });
    if (!employee) {
      return res.status(401).json({ error: "사번 또는 이름이 일치하지 않습니다. 관리자에게 등록 여부를 확인해주세요." });
    }

    // 마스터 관리자(사번 admin/이름 master) 계정만 비밀번호를 추가로 확인합니다.
    // 통근버스 개발자 모드(비공개 기능) 접근을 마스터 계정 하나로만 제한하기 위한 안전장치입니다.
    const isMasterAdmin = employee.employeeId === MASTER_ADMIN_ID;
    if (isMasterAdmin) {
      if (!employee.passwordHash) {
        // 아주 오래된(이 기능 추가 이전) 설치본 등 예외적으로 비밀번호가 설정되지 않은 경우.
        // 로그인은 허용하되, 프론트엔드가 즉시 "개발자 모드"에서 비밀번호를 설정하도록 안내합니다.
      } else {
        if (!password) {
          return res.status(401).json({ error: "마스터 관리자 비밀번호를 입력해주세요.", code: "PASSWORD_REQUIRED" });
        }
        const ok = await bcrypt.compare(String(password), employee.passwordHash);
        if (!ok) {
          return res.status(401).json({ error: "비밀번호가 일치하지 않습니다.", code: "PASSWORD_REQUIRED" });
        }
      }
    }

    const payload = {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      role: employee.role,
      managedDepartments: employee.managedDepartments || [],
      employeeType: employee.employeeType || "individual",
      email: employee.email || "",
      // 마스터 관리자 계정만 true입니다. 다른 직원에게 관리자 권한을 부여해도 이 값은 false로 유지됩니다.
      isMasterAdmin,
      // 통근버스(신규) 권한: master가 개별적으로 부여하는, role과 독립적인 별도 권한입니다.
      busAdmin: !!employee.busAdmin,
      managedVehicles: employee.managedVehicles || [],
      busDriver: !!employee.busDriver,
      driverVehicleId: employee.driverVehicleId || "",
      needsPasswordSetup: isMasterAdmin && !employee.passwordHash,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
