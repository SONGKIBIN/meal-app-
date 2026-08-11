const express = require("express");
const jwt = require("jsonwebtoken");
const Employee = require("../models/Employee");

const router = express.Router();

// 시스템 최초 설치 시 자동 생성되는 "마스터 관리자" 계정의 사번입니다 (server.js의 bootstrapAdmin과 동일 기준).
// 이후 직원 관리에서 다른 직원에게 관리자 권한을 부여해도, 그 직원은 이 사번과 다르므로 마스터 관리자로 취급되지 않습니다.
const MASTER_ADMIN_ID = process.env.ADMIN_EMPLOYEE_ID || "admin";

router.post("/login", async (req, res) => {
  try {
    const { employeeId, name } = req.body;
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
    const payload = {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      role: employee.role,
      employeeType: employee.employeeType || "individual",
      // 마스터 관리자 계정만 true입니다. 다른 직원에게 관리자 권한을 부여해도 이 값은 false로 유지됩니다.
      isMasterAdmin: employee.employeeId === MASTER_ADMIN_ID,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
