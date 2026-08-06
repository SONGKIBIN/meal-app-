const mongoose = require("mongoose");

const weeklyMenuSchema = new mongoose.Schema(
  {
    weekStart: { type: String, required: true, unique: true }, // 해당 주 월요일 "YYYY-MM-DD"
    imageData: { type: String, default: "" }, // data:image/...;base64,... 형태로 저장
    imageMime: { type: String, default: "" },
    note: { type: String, default: "" }, // 이미지 없이 텍스트로만 적을 수도 있음
  },
  { timestamps: true }
);

module.exports = mongoose.model("WeeklyMenu", weeklyMenuSchema);
