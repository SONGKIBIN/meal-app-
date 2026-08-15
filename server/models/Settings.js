const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    // 중식(점심) 당일 신청/취소 마감 시각 - 기본 09:30
    lunchDeadlineHour: { type: Number, default: 9 },
    lunchDeadlineMinute: { type: Number, default: 30 },
    // 석식(저녁) 당일 신청/취소 마감 시각 - 기본 14:00 (중식보다 늦은 시각으로 별도 설정 가능)
    dinnerDeadlineHour: { type: Number, default: 14 },
    dinnerDeadlineMinute: { type: Number, default: 0 },
    // 통근버스 기능 전체 공개 여부. 기본값 false(비공개 개발자 모드)이며, 마스터 관리자만
    // 비밀번호 재확인 후 켤 수 있습니다. false인 동안에도 마스터 관리자 본인은 항상 미리보기로 사용할 수 있습니다.
    busSystemEnabled: { type: Boolean, default: false },
    // 마스터 관리자가 남겨두는 오픈 예정 메모(예: "9월 1일 오픈 예정"). 화면에만 표시되는 참고용 텍스트입니다.
    busSystemNote: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
