const express = require("express");
const webpush = require("web-push");
const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const PushSubscription = require("../models/PushSubscription");
const NotificationLog = require("../models/NotificationLog");
const {
  getKSTParts,
  LUNCH_DEADLINE_HOUR,
  LUNCH_DEADLINE_MINUTE,
  DINNER_DEADLINE_HOUR,
  DINNER_DEADLINE_MINUTE,
} = require("../utils/dateUtil");

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
    const lunchDeadline = await getDeadline("lunch");
    const dinnerDeadline = await getDeadline("dinner");
    const lunchDeadlineMinutes = lunchDeadline.hour * 60 + lunchDeadline.minute;
    const dinnerDeadlineMinutes = dinnerDeadline.hour * 60 + dinnerDeadline.minute;
    const lunchReminderMinutes = lunchDeadlineMinutes - REMINDER_MINUTES_BEFORE;
    const dinnerReminderMinutes = dinnerDeadlineMinutes - REMINDER_MINUTES_BEFORE;

    const results = { reminderLunch: "skip", reminderDinner: "skip", dailySummary: "skip" };

    // 1) 중식 마감 임박 알림: (중식 마감 30분 전) ~ (중식 마감 시각) 사이 최초 1회, 중식 미신청 직원에게만 발송
    if (nowMinutes >= lunchReminderMinutes && nowMinutes < lunchDeadlineMinutes) {
      if (await markSentOnce(today, "reminder_lunch")) {
        const employees = await Employee.find({ active: true }).lean();
        const applied = await Reservation.find({ date: today, status: "applied", mealType: "lunch" }).lean();
        const appliedLunch = new Set(applied.map((r) => r.employeeId));
        const pendingIds = employees.filter((e) => !appliedLunch.has(e.employeeId)).map((e) => e.employeeId);
        if (pendingIds.length) {
          const subs = await PushSubscription.find({ employeeId: { $in: pendingIds } }).lean();
          await sendToSubscriptions(subs, {
            title: "중식 신청 마감 임박",
            body: `오늘 중식 신청 마감이 ${REMINDER_MINUTES_BEFORE}분 남았습니다. 아직 신청하지 않으셨다면 지금 신청해주세요.`,
            url: "/",
          });
        }
        results.reminderLunch = "sent";
      }
    }

    // 2) 석식 마감 임박 알림: (석식 마감 30분 전) ~ (석식 마감 시각) 사이 최초 1회, 석식 미신청 직원에게만 발송
    if (nowMinutes >= dinnerReminderMinutes && nowMinutes < dinnerDeadlineMinutes) {
      if (await markSentOnce(today, "reminder_dinner")) {
        const employees = await Employee.find({ active: true }).lean();
        const applied = await Reservation.find({ date: today, status: "applied", mealType: "dinner" }).lean();
        const appliedDinner = new Set(applied.map((r) => r.employeeId));
        const pendingIds = employees.filter((e) => !appliedDinner.has(e.employeeId)).map((e) => e.employeeId);
        if (pendingIds.length) {
          const subs = await PushSubscription.find({ employeeId: { $in: pendingIds } }).lean();
          await sendToSubscriptions(subs, {
            title: "석식 신청 마감 임박",
            body: `오늘 석식 신청 마감이 ${REMINDER_MINUTES_BEFORE}분 남았습니다. 아직 신청하지 않으셨다면 지금 신청해주세요.`,
            url: "/",
          });
        }
        results.reminderDinner = "sent";
      }
    }

    // 3) 관리자 일일 집계 알림: 중식/석식 마감시간이 서로 다르므로, 더 늦은 마감시간이 지난 이후
    //    최초 1회 관리자에게 오늘자 최종 집계를 발송합니다.
    const finalDeadlineMinutes = Math.max(lunchDeadlineMinutes, dinnerDeadlineMinutes);
    if (nowMinutes >= finalDeadlineMinutes) {
      if (await markSentOnce(today, "dailySummary")) {
        const applied = await Reservation.find({ date: today, status: "applied" }).lean();
        const sumHeadcount = (list) => list.reduce((s, r) => s + (r.headcount ?? 1), 0);
        const lunchCount = sumHeadcount(applied.filter((r) => r.mealType === "lunch"));
        const dinnerCount = sumHeadcount(applied.filter((r) => r.mealType === "dinner"));
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
