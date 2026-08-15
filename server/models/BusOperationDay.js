const mongoose = require("mongoose");

// 특정 날짜/운행 구분(출근·정시퇴근·연장퇴근)/차량에 대해 관리자가 직접 지정한 운행 여부입니다.
// 모든 날짜(평일/주말/공휴일 구분 없이)는 이 레코드가 없어도 기본적으로 "운행함"으로 간주합니다.
// 이 레코드는 예외적으로 그 날짜에 운행하지 않음(또는 다시 운행함)을 명시적으로 지정할 때만 사용됩니다.
// (레코드가 있으면 그 값이 항상 우선합니다 - enabled:false로 특정 날짜 운행 취소, enabled:true로 재개 등)
// 참고: 직원의 "내가 타는 차" 기본 등록이 자동으로 탑승 처리되는지 여부는 이 레코드와 무관하며,
// server/utils/busOperation.js의 isDefaultOperatingDay(평일+비공휴일만 해당)로 별도 판단합니다.
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
