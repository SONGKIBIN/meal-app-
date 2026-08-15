const mongoose = require("mongoose");

// 특정 날짜/운행 구분(출근·정시퇴근·연장퇴근)/차량에 대해 관리자가 직접 지정한 운행 여부입니다.
// 평일(월~금, 공휴일 아님)은 이 레코드가 없어도 기본적으로 운행하는 것으로 간주하고,
// 특근일·대체휴무일·토요일·일요일·공휴일 등은 이 레코드로 명시적으로 켜줘야만 운행됩니다.
// (레코드가 있으면 평일이라도 그 값이 항상 우선합니다 - 관리자가 평일 휴무를 지정할 수도 있으므로)
const busOperationDaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "YYYY-MM-DD" (KST 기준)
    tripType: { type: String, enum: ["commute", "regularLeave", "extendedLeave"], required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
    enabled: { type: Boolean, required: true },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

busOperationDaySchema.index({ date: 1, tripType: 1, vehicleId: 1 }, { unique: true });

module.exports = mongoose.model("BusOperationDay", busOperationDaySchema);
