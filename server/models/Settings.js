const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    deadlineHour: { type: Number, default: 9 }, // 당일 신청 마감 시(0~23)
    deadlineMinute: { type: Number, default: 30 }, // 당일 신청 마감 분(0~59)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
