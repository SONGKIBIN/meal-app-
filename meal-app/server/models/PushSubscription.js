const mongoose = require("mongoose");

// 브라우저(Web Push) 알림 구독 정보를 저장합니다.
// 관리자/직원이 "휴대폰 알림 받기" 버튼을 누르면 이 컬렉션에 저장됩니다.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    name: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
