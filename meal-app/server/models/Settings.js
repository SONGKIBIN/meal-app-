const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    // 중식(점심) 당일 신청/취소 마감 시각 - 기본 09:30
    lunchDeadlineHour: { type: Number, default: 9 },
    lunchDeadlineMinute: { type: Number, default: 30 },
    // 석식(저녁) 당일 신청/취소 마감 시각 - 기본 14:00 (중식보다 늦은 시각으로 별도 설정 가능)
    dinnerDeadlineHour: { type: Number, default: 14 },
    dinnerDeadlineMinute: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
