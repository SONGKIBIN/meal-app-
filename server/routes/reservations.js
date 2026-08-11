const express = require("express");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const Employee = require("../models/Employee");
const { requireAuth } = require("../middleware/auth");
const {
  getWeekDates,
  isApplyAllowed,
  isCancelAllowed,
  todayKSTStr,
  LUNCH_DEADLINE_HOUR,
  LUNCH_DEADLINE_MINUTE,
  DINNER_DEADLINE_HOUR,
  DINNER_DEADLINE_MINUTE,
} = require("../utils/dateUtil");

const router = express.Router();
const MEAL_TYPES = ["lunch", "dinner"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireAuth);

// 관리자가 설정 화면에서 저장한 마감시간을 가져옵니다 (없으면 환경변수 기본값 사용).
// 중식/석식은 서로 다른 마감시간을 가질 수 있어 mealType별로 조회합니다.
async function getDeadline(mealType) {
  const s = await Settings.findOne({ key: "global" }).lean();
  if (mealType === "dinner") {
    if (s && Number.isInteger(s.dinnerDeadlineHour) && Number.isInteger(s.dinnerDeadlineMinute)) {
      return { hour: s.dinnerDeadlineHour, minute: s.dinnerDeadlineMinute };
    }
    return { hour: DINNER_DEADLINE_HOUR, minute: DINNER_DEADLINE_MINUTE };
  }
  if (s && Number.isInteger(s.lunchDeadlineHour) && Number.isInteger(s.lunchDeadlineMinute)) {
    return { hour: s.lunchDeadlineHour, minute: s.lunchDeadlineMinute };
  }
  return { hour: LUNCH_DEADLINE_HOUR, minute: LUNCH_DEADLINE_MINUTE };
}

// 특정 날짜가 포함된 주(월~일)의 신청 현황 조회
router.get("/week", async (req, res) => {
  try {
    const anchor = req.query.date && DATE_RE.test(req.query.date) ? req.query.date : undefined;
    const week = getWeekDates(anchor || new Date().toISOString().slice(0, 10));
    const lunchDeadline = await getDeadline("lunch");
    const dinnerDeadline = await getDeadline("dinner");
    const rows = await Reservation.find({
      employeeId: req.user.employeeId,
      date: { $in: week },
      status: "applied",
    }).lean();

    const map = {};
    for (const r of rows) {
      map[`${r.date}_${r.mealType}`] = r.headcount ?? 1;
    }

    // 도급(단체) 계정이면 총원(TO) 정보를 함께 내려줘서, 화면에서 신청/미신청 인원을 보여줄 수 있게 합니다.
    let contractorInfo = null;
    let totalHeadcount = null;
    if (req.user.employeeType === "contractor") {
      const emp = await Employee.findOne({ employeeId: req.user.employeeId }).lean();
      if (emp) {
        totalHeadcount = Number.isInteger(emp.totalHeadcount) ? emp.totalHeadcount : null;
        contractorInfo = {
          totalHeadcount,
          requestedHeadcount: Number.isInteger(emp.requestedHeadcount) ? emp.requestedHeadcount : null,
          requestedHeadcountNote: emp.requestedHeadcountNote || "",
          requestedHeadcountAt: emp.requestedHeadcountAt || null,
        };
      }
    }

    const days = week.map((date) => {
      const canApplyLunch = isApplyAllowed(date, new Date(), lunchDeadline);
      const canCancelLunch = isCancelAllowed(date, new Date(), lunchDeadline);
      const canApplyDinner = isApplyAllowed(date, new Date(), dinnerDeadline);
      const canCancelDinner = isCancelAllowed(date, new Date(), dinnerDeadline);
      const lunchHeadcount = map[`${date}_lunch`] || 0;
      const dinnerHeadcount = map[`${date}_dinner`] || 0;
      return {
        date,
        lunch: {
          applied: !!map[`${date}_lunch`],
          headcount: lunchHeadcount,
          canApply: canApplyLunch,
          canCancel: canCancelLunch,
          notApplied: totalHeadcount !== null ? Math.max(totalHeadcount - lunchHeadcount, 0) : null,
        },
        dinner: {
          applied: !!map[`${date}_dinner`],
          headcount: dinnerHeadcount,
          canApply: canApplyDinner,
          canCancel: canCancelDinner,
          notApplied: totalHeadcount !== null ? Math.max(totalHeadcount - dinnerHeadcount, 0) : null,
        },
      };
    });

    res.json({ week, days, deadline: { lunch: lunchDeadline, dinner: dinnerDeadline }, contractor: contractorInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 신청 (도급회사/단체 계정은 headcount로 인원수를 함께 전달합니다)
router.post("/", async (req, res) => {
  try {
    const { date, mealType } = req.body;
    if (!DATE_RE.test(date) || !MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }
    const deadline = await getDeadline(mealType);
    if (!isApplyAllowed(date, new Date(), deadline)) {
      const mealLabel = mealType === "lunch" ? "중식" : "석식";
      return res.status(403).json({
        error: `신청 가능 시간이 지났습니다. (당일 ${mealLabel} 신청은 ${deadline.hour}시 ${String(deadline.minute).padStart(2, "0")}분까지 가능)`,
      });
    }

    const isContractor = req.user.employeeType === "contractor";
    let headcount = 1;
    if (isContractor) {
      const n = parseInt(req.body.headcount, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9999) {
        return res.status(400).json({ error: "인원수는 1 이상 9999 이하의 숫자로 입력해주세요." });
      }
      headcount = n;
    }

    await Reservation.findOneAndUpdate(
      { employeeId: req.user.employeeId, date, mealType },
      {
        $set: {
          status: "applied",
          employeeName: req.user.name,
          department: req.user.department,
          modifiedByAdmin: false,
          headcount,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true, headcount });
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
    const deadline = await getDeadline(mealType);
    if (!isCancelAllowed(date, new Date(), deadline)) {
      const today = todayKSTStr();
      const mealLabel = mealType === "lunch" ? "중식" : "석식";
      const message =
        date < today
          ? "지난 날짜의 신청은 취소할 수 없습니다."
          : `취소 가능 시간이 지났습니다. (당일 ${mealLabel} 취소는 ${deadline.hour}시 ${String(deadline.minute).padStart(2, "0")}분까지 가능하며, 이후에는 관리자에게 문의해주세요.)`;
      return res.status(403).json({ error: message });
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

// 도급(단체) 계정이 총원(TO)이 틀렸을 때 관리자에게 수정을 요청 (본인 계정만 가능, 관리자 승인 필요)
router.post("/headcount-request", async (req, res) => {
  try {
    if (req.user.employeeType !== "contractor") {
      return res.status(403).json({ error: "도급(단체) 계정만 총원 수정을 요청할 수 있습니다." });
    }
    const n = parseInt(req.body.requestedHeadcount, 10);
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      return res.status(400).json({ error: "총원은 0 이상 9999 이하의 숫자로 입력해주세요." });
    }
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 300) : "";
    const emp = await Employee.findOneAndUpdate(
      { employeeId: req.user.employeeId },
      { $set: { requestedHeadcount: n, requestedHeadcountNote: note, requestedHeadcountAt: new Date() } },
      { new: true }
    );
    if (!emp) return res.status(404).json({ error: "계정 정보를 찾을 수 없습니다." });
    res.json({
      ok: true,
      requestedHeadcount: emp.requestedHeadcount,
      requestedHeadcountNote: emp.requestedHeadcountNote,
      requestedHeadcountAt: emp.requestedHeadcountAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "요청 처리 중 오류가 발생했습니다." });
  }
});

module.exports = router;
