const express = require("express");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");
const {
  getWeekDates,
  isApplyAllowed,
  isCancelAllowed,
  DEADLINE_HOUR,
  DEADLINE_MINUTE,
} = require("../utils/dateUtil");

const router = express.Router();
const MEAL_TYPES = ["lunch", "dinner"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireAuth);

// 관리자가 설정 화면에서 저장한 마감시간을 가져옵니다 (없으면 환경변수 기본값 사용)
async function getDeadline() {
  const s = await Settings.findOne({ key: "global" }).lean();
  if (s && Number.isInteger(s.deadlineHour) && Number.isInteger(s.deadlineMinute)) {
    return { hour: s.deadlineHour, minute: s.deadlineMinute };
  }
  return { hour: DEADLINE_HOUR, minute: DEADLINE_MINUTE };
}

// 특정 날짜가 포함된 주(월~일)의 신청 현황 조회
router.get("/week", async (req, res) => {
  try {
    const anchor = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : undefined;
    const week = getWeekDates(anchor || new Date().toISOString().slice(0, 10));
    const deadline = await getDeadline();
    const rows = await Reservation.find({
      employeeId: req.user.employeeId,
      date: { $in: week },
      status: "applied",
    }).lean();

    const map = {};
    for (const r of rows) {
      map[`${r.date}_${r.mealType}`] = true;
    }

    const days = week.map((date) => ({
      date,
      lunch: {
        applied: !!map[`${date}_lunch`],
        canApply: isApplyAllowed(date, new Date(), deadline),
        canCancel: isCancelAllowed(date),
      },
      dinner: {
        applied: !!map[`${date}_dinner`],
        canApply: isApplyAllowed(date, new Date(), deadline),
        canCancel: isCancelAllowed(date),
      },
    }));

    res.json({ week, days, deadline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 신청
router.post("/", async (req, res) => {
  try {
    const { date, mealType } = req.body;
    if (!DATE_RE.test(date) || !MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const deadline = await getDeadline();
    if (!isApplyAllowed(date, new Date(), deadline)) {
      return res.status(403).json({
        error: `신청 가능 시간이 지났습니다. (당일 신청은 오전 ${deadline.hour}시 ${String(deadline.minute).padStart(2, "0")}분까지 가능)`,
      });
    }
    await Reservation.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, mealType },
      {
        $set: {
          status: "applied",
          employeeName: req.user.name,
          department: req.user.department,
          modifiedByAdmin: false,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 취소
router.delete("/", async (req, res) => {
  try {
    const { date, mealType } = req.body;
    if (!DATE_RE.test(date) || !MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    if (!isCancelAllowed(date)) {
      return res.status(403).json({ error: "당일 신청 건은 취소할 수 없습니다. 변경이 필요하면 관리자에게 문의해주세요." });
    }
    await Reservation.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, mealType },
      { $set: { status: "cancelled", modifiedByAdmin: false } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
