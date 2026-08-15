const mongoose = require("mongoose");

// 통근버스 차량. 하나의 코스(BusRoute)에 여러 대의 차량이 배정될 수 있습니다(기본은 코스당 1대).
const vehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // 차량 이름/호차 (예: 평택 1호차)
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "BusRoute", required: true },
    driverEmployeeId: { type: String, default: "", trim: true }, // 배정된 기사 사번 (없으면 미배정)
    capacity: { type: Number, default: null, min: 0 }, // 정원 (선택, 참고용)
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

vehicleSchema.index({ routeId: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
