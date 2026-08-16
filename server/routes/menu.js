const express = require("express");
const multer = require("multer");
const WeeklyMenu = require("../models/WeeklyMenu");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getWeekDates, addDays, todayKSTStr } = require("../utils/dateUtil");

const router = express.Router();
const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("이미지 파일(PNG/JPEG/WEBP/GIF)만 업로드할 수 있습니다."));
    }
    cb(null, true);
  },
});
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// multer의 fileFilter/용량 제한 오류를 이 앱의 나머지 API와 동일한 JSON 형식({error: "..."})으로
// 내려주기 위한 래퍼입니다. 이게 없으면 Express 기본 에러 처리로 넘어가 HTML 응답이 내려가서
// 프론트엔드가 오류 메시지를 파싱하지 못합니다.
function handleImageUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "이미지 업로드 중 오류가 발생했습니다." });
    next();
  });
}

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
router.post("/", requireAdmin, handleImageUpload, async (req, res) => {
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
