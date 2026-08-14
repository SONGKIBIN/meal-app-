const jwt = require("jsonwebtoken");
const Employee = require("../models/Employee");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다.", code: "NO_TOKEN" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { employeeId, name, department, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해주세요.", code: "INVALID_TOKEN" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "관리자만 사용할 수 있습니다.", code: "NOT_ADMIN" });
  }
  next();
}

// 부서 운영자가 실제로 조회/관리할 수 있는 부서 목록을 최신 DB 값 기준으로 계산해 req.scopeDepartments에 담아둡니다.
// role=manager가 아니면 여기서 바로 403 처리하므로, 부서 운영자 전용 라우트에서는 이 미들웨어 하나로
// 권한 확인과 담당 부서 조회를 함께 처리합니다. JWT에는 로그인 시점의 department/managedDepartments가
// 담기지만, 관리자가 나중에 담당 부서를 바꿀 수 있으므로 매 요청마다 DB에서 다시 조회해
// 재로그인 없이도 바로 반영되도록 합니다.
async function attachManagerScope(req, res, next) {
  try {
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || emp.role !== "manager") {
      return res.status(403).json({ error: "부서 운영자만 사용할 수 있습니다.", code: "NOT_MANAGER" });
    }
    const set = new Set([emp.department, ...(emp.managedDepartments || [])].filter((d) => d && d.trim()));
    req.scopeDepartments = [...set];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

module.exports = { requireAuth, requireAdmin, attachManagerScope };
