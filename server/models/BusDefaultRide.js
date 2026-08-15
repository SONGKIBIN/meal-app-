const mongoose = require("mongoose");

// 직원이 트립타입(출근운행/정시퇴근운행/연장퇴근운행) x 요일(월~금)별로 "평소 타는 차량"을 주간 단위로
// 등록해두면, 그 뒤로는 등록된 요일마다(공휴일이 아닌 한) 별도 신청 없이 자동으로 탑승자 명단에
// 포함됩니다. 요일마다 다른 차량을 등록할 수 있습니다(예: 월/수/금은 평택버스, 화/목은 안성버스).
// 특정 날짜에 못 타는 경우에만 BusRide에 "취소" 기록을 남기는 건별 예외 처리 방식이며,
// 주말/공휴일 등 기본 운행일이 아닌 날에는 이 기본 등록이 자동 적용되지 않고
// (관리자가 그 차량의 운행을 켜준 경우에 한해) 직원이 그때그때 명시적으로 신청해야 합니다.
const busDefaultRideSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: "" },
    tripType: { type: String, enum: ["commute", "regularLeave", "extendedLeave"], required: true },
    // 요일 (0=일요일 ~ 6=토요일, JS Date.getUTCDay()와 동일한 기준). 기본 등록 자동 적용은 평일(1~5)에만
    // 의미가 있으므로 화면에서는 월~금만 입력받지만, 값 자체는 0~6 범위를 모두 허용합니다.
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
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

// 한 사람이 같은 운행 구분 x 같은 요일에 기본 차량을 중복 등록하지 않도록 유일 인덱스 설정
busDefaultRideSchema.index({ employeeId: 1, tripType: 1, dayOfWeek: 1 }, { unique: true });
busDefaultRideSchema.index({ tripType: 1, dayOfWeek: 1, vehicleId: 1 });

module.exports = mongoose.model("BusDefaultRide", busDefaultRideSchema);
