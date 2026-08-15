const express = require("express");
const Reservation = require("../models/Reservation");
const MealRating = require("../models/MealRating");
const { requireAuth } = require("../middleware/auth");
const { todayKSTStr, resolveRatingWindow, getRatingWindowTimes } = require("../utils/dateUtil");

const router = express.Router();
const MEAL_TYPES = ["lunch", "dinner"];

router.use(requireAuth);

// 중식/석식 각각에 대해 "지금 평가할 수 있는지"와 "이미 남긴 평가가 있는지"를 함께 내려줍니다.
// 평가 시간대가 당일 낮부터 다음날 새벽까지 이어지므로(예: 중식 당일 12:00 ~ 익일 08:00), 지금 이 순간
// 열려있는 시간대가 어느 날짜의 끼니에 대한 것인지는 resolveRatingWindow가 판단합니다. 시간대가 닫혀있는
// 동안에는(예: 08:00~12:00 사이) 평가 카드에 "신청하면 평가 가능" 안내를 보여주기 위해 오늘 날짜 기준으로
// 신청 여부만 참고로 함께 내려줍니다.
router.get("/today", async (req, res) => {
  try {
    const today = todayKSTStr();
    const lunchWindow = resolveRatingWindow("lunch");
    const dinnerWindow = resolveRatingWindow("dinner");
    const dates = [...new Set([today, lunchWindow.date, dinnerWindow.date].filter(Boolean))];

    const [reservations, ratings] = await Promise.all([
      Reservation.find({ employeeId: req.user.employeeId, date: { $in: dates }, status: "applied" }).lean(),
      MealRating.find({ employeeId: req.user.employeeId, date: { $in: dates } }).lean(),
    ]);

    const build = (mealType, windowInfo) => {
      const targetDate = windowInfo.open ? windowInfo.date : today;
      const applied = reservations.some((r) => r.mealType === mealType && r.date === targetDate);
      const myRatingDoc = ratings.find((r) => r.mealType === mealType && r.date === targetDate);
      const times = getRatingWindowTimes(mealType);
      return {
        date: targetDate,
        applied,
        windowOpen: windowInfo.open,
        windowStartLabel: times.startLabel,
        windowEndLabel: times.endLabel,
        windowSpansNextDay: times.spansNextDay,
        eligible: applied && windowInfo.open,
        myRating: myRatingDoc ? { stars: myRatingDoc.stars, reason: myRatingDoc.reason } : null,
      };
    };

    res.json({ lunch: build("lunch", lunchWindow), dinner: build("dinner", dinnerWindow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 만족도 평가 등록/수정. 해당 끼니를 신청한 사람만, 정해진 시간대 안에서만 등록할 수 있고,
// 이유(사유)를 반드시 입력해야 합니다. 시간대가 자정을 넘어가므로, 실제로 평가가 적용되는 날짜는
// 서버가 지금 시각을 기준으로 직접 계산합니다(자정~08:00 사이에 등록하면 전날 끼니로 기록됨).
router.post("/", async (req, res) => {
  try {
    const { mealType, reason } = req.body;
    const stars = parseInt(req.body.stars, 10);
    if (!MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "별점을 1~5개 중에서 선택해주세요." });
    }
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText) {
      return res.status(400).json({ error: "별점을 남긴 이유를 입력해야 등록할 수 있습니다." });
    }
    if (reasonText.length > 500) {
      return res.status(400).json({ error: "이유는 500자 이내로 입력해주세요." });
    }

    const mealLabel = mealType === "lunch" ? "중식" : "석식";
    const window = resolveRatingWindow(mealType);
    if (!window.open) {
      const times = getRatingWindowTimes(mealType);
      const rangeText = times.spansNextDay
        ? `당일 ${times.startLabel} ~ 익일 ${times.endLabel}`
        : `${times.startLabel} ~ ${times.endLabel}`;
      return res.status(403).json({ error: `${mealLabel} 만족도 평가는 ${rangeText} 사이에만 등록할 수 있습니다.` });
    }
    const date = window.date;
    const reservation = await Reservation.findOne({ employeeId: req.user.employeeId, date, mealType, status: "applied" }).lean();
    if (!reservation) {
      return res.status(403).json({ error: `${mealLabel}을 신청한 경우에만 만족도 평가를 남길 수 있습니다.` });
    }

    const score = stars * 20;
    const updated = await MealRating.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, mealType },
      {
        $set: {
          employeeName: req.user.name,
          department: req.user.department || "",
          stars,
          score,
          reason: reasonText,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true, rating: { stars: updated.stars, score: updated.score, reason: updated.reason } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
