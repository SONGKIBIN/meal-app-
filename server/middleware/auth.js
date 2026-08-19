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

// 식사 신청/만족도 평가처럼 재직 여부와 직원 유형(개인/도급)이 직접 인원 집계에 영향을 주는
// 라우트에서 사용합니다. JWT(로그인 시점, 최대 30일 유효)에 저장된 값만 믿으면, 퇴사 처리(재직 여부
// 해제)나 개인↔도급 유형 변경이 최대 30일간 반영되지 않을 수 있습니다(예: 도급에서 개인으로 바꾼
// 계정이 옛 토큰으로 여전히 대규모 인원수를 입력할 수 있음). 매 요청마다 DB에서 다시 확인하고,
// req.user의 값도 최신 정보로 갱신해 이후 로직이 항상 최신 값을 사용하도록 합니다.
async function requireActiveEmployee(req, res, next) {
  try {
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || !emp.active) {
      return res.status(403).json({ error: "재직 정보가 확인되지 않습니다. 관리자에게 문의해주세요.", code: "NOT_ACTIVE" });
    }
    req.user.name = emp.name;
    req.user.department = emp.department;
    req.user.role = emp.role;
    req.user.employeeType = emp.employeeType || "individual";
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

// role=admin 권한은 관리자가 나중에 회수할 수 있으므로, JWT(로그인 시점, 최대 30일 유효)에 저장된
// role만 믿지 않고 매 요청마다 DB에서 다시 확인합니다(attachManagerScope/attachVehicleScope와 동일한
// 이유). 이렇게 해야 권한을 회수한 즉시(재로그인 없이도) 접근이 차단됩니다.
async function requireAdmin(req, res, next) {
  try {
    if (!req.user) return res.status(403).json({ error: "관리자만 사용할 수 있습니다.", code: "NOT_ADMIN" });
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || !emp.active || emp.role !== "admin") {
      return res.status(403).json({ error: "관리자만 사용할 수 있습니다.", code: "NOT_ADMIN" });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

// 마스터 관리자(사번 admin, server.js bootstrapAdmin과 동일 기준) 전용 라우트에서 사용합니다.
// 일반 관리자(role=admin)는 여기서 걸러지며, "개발자 모드"/통근버스 공개 여부 등은 절대 볼 수 없습니다.
function requireMasterAdmin(req, res, next) {
  if (!req.user || !req.user.isMasterAdmin) {
    return res.status(403).json({ error: "마스터 관리자만 사용할 수 있습니다.", code: "NOT_MASTER" });
  }
  next();
}

// 통근버스 관리 권한(마스터 관리자 또는 master가 busAdmin 권한을 부여한 직원)이 있는지 확인합니다.
function requireBusAdmin(req, res, next) {
  if (!req.user || (!req.user.isMasterAdmin && !req.user.busAdmin)) {
    return res.status(403).json({ error: "통근 차량 관리 관리자만 사용할 수 있습니다.", code: "NOT_BUS_ADMIN" });
  }
  next();
}

// 통근버스 기사 권한(마스터 관리자 또는 master가 busDriver 권한을 부여한 직원)이 있는지 확인합니다.
// busDriver 권한도 master가 나중에 회수할 수 있으므로, attachVehicleScope와 마찬가지로 매 요청마다
// DB에서 다시 확인해 권한 회수가 즉시(재로그인 없이도) 반영되도록 합니다.
async function requireBusDriver(req, res, next) {
  try {
    if (!req.user) return res.status(403).json({ error: "통근버스 기사만 사용할 수 있습니다.", code: "NOT_BUS_DRIVER" });
    if (req.user.isMasterAdmin) return next();
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || !emp.active || !emp.busDriver) {
      return res.status(403).json({ error: "통근버스 기사만 사용할 수 있습니다.", code: "NOT_BUS_DRIVER" });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

// 부서 운영자가 실제로 조회/관리할 수 있는 부서 목록을 최신 DB 값 기준으로 계산해 req.scopeDepartments에 담아둡니다.
// role=manager가 아니면 여기서 바로 403 처리하므로, 부서 운영자 전용 라우트에서는 이 미들웨어 하나로
// 권한 확인과 담당 부서 조회를 함께 처리합니다. JWT에는 로그인 시점의 department/managedDepartments가
// 담기지만, 관리자가 나중에 담당 부서를 바꿀 수 있으므로 매 요청마다 DB에서 다시 조회해
// 재로그인 없이도 바로 반영되도록 합니다.
async function attachManagerScope(req, res, next) {
  try {
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || !emp.active || emp.role !== "manager") {
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

// busAdmin이 실제로 관리할 수 있는 차량 id 목록을 req.vehicleScope에 담아둡니다.
// 마스터 관리자이거나, busAdmin이지만 managedVehicles가 비어있으면(기본값) 전체 차량을 관리하는 것으로 간주해
// req.vehicleScope = null (제한 없음)로 표시합니다. managedVehicles가 지정되어 있으면 그 목록으로 제한합니다.
async function attachVehicleScope(req, res, next) {
  try {
    if (req.user.isMasterAdmin) {
      req.vehicleScope = null;
      return next();
    }
    const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
    if (!emp || !emp.active || !emp.busAdmin) {
      return res.status(403).json({ error: "통근 차량 관리 관리자만 사용할 수 있습니다.", code: "NOT_BUS_ADMIN" });
    }
    const managed = Array.isArray(emp.managedVehicles) ? emp.managedVehicles.filter(Boolean) : [];
    req.vehicleScope = managed.length ? managed : null;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

module.exports = {
  requireAuth,
  requireActiveEmployee,
  requireAdmin,
  attachManagerScope,
  requireMasterAdmin,
  requireBusAdmin,
  requireBusDriver,
  attachVehicleScope,
};
