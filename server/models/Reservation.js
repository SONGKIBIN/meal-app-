const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: "" },
    date: { type: String, required: true }, // "YYYY-MM-DD" (KST 기준)
    mealType: { type: String, enum: ["lunch", "dinner"], required: true }, // lunch=중식, dinner=석식
    status: { type: String, enum: ["applied", "cancelled"], default: "applied" },
    modifiedByAdmin: { type: Boolean, default: false },
    // 도급회사(단체) 계정이 한 번에 신청하는 인원수. 개인 직원은 항상 1입니다.
    headcount: { type: Number, default: 1, min: 0 },
    // 신청자가 함께 추가로 등록한 손님/내방객 인원수 (개인 직원용, 도급 계정은 사용하지 않음).
    // 집계 시 개인/도급 인원과는 별도로 "내방객" 항목으로 구분해서 보여줍니다.
    guestCount: { type: Number, default: 0, min: 0 },
    // 명시적으로 "안 먹어요"를 선택한 인원수. status(applied/cancelled)와는 별개의 값으로,
    // 개인 직원은 항상 0 또는 1이고(한 사람이므로), 도급(단체) 계정은 총원 중 몇 명이 안 먹는지를
    // 숫자로 직접 입력합니다. 신청(headcount)과 안 먹음(declinedHeadcount)은 도급 계정의 경우
    // 동시에 존재할 수 있습니다(예: 총원 40명 중 35명 신청 + 5명 안 먹음 + 나머지는 미정).
    declinedHeadcount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// 같은 직원이 같은 날짜/같은 끼니에 중복 문서를 만들지 않도록 유일 인덱스 설정
reservationSchema.index({ employeeId: 1, date: 1, mealType: 1 }, { unique: true });
reservationSchema.index({ date: 1, mealType: 1, status: 1 });

module.exports = mongoose.model("Reservation", reservationSchema);
