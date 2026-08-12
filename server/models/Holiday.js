const mongoose = require("mongoose");

// 관리자가 직접 등록하는 공휴일(설날/추석 연휴, 대체공휴일, 임시공휴일 등)입니다.
// 매년 날짜가 고정된 양력 공휴일(신정, 삼일절 등)은 dateUtil.js의 FIXED_HOLIDAYS_MMDD에서 자동으로 처리되므로
// 여기에는 음력 기준이라 해마다 날짜가 바뀌는 공휴일이나, 그 해에만 지정된 임시공휴일만 등록하면 됩니다.
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
    label: { type: String, default: "" }, // 예: "설날 연휴", "추석 연휴", "대체공휴일"
  },
  { timestamps: true }
);

module.exports = mongoose.model("Holiday", holidaySchema);
