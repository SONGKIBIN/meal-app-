const express = require("express");
const multer = require("multer");
const WeeklyMenu = require("../models/WeeklyMenu");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getWeekDates, addDays, todayKSTStr } = require("../utils/dateUtil");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 지난 식단표는 몇 주까지 보관할지 (기본 8주 ≈ 2개월). 그보다 오래된 주는 자동 삭제됩니다.
const MENU_RETENTION_WEEKS = parseInt(process.env.MENU_RETENTION_WEEKS || "8", 10);

// 오래된(지난) 주간 식단표를 자동으로 정리합니다.
// "이번 주/다음 주"는 날짜 기준으로 항상 최신 주가 자동으로 표시되므로,
// 화면에는 이미 지난 식단표가 보이지 않지만 DB에는 계속 쌓일 수 있어 주기적으로 지워줍니다.
async function cleanupOldMenus() {
  const thisMonday = getWeekDates(todayKSTStr())[0];
  const cutoff = addDays(thisMonday, -MENU_RETENTION_WEEKS * 7);
  const result = await WeeklyMenu.deleteMany({ weekStart: { $lt: cutoff } });
  return result.deletedCount || 0;
}

router.use(requireAuth);

// 특정 주(월요일 날짜 기준) 식단표 조회 - 로그인한 모든 사용자 열람 가능
router.get("/:weekStart", async (req, res) => {
  const { weekStart } = req.params;
  if (!DATE_RE.test(weekStart)) return res.status(400).json({ error: "잘못된 날짜입니다." });
  const menu = await WeeklyMenu.findOne({ weekStart }).lean();
  res.json({ menu: menu || null });
});

// 식단표 등록/수정 (관리자 전용) - 이미지 업로드 또는 텍스트 메모
router.post("/", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { weekStart, note } = req.body;
    if (!DATE_RE.test(weekStart || "")) {
      return res.status(400).json({ error: "주 시작일(월요일, YYYY-MM-DD)이 필요합니다." });
    }
    const update = { note: note || "" };
    if (req.file) {
      update.imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      update.imageMime = req.file.mimetype;
    }
    const menu = await WeeklyMenu.findOneAndUpdate(
      { weekStart },
      { $set: update },
      { upsert: true, new: true }
    );
    res.json({ menu });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "식단표 저장 중 오류가 발생했습니다." });
  }
});

// 식단표 삭제 (관리자 전용)
router.delete("/:weekStart", requireAdmin, async (req, res) => {
  await WeeklyMenu.deleteOne({ weekStart: req.params.weekStart });
  res.json({ ok: true });
});

module.exports = router;
module.exports.cleanupOldMenus = cleanupOldMenus;
