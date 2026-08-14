const express = require("express");
const webpush = require("web-push");
const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const PushSubscription = require("../models/PushSubscription");
const NotificationLog = require("../models/NotificationLog");
const { getKSTParts, DEADLINE_HOUR, DEADLINE_MINUTE } = require("../utils/dateUtil");

const router = express.Router();
const REMINDER_MINUTES_BEFORE = 30; // 마감 몇 분 전에 임박 알림을 보낼지

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendToSubscriptions(subs, payload) {
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
          console.error("[push] 발송 실패:", err.message);
        }
      }
    })
  );
}

async function getDeadline() {
  const s = await Settings.findOne({ key: "global" }).lean();
  if (s && Number.isInteger(s.deadlineHour) && Number.isInteger(s.deadlineMinute)) {
    return { hour: s.deadlineHour, minute: s.deadlineMinute };
  }
  return { hour: DEADLINE_HOUR, minute: DEADLINE_MINUTE };
}

// date+type 조합이 처음 기록되는 경우에만 true를 반환합니다.
// (unique 인덱스 충돌 시 이미 발송된 것으로 간주하여 중복 발송을 막습니다.)
async function markSentOnce(date, type) {
  try {
    await NotificationLog.create({ date, type });
    return true;
  } catch (err) {
    return false;
  }
}

// 외부 무료 크론 서비스(cron-job.org 등)가 주기적으로(예: 10~15분마다) 호출하는 엔드포인트입니다.
// Render 무료 요금제는 자체 스케줄러가 없기 때문에 외부에서 주기적으로 이 URL을 호출해주어야
// "마감 임박 알림"과 "관리자 일일 집계 알림"이 정상적으로 동작합니다.
// CRON_SECRET 환경변수가 설정되어 있으면 secret 쿼리 파라미터가 일치해야만 동작합니다.
router.get("/tick", async (req, res) => {
  try {
    if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.json({ ok: true, skipped: "VAPID 키가 설정되지 않아 알림 기능이 비활성화되어 있습니다." });
    }

    const parts = getKSTParts(new Date());
    const today = parts.dateStr;
    const nowMinutes = parts.hour * 60 + parts.minute;
    const deadline = await getDeadline();
    const deadlineMinutes = deadline.hour * 60 + deadline.minute;
    const reminderMinutes = deadlineMinutes - REMINDER_MINUTES_BEFORE;

    const results = { reminder: "skip", dailySummary: "skip" };

    // 1) 마감 임박 알림: (마감 30분 전) ~ (마감 시각) 사이 최초 1회, 아직 신청하지 않은 직원에게만 발송
    if (nowMinutes >= reminderMinutes && nowMinutes < deadlineMinutes) {
      if (await markSentOnce(today, "reminder")) {
        const employees = await Employee.find({ active: true }).lean();
        const applied = await Reservation.find({ date: today, status: "applied" }).lean();
        const appliedLunch = new Set(applied.filter((r) => r.mealType === "lunch").map((r) => r.employeeId));
        const appliedDinner = new Set(applied.filter((r) => r.mealType === "dinner").map((r) => r.employeeId));
        const pendingIds = employees
          .filter((e) => !appliedLunch.has(e.employeeId) || !appliedDinner.has(e.employeeId))
          .map((e) => e.employeeId);
        if (pendingIds.length) {
          const subs = await PushSubscription.find({ employeeId: { $in: pendingIds } }).lean();
          await sendToSubscriptions(subs, {
            title: "식사 신청 마감 임박",
            body: `오늘 신청 마감이 ${REMINDER_MINUTES_BEFORE}분 남았습니다. 아직 신청하지 않으셨다면 지금 신청해주세요.`,
            url: "/",
          });
        }
        results.reminder = "sent";
      }
    }

    // 2) 관리자 일일 집계 알림: 마감 시각 이후 최초 1회, 관리자에게 오늘자 집계를 발송
    if (nowMinutes >= deadlineMinutes) {
      if (await markSentOnce(today, "dailySummary")) {
        const applied = await Reservation.find({ date: today, status: "applied" }).lean();
        const lunchCount = applied.filter((r) => r.mealType === "lunch").length;
        const dinnerCount = applied.filter((r) => r.mealType === "dinner").length;
        const adminSubs = await PushSubscription.find({ role: "admin" }).lean();
        await sendToSubscriptions(adminSubs, {
          title: `${today} 식사 신청 집계`,
          body: `중식 ${lunchCount}명 / 석식 ${dinnerCount}명 신청되었습니다.`,
          url: "/",
        });
        results.dailySummary = "sent";
      }
    }

    res.json({ ok: true, date: today, ...results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "크론 처리 중 오류가 발생했습니다." });
  }
});

module.exports = router;
