// 이메일 발송 유틸 (nodemailer 기반). SMTP 환경변수(SMTP_HOST/SMTP_USER/SMTP_PASS)가 설정되지 않으면
// 기능이 자동으로 비활성화되며, 발송을 시도하는 곳에서는 그냥 조용히 건너뜁니다(오류를 던지지 않음).
// 웹 푸시(VAPID)가 선택 기능인 것과 동일한 패턴입니다.
const nodemailer = require("nodemailer");

let transporter = null;
let attempted = false;

function getTransporter() {
  if (attempted) return transporter;
  attempted = true;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function isEmailConfigured() {
  return !!getTransporter();
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!t || !recipients.length) return { skipped: true };
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await t.sendMail({ from, to: recipients.join(","), subject, html, text });
    return { sent: true };
  } catch (err) {
    console.error("[mailer] 발송 실패:", err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendMail, isEmailConfigured };
