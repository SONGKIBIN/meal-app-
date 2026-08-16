const express = require("express");
const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

router.use(requireAuth);

// 프론트엔드에서 구독을 생성할 때 필요한 VAPID 공개키
router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

// 알림 구독 등록/갱신
router.post("/subscribe", async (req, res) => {
  try {
    const { subscription } = req.body;
    const endpoint = subscription && typeof subscription.endpoint === "string" ? subscription.endpoint.trim() : "";
    const p256dh = subscription && subscription.keys && typeof subscription.keys.p256dh === "string" ? subscription.keys.p256dh : "";
    const auth = subscription && subscription.keys && typeof subscription.keys.auth === "string" ? subscription.keys.auth : "";
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "잘못된 구독 정보입니다." });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          employeeId: req.user.employeeId,
          name: req.user.name,
          role: req.user.role,
          endpoint,
          keys: { p256dh, auth },
        },
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "구독 저장 중 오류가 발생했습니다." });
  }
});

// 알림 구독 해지
router.post("/unsubscribe", async (req, res) => {
  try {
    const endpoint = typeof req.body.endpoint === "string" ? req.body.endpoint.trim() : "";
    if (endpoint) await PushSubscription.deleteOne({ endpoint });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "구독 해지 중 오류가 발생했습니다." });
  }
});

module.exports = router;
