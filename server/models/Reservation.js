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
  },
  { timestamps: true }
);

// 같은 직원이 같은 날짜/같은 끼니에 중복 문서를 만들지 않도록 유일 인덱스 설정
reservationSchema.index({ employeeId: 1, date: 1, mealType: 1 }, { unique: true });
reservationSchema.index({ date: 1, mealType: 1, status: 1 });

module.exports = mongoose.model("Reservation", reservationSchema);
