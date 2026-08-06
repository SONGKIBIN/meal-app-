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
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: "잘못된 구독 정보입니다." });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          employeeId: req.user.employeeId,
          name: req.user.name,
          role: req.user.role,
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
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
    const { endpoint } = req.body;
    if (endpoint) await PushSubscription.deleteOne({ endpoint });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "구독 해지 중 오류가 발생했습니다." });
  }
});

module.exports = router;
