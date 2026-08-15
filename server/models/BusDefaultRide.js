const mongoose = require("mongoose");

// 직원이 트립타입(출근운행/정시퇴근운행/연장퇴근운행)별로 "평소 타는 차량"을 한 번만 등록해두면
// 이후에는 그 등록이 그대로 고정됩니다(요일별로 다르게 등록하지 않음 - 필요하면 언제든 다시
// 등록해서 수정할 수 있습니다). 실제로 자동 탑승 처리되는지 여부는 트립타입마다 다릅니다:
// - "commute"(출근): 기본 운행일(평일, 공휴일 아님)마다 이 등록이 자동으로 탑승자 명단에 포함됩니다.
//   특정 날짜에 못 타는 경우에만 BusRide에 "취소" 기록을 남기는 건별 예외 처리 방식입니다.
// - "regularLeave"/"extendedLeave"(정시퇴근/연장퇴근): 하루에 퇴근은 한 번뿐이므로 자동 탑승되지
//   않습니다. 이 등록은 "평소 타는 차"를 기억해두는 참고용이며, 실제 탑승 여부는 그날그날
//   BusRide로 직접 신청해야 합니다(둘 중 하나만 신청 가능 - server/utils/busOperation.js의
//   MUTUALLY_EXCLUSIVE_TRIP_GROUPS 참고).
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
