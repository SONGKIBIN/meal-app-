const express = require("express");
const webpush = require("web-push");
const Employee = require("../models/Employee");
const Reservation = require("../models/Reservation");
const Settings = require("../models/Settings");
const PushSubscription = require("../models/PushSubscription");
const NotificationLog = require("../models/NotificationLog");
const Vehicle = require("../models/Vehicle");
const BusRide = require("../models/BusRide");
const BusDefaultRide = require("../models/BusDefaultRide");
const BusDrivingLog = require("../models/BusDrivingLog");
const { cleanupOldMenus } = require("./menu");
const { sendMail } = require("../utils/mailer");
const {
  getKSTParts,
  addDays,
  LUNCH_DEADLINE_HOUR,
  LUNCH_DEADLINE_MINUTE,
  DINNER_DEADLINE_HOUR,
  DINNER_DEADLINE_MINUTE,
} = require("../utils/dateUtil");
const { TRIP_TYPES, resolveOperationMap, isDefaultOperatingDayBulk } = require("../utils/busOperation");
const { computeRiders } = require("../utils/busRiders");

const router = express.Router();
const REMINDER_MINUTES_BEFORE = 30; // 마감 몇 분 전에 임박 알림을 보낼지
const MASTER_ADMIN_ID = process.env.ADMIN_EMPLOYEE_ID || "admin";
const TRIP_LABEL = { commute: "출근운행", regularLeave: "정시퇴근운행", extendedLeave: "연장퇴근운행" };
const BUS_LOG_EMAIL_HOUR = 8; // 통근버스 전일 운행일지를 이메일로 보내는 시각(KST)

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

    const parts = getKSTParts(new Date());
    const today = parts.dateStr;
    const nowMinutes = parts.hour * 60 + parts.minute;

    const results = {
      menuCleanup: "skip",
      reminderLunch: "skip",
      reminderDinner: "skip",
      dailySummary: "skip",
      dailySummaryEmail: "skip",
      busDailyLogEmail: "skip",
    };

    // 이메일 발송은 웹 푸시(VAPID) 설정 여부와 무관하게 동작해야 하므로, 마감시간은 여기서 먼저 계산해둡니다.
    const lunchDeadline = await getDeadline("lunch");
    const dinnerDeadline = await getDeadline("dinner");
    const lunchDeadlineMinutes = lunchDeadline.hour * 60 + lunchDeadline.minute;
    const dinnerDeadlineMinutes = dinnerDeadline.hour * 60 + dinnerDeadline.minute;
    const finalDeadlineMinutes = Math.max(lunchDeadlineMinutes, dinnerDeadlineMinutes);

    // 0-2) 관리자 일일 집계 이메일: 이메일을 등록한 관리자(role=admin)에게 중식/석식 마감시간이 모두 지난 뒤
    //      최초 1회 오늘자 최종 집계를 이메일로 통보합니다 (웹 푸시와 별개로 동작).
    if (nowMinutes >= finalDeadlineMinutes) {
      if (await markSentOnce(today, "dailySummaryEmail")) {
        try {
          const admins = await Employee.find({ role: "admin", email: { $nin: ["", null] } }).lean();
          const emails = admins.map((a) => a.email).filter(Boolean);
          if (emails.length) {
            const applied = await Reservation.find({ date: today, status: "applied" }).lean();
            const sumHeadcount = (list) => list.reduce((s, r) => s + (r.headcount ?? 1), 0);
            const lunchCount = sumHeadcount(applied.filter((r) => r.mealType === "lunch"));
            const dinnerCount = sumHeadcount(applied.filter((r) => r.mealType === "dinner"));
            const mailResult = await sendMail({
              to: emails,
              subject: `[식수신청] ${today} 신청 집계`,
              html: `<p><b>${today}</b> 식사 신청 집계입니다.</p><p>중식 ${lunchCount}명 / 석식 ${dinnerCount}명 신청되었습니다.</p>`,
            });
            if (!mailResult.sent) {
              console.error("[cron] 일일 집계 이메일 발송 실패:", mailResult.error || mailResult);
            }
            results.dailySummaryEmail = mailResult.sent ? "sent" : "error";
          } else {
            results.dailySummaryEmail = "skipped";
          }
        } catch (err) {
          console.error("[cron] 일일 집계 이메일 처리 중 오류:", err.message);
          results.dailySummaryEmail = "error";
        }
      }
    }

    // 0-1) 통근버스 전일 운행일지 이메일: 매일 08:00 이후 최초 1회, 마스터 관리자 + 통근 차량 관리 관리자 중
    //      이메일을 등록한 사람에게 전날(어제)치 출근/정시퇴근/연장퇴근 운행 결과를 요약해 보냅니다.
    //      웹 푸시와 달리 SMTP 설정이 없어도 항상 시도해보고(mailer.js가 자동으로 스킵), 메일 발송 자체가
    //      실패해도 다른 크론 작업에 영향을 주지 않도록 별도로 처리합니다.
    {
      const partsNow = getKSTParts(new Date());
      const nowMin = partsNow.hour * 60 + partsNow.minute;
      const startMin = BUS_LOG_EMAIL_HOUR * 60;
      if (nowMin >= startMin && nowMin < startMin + 10) {
        if (await markSentOnce(today, "busDailyLogEmail")) {
          try {
            const recipients = await Employee.find({
              $or: [{ employeeId: MASTER_ADMIN_ID }, { busAdmin: true }],
              email: { $nin: ["", null] },
            }).lean();
            const emails = recipients.map((e) => e.email).filter(Boolean);
            if (emails.length) {
              const yesterday = addDays(today, -1);
              const vehicles = await Vehicle.find({ active: true }).populate("routeId").lean();
              const vehicleIds = vehicles.map((v) => String(v._id));
              const { map: opMap } = await resolveOperationMap(yesterday, vehicleIds);
              const isDefaultDay = (await isDefaultOperatingDayBulk([yesterday]))[yesterday];
              const [allDefaults, explicitForDate, logs] = await Promise.all([
                vehicleIds.length ? BusDefaultRide.find({ vehicleId: { $in: vehicleIds } }).lean() : [],
                vehicleIds.length ? BusRide.find({ date: yesterday, vehicleId: { $in: vehicleIds } }).lean() : [],
                BusDrivingLog.find({ date: yesterday, vehicleId: { $in: vehicleIds } }).lean(),
              ]);
              const headcountMap = new Map();
              for (const tripType of TRIP_TYPES) {
                const ridersByVehicle = computeRiders(tripType, vehicleIds, opMap, isDefaultDay, allDefaults, explicitForDate);
                for (const vId of vehicleIds) {
                  const count = (ridersByVehicle[vId] || []).reduce((sum, r) => sum + (r.headcount || 1), 0);
                  headcountMap.set(`${vId}_${tripType}`, count);
                }
              }
              const logMap = new Map(logs.map((l) => [`${String(l.vehicleId)}_${l.tripType}`, l]));

              let rowsHtml = "";
              for (const v of vehicles) {
                for (const tripType of TRIP_TYPES) {
                  const key = `${String(v._id)}_${tripType}`;
                  const applied = headcountMap.get(key) || 0;
                  const log = logMap.get(key);
                  const operatedText = !log || log.operated === null ? "미기록" : log.operated ? "운행함" : "운행 안함";
                  const actualText = log && log.actualHeadcount !== null && log.actualHeadcount !== undefined ? log.actualHeadcount : "-";
                  if (!applied && !log) continue; // 신청도 기록도 없는 조합은 생략
                  rowsHtml += `<tr><td>${v.routeId ? v.routeId.name : ""}</td><td>${v.name}</td><td>${TRIP_LABEL[tripType]}</td><td>${applied}</td><td>${operatedText}</td><td>${actualText}</td><td>${(log && log.note) || ""}</td></tr>`;
                }
              }
              const html = `
                <h3>${yesterday} 통근버스 운행일지</h3>
                <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                  <tr style="background:#f1f5f9;"><th>코스</th><th>차량</th><th>운행구분</th><th>신청인원</th><th>실제 운행</th><th>실제 인원</th><th>메모</th></tr>
                  ${rowsHtml || '<tr><td colspan="7">기록이 없습니다.</td></tr>'}
                </table>`;
              const mailResult = await sendMail({ to: emails, subject: `[통근버스] ${yesterday} 운행일지`, html });
              if (!mailResult.sent) {
                console.error("[cron] 통근버스 운행일지 이메일 발송 실패:", mailResult.error || mailResult);
              }
              results.busDailyLogEmail = mailResult.sent ? "sent" : "error";
            } else {
              results.busDailyLogEmail = "skipped";
            }
          } catch (err) {
            console.error("[cron] 통근버스 운행일지 이메일 처리 중 오류:", err.message);
            results.busDailyLogEmail = "error";
          }
        }
      }
    }

    // 0) 오래된 식단표 자동 정리: 하루 1회, 푸시 알림(VAPID) 설정 여부와 관계없이 항상 동작합니다.
    if (await markSentOnce(today, "menuCleanup")) {
      const deleted = await cleanupOldMenus();
      results.menuCleanup = `done(${deleted})`;
    }

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.json({ ok: true, date: today, ...results, pushSkipped: "VAPID 키가 설정되지 않아 알림 기능이 비활성화되어 있습니다." });
    }

    const lunchReminderMinutes = lunchDeadlineMinutes - REMINDER_MINUTES_BEFORE;
    const dinnerReminderMinutes = dinnerDeadlineMinutes - REMINDER_MINUTES_BEFORE;

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

    // 3) 관리자 일일 집계 알림(웹 푸시): 중식/석식 마감시간이 서로 다르므로, 더 늦은 마감시간이 지난 이후
    //    최초 1회 관리자에게 오늘자 최종 집계를 발송합니다.
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
