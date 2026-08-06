const express = require("express");
const Announcement = require("../models/Announcement");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// 현재 활성화된 공지 1개 조회 (로그인한 모든 사용자)
router.get("/active", async (req, res) => {
  const a = await Announcement.findOne({ active: true }).sort({ createdAt: -1 }).lean();
  res.json({ announcement: a || null });
});

module.exports = router;
