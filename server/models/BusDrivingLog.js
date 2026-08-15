const mongoose = require("mongoose");

// 기사가 남기는 일일 운행 일지. 날짜/운행구분/차량 조합마다 하나씩 존재하며,
// 매일 08:00에 전날 기록을 모아 관리자에게 이메일로 발송하는 데 사용됩니다.
const busDrivingLogSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "YYYY-MM-DD" (KST 기준, 실제 운행한 날짜)
    tripType: { type: String, enum: ["commute", "regularLeave", "extendedLeave"], required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
    driverEmployeeId: { type: String, default: "" },
    driverName: { type: String, default: "" },
    operated: { type: Boolean, default: null }, // true=운행함, false=운행하지 않음, null=아직 기록 안 함
    actualHeadcount: { type: Number, default: null, min: 0 }, // 실제 탑승 인원
    note: { type: String, default: "", trim: true },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

busDrivingLogSchema.index({ date: 1, tripType: 1, vehicleId: 1 }, { unique: true });

module.exports = mongoose.model("BusDrivingLog", busDrivingLogSchema);
