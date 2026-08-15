require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Employee = require("./models/Employee");
const Settings = require("./models/Settings");
const authRoutes = require("./routes/auth");
const reservationRoutes = require("./routes/reservations");
const adminRoutes = require("./routes/admin");
const managerRoutes = require("./routes/manager");
const menuRoutes = require("./routes/menu");
const { cleanupOldMenus } = menuRoutes;
const announcementRoutes = require("./routes/announcement");
const pushRoutes = require("./routes/push");
const cronRoutes = require("./routes/cron");
const ratingRoutes = require("./routes/rating");
const busRoutes = require("./routes/bus");
const busAdminRoutes = require("./routes/busAdmin");
const busDriverRoutes = require("./routes/busDriver");
const masterRoutes = require("./routes/master");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/manager", managerRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/announcement", announcementRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/rating", ratingRoutes);
app.use("/api/bus", busRoutes);
app.use("/api/bus-admin", busAdminRoutes);
app.use("/api/bus-driver", busDriverRoutes);
app.use("/api/master", masterRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 정적 프론트엔드 파일 서빙
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

async function bootstrapAdmin() {
  const id = process.env.ADMIN_EMPLOYEE_ID || "admin";
  const name = process.env.ADMIN_NAME || "관리자";
  const department = process.env.ADMIN_DEPARTMENT || "관리팀";
  const existing = await Employee.findOne({ employeeId: id });
  if (!existing) {
    // 마스터 관리자 계정은 통근버스 개발자 모드 접근을 위해 비밀번호가 필요합니다.
    // MASTER_INITIAL_PASSWORD 환경변수로 초기값을 지정할 수 있고, 지정하지 않으면 기본값이 사용됩니다.
    // 최초 로그인 후 "개발자 모드" 화면에서 반드시 비밀번호를 변경해주세요.
    const initialPassword = process.env.MASTER_INITIAL_PASSWORD || "admin1234!";
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    await Employee.create({ employeeId: id, name, department, role: "admin", active: true, passwordHash });
    console.log(`[bootstrap] 관리자 계정 생성됨: 사번="${id}" 이름="${name}" (초기 비밀번호는 MASTER_INITIAL_PASSWORD 환경변수 또는 기본값을 확인하세요)`);
  } else if (existing.role !== "admin") {
    existing.role = "admin";
    await existing.save();
  }
}

async function bootstrapSettings() {
  const existing = await Settings.findOne({ key: "global" });
  if (!existing) {
    await Settings.create({
      key: "global",
      lunchDeadlineHour: parseInt(process.env.LUNCH_APPLY_DEADLINE_HOUR || process.env.APPLY_DEADLINE_HOUR || "9", 10),
      lunchDeadlineMinute: parseInt(process.env.LUNCH_APPLY_DEADLINE_MINUTE || process.env.APPLY_DEADLINE_MINUTE || "30", 10),
      dinnerDeadlineHour: parseInt(process.env.DINNER_APPLY_DEADLINE_HOUR || "14", 10),
      dinnerDeadlineMinute: parseInt(process.env.DINNER_APPLY_DEADLINE_MINUTE || "0", 10),
    });
  }
}

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI 환경변수가 설정되어 있지 않습니다. .env 파일을 확인해주세요.");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET 환경변수가 설정되어 있지 않습니다. .env 파일을 확인해주세요.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("[db] MongoDB 연결 성공");
  await bootstrapAdmin();
  await bootstrapSettings();
  try {
    const deleted = await cleanupOldMenus();
    if (deleted) console.log(`[bootstrap] 오래된 식단표 ${deleted}건 자동 삭제`);
  } catch (err) {
    console.error("[bootstrap] 식단표 정리 중 오류:", err.message);
  }
  app.listen(PORT, () => console.log(`[server] http://localhost:${PORT} 에서 실행 중`));
}

start().catch((err) => {
  console.error("서버 시작 중 오류:", err);
  process.exit(1);
});

module.exports = app;
