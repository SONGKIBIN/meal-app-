// 한국 표준시(KST, UTC+9) 기준으로 날짜/시간을 계산하는 유틸리티
// 서버가 어느 시간대(UTC 등)에서 돌아가더라도 항상 한국 시간 기준으로 동작하도록 합니다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * 주어진 시각(기본값: 현재)을 한국 시간 기준으로 분해합니다.
 */
function getKSTParts(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  const weekday = kst.getUTCDay(); // 0=일요일 ... 6=토요일
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    dateStr: `${year}-${pad(month)}-${pad(day)}`,
  };
}

function todayKSTStr() {
  return getKSTParts().dateStr;
}

/**
 * "YYYY-MM-DD" 문자열로부터 해당 날짜의 요일(0=일 ~ 6=토)을 구합니다.
 * 문자열을 UTC 자정으로 해석하여 날짜 계산에 시간대 오차가 없도록 합니다.
 */
function weekdayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.getUTCDay();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * 주어진 날짜가 속한 주(월요일~일요일)의 날짜 배열 7개를 반환합니다.
 */
function getWeekDates(dateStr) {
  const wd = weekdayOf(dateStr); // 0=일 ... 6=토
  const mondayOffset = wd === 0 ? -6 : 1 - wd; // 월요일까지 이동할 일수
  const monday = addDays(dateStr, mondayOffset);
  const week = [];
  for (let i = 0; i < 7; i++) {
    week.push(addDays(monday, i));
  }
  return week;
}

function getMonthDates(year, month) {
  // month: 1~12
  const first = `${year}-${pad(month)}-01`;
  const d = new Date(first + "T00:00:00Z");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = [];
  for (let i = 0; i < daysInMonth; i++) {
    dates.push(addDays(first, i));
  }
  return dates;
}

// 중식/석식은 마감시간이 서로 다를 수 있습니다 (예: 중식 09:30, 석식 14:00).
// 환경변수가 없으면 중식은 기존 기본값(09:30), 석식은 14:00을 기본값으로 사용합니다.
const LUNCH_DEADLINE_HOUR = parseInt(process.env.LUNCH_APPLY_DEADLINE_HOUR || process.env.APPLY_DEADLINE_HOUR || "9", 10);
const LUNCH_DEADLINE_MINUTE = parseInt(process.env.LUNCH_APPLY_DEADLINE_MINUTE || process.env.APPLY_DEADLINE_MINUTE || "30", 10);
const DINNER_DEADLINE_HOUR = parseInt(process.env.DINNER_APPLY_DEADLINE_HOUR || "14", 10);
const DINNER_DEADLINE_MINUTE = parseInt(process.env.DINNER_APPLY_DEADLINE_MINUTE || "0", 10);
// 이전 버전과의 호환을 위해 유지 (기본값은 중식 마감시각과 동일)
const DEADLINE_HOUR = LUNCH_DEADLINE_HOUR;
const DEADLINE_MINUTE = LUNCH_DEADLINE_MINUTE;

/**
 * 신청 가능 여부: 오늘보다 미래 날짜는 항상 가능,
 * 오늘 날짜는 마감시각(중식/석식 각각 다르게 설정 가능, 관리자가 설정에서 변경 가능) 이전까지만 가능, 과거 날짜는 불가능.
 * deadline: { hour, minute } - 생략 시 중식 기본값 사용 (호출하는 쪽에서 끼니별 마감시각을 넘겨주세요)
 */
function isApplyAllowed(dateStr, now = new Date(), deadline = {}) {
  const hour = Number.isInteger(deadline.hour) ? deadline.hour : LUNCH_DEADLINE_HOUR;
  const minute = Number.isInteger(deadline.minute) ? deadline.minute : LUNCH_DEADLINE_MINUTE;
  const today = todayKSTStr();
  if (dateStr > today) return true;
  if (dateStr < today) return false;
  const parts = getKSTParts(now);
  if (parts.hour < hour) return true;
  if (parts.hour === hour && parts.minute < minute) return true;
  return false;
}

/**
 * 취소 가능 여부: 신청과 동일한 규칙을 적용합니다.
 * 미래 날짜는 항상 취소 가능, 오늘 날짜는 마감시각 이전까지만 취소 가능, 과거 날짜는 취소 불가.
 * deadline: { hour, minute } - 생략 시 환경변수 기본값 사용
 */
function isCancelAllowed(dateStr, now = new Date(), deadline = {}) {
  return isApplyAllowed(dateStr, now, deadline);
}

module.exports = {
  getKSTParts,
  todayKSTStr,
  weekdayOf,
  addDays,
  getWeekDates,
  getMonthDates,
  isApplyAllowed,
  isCancelAllowed,
  DEADLINE_HOUR,
  DEADLINE_MINUTE,
  LUNCH_DEADLINE_HOUR,
  LUNCH_DEADLINE_MINUTE,
  DINNER_DEADLINE_HOUR,
  DINNER_DEADLINE_MINUTE,
};
