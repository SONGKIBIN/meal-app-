const mongoose = require("mongoose");

// 직원이 트립타입(출근운행/정시퇴근운행/연장퇴근운행)별로 "평소 매일 타는 차량"을 한 번 등록해두면,
// 그 뒤로는 평일(기본 운행일)마다 별도 신청 없이 자동으로 탑승자 명단에 포함됩니다.
// 특정 날짜에 못 타는 경우에만 BusRide에 "취소" 기록을 남기는 예외 처리 방식이며,
// 주말/공휴일 등 기본 운행일이 아닌 날에는 이 기본 등록이 자동 적용되지 않고
// (관리자가 그 차량의 운행을 켜준 경우에 한해) 직원이 그때그때 명시적으로 신청해야 합니다.
const busDefaultRideSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: "" },
    tripType: { type: String, enum: ["commute", "regularLeave", "extendedLeave"], required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "BusRoute", required: true },
    routeName: { type: String, default: "" }, // 등록 시점 코스명 스냅샷
    vehicleName: { type: String, default: "" }, // 등록 시점 차량명 스냅샷
    stop: { type: String, default: "", trim: true }, // 기본 탑승 정류장
    // 도급(단체) 계정이 매일 자동으로 집계될 인원수. 개인 직원은 항상 1입니다.
    headcount: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true }
);

// 한 사람이 같은 운행 구분에 기본 차량을 중복 등록하지 않도록 유일 인덱스 설정
busDefaultRideSchema.index({ employeeId: 1, tripType: 1 }, { unique: true });
busDefaultRideSchema.index({ tripType: 1, vehicleId: 1 });

module.exports = mongoose.model("BusDefaultRide", busDefaultRideSchema);
