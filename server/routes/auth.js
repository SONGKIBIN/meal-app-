const express = require("express");
const jwt = require("jsonwebtoken");
const Employee = require("../models/Employee");

const router = express.Router();

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
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
