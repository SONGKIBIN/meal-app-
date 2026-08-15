const mongoose = require("mongoose");

// 통근버스 코스(노선). 예: 평택버스(평택,공도,내리), 공도버스(공도,내리), 안성버스(안성시내).
// stops는 탑승 정류장 목록이며, 관리자/마스터가 코스를 자유롭게 추가·수정·삭제할 수 있습니다.
const busRouteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // 코스 이름 (예: 평택버스)
    stops: { type: [String], default: [] }, // 정류장 목록 (예: ["평택", "공도", "내리"])
    order: { type: Number, default: 0 }, // 화면 표시 순서
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

busRouteSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("BusRoute", busRouteSchema);
