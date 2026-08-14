const express = require("express");
const Reservation = require("../models/Reservation");
const MealRating = require("../models/MealRating");
const { requireAuth } = require("../middleware/auth");
const { todayKSTStr, isRatingWindowOpen, ratingWindowLabel } = require("../utils/dateUtil");

const router = express.Router();
const MEAL_TYPES = ["lunch", "dinner"];

router.use(requireAuth);

// 오늘 중식/석식 각각에 대해 "지금 평가할 수 있는지"와 "이미 남긴 평가가 있는지"를 함께 내려줍니다.
// 화면에서는 이 응답을 보고 평가 카드를 보여줄지 말지 결정합니다 (평가 가능 시간대가 아니면 카드 자체를 숨김).
router.get("/today", async (req, res) => {
  try {
    const date = todayKSTStr();
    const [reservations, ratings] = await Promise.all([
      Reservation.find({ employeeId: req.user.employeeId, date, status: "applied" }).lean(),
      MealRating.find({ employeeId: req.user.employeeId, date }).lean(),
    ]);
    const appliedSet = new Set(reservations.map((r) => r.mealType));
    const ratingMap = new Map(ratings.map((r) => [r.mealType, r]));

    const build = (mealType) => {
      const myRating = ratingMap.get(mealType);
      return {
        applied: appliedSet.has(mealType),
        windowOpen: isRatingWindowOpen(mealType),
        windowLabel: ratingWindowLabel(mealType),
        eligible: appliedSet.has(mealType) && isRatingWindowOpen(mealType),
        myRating: myRating ? { stars: myRating.stars, reason: myRating.reason } : null,
      };
    };

    res.json({ date, lunch: build("lunch"), dinner: build("dinner") });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 만족도 평가 등록/수정. 오늘 해당 끼니를 신청한 사람만, 정해진 시간대 안에서만 등록할 수 있고,
// 이유(사유)를 반드시 입력해야 합니다.
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

    const date = todayKSTStr();
    const mealLabel = mealType === "lunch" ? "중식" : "석식";
    if (!isRatingWindowOpen(mealType)) {
      return res.status(403).json({
        error: `${mealLabel} 만족도 평가는 ${ratingWindowLabel(mealType)} 사이에만 등록할 수 있습니다.`,
      });
    }
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
