const mongoose = require("mongoose");

// 식사 만족도 평가(별점). 식사를 신청한 사람만, 정해진 시간대(중식 12:00~13:00 / 석식 17:00~18:00)
// 안에서만 남길 수 있습니다. 별 1개=20점 ~ 별 5개=100점으로 환산해서 관리자 화면에서 부서별로 집계합니다.
const mealRatingSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: "" },
    date: { type: String, required: true }, // "YYYY-MM-DD" (KST 기준, 평가 대상 날짜)
    mealType: { type: String, enum: ["lunch", "dinner"], required: true }, // lunch=중식, dinner=석식
    stars: { type: Number, required: true, min: 1, max: 5 }, // 별 1~5개
    score: { type: Number, required: true, min: 20, max: 100 }, // 별 1개=20점 ~ 별 5개=100점으로 환산한 점수
    // 별점을 남긴 이유(사유). 반드시 입력해야만 평가가 등록됩니다.
    reason: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// 같은 직원이 같은 날짜/같은 끼니에 중복으로 평가를 남기지 않도록 유일 인덱스를 설정합니다.
// (평가 가능 시간대 안에서는 재제출 시 기존 평가를 덮어씁니다.)
mealRatingSchema.index({ employeeId: 1, date: 1, mealType: 1 }, { unique: true });
mealRatingSchema.index({ date: 1, mealType: 1 });
mealRatingSchema.index({ department: 1, date: 1, mealType: 1 });

module.exports = mongoose.model("MealRating", mealRatingSchema);
