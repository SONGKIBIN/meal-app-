const jwt = require("jsonwebtoken");

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

module.exports = { requireAuth, requireAdmin };
