const mongoose = require("mongoose");

// 통근버스 승차 신청. 개인 직원은 headcount=1 고정이고, 도급(단체) 계정은 식수 신청과 동일하게
// 인원수를 직접 입력해 일괄 신청합니다 (개별 좌석/이름 관리 대신 인원수만 집계).
const busRideSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: "" },
    date: { type: String, required: true }, // "YYYY-MM-DD" (KST 기준)
    tripType: { type: String, enum: ["commute", "regularLeave", "extendedLeave"], required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "BusRoute", required: true },
    routeName: { type: String, default: "" }, // 신청 시점 코스명 스냅샷 (코스명이 나중에 바뀌어도 기록 유지)
    vehicleName: { type: String, default: "" }, // 신청 시점 차량명 스냅샷
    stop: { type: String, default: "", trim: true }, // 탑승 정류장
    status: { type: String, enum: ["applied", "cancelled"], default: "applied" },
    // 도급(단체) 계정이 한 번에 신청하는 인원수. 개인 직원은 항상 1입니다.
    headcount: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true }
);

// 한 사람이 같은 날짜/같은 운행 구분에 중복 신청하지 않도록 유일 인덱스 설정
busRideSchema.index({ employeeId: 1, date: 1, tripType: 1 }, { unique: true });
busRideSchema.index({ date: 1, tripType: 1, vehicleId: 1, status: 1 });

module.exports = mongoose.model("BusRide", busRideSchema);
