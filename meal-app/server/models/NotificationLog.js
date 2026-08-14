const mongoose = require("mongoose");

// 하루에 한 번씩만 보내야 하는 알림(마감 임박 알림, 관리자 일일 집계 알림)이
// 외부 크론 핑에 의해 여러 번 실행되더라도 중복 발송되지 않도록 기록해두는 로그입니다.
const notificationLogSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // KST 기준 YYYY-MM-DD
    type: { type: String, required: true }, // 'reminder' | 'dailySummary'
  },
  { timestamps: true }
);
notificationLogSchema.index({ date: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
