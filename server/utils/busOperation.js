// 통근버스 운행 여부 계산 유틸.
// 평일(월~금)이고 공휴일이 아니면 기본적으로 운행하는 것으로 간주하고, 그 외(토/일/공휴일)에는
// 관리자가 BusOperationDay로 명시적으로 켜주지 않는 한 운행하지 않는 것으로 간주합니다.
// 평일이라도 관리자가 명시적으로 지정해두었다면(예: 회사 휴무) 그 지정값이 항상 우선합니다.
const Holiday = require("../models/Holiday");
const BusOperationDay = require("../models/BusOperationDay");
const { isWeekendDate, fixedHolidayLabel } = require("./dateUtil");

const TRIP_TYPES = ["commute", "regularLeave", "extendedLeave"];

async function isDefaultOperatingDay(date) {
  if (isWeekendDate(date)) return false;
  if (fixedHolidayLabel(date)) return false;
  const custom = await Holiday.findOne({ date }).lean();
  if (custom) return false;
  return true;
}

// 여러 날짜에 대해 한 번에 기본 운행 여부를 계산합니다 (주간 뷰 등에서 N+1 쿼리를 피하기 위함).
async function isDefaultOperatingDayBulk(dates) {
  const customHolidays = await Holiday.find({ date: { $in: dates } }).lean();
  const customSet = new Set(customHolidays.map((h) => h.date));
  const map = {};
  for (const date of dates) {
    map[date] = !isWeekendDate(date) && !fixedHolidayLabel(date) && !customSet.has(date);
  }
  return map;
}

// 특정 날짜의 tripType x vehicle 조합별 실제 운행 여부를 계산합니다 (관리자 지정 > 기본값 순).
async function resolveOperationMap(date, vehicleIds, tripTypes = TRIP_TYPES) {
  const defaultOn = await isDefaultOperatingDay(date);
  const overrides = vehicleIds.length
    ? await BusOperationDay.find({ date, vehicleId: { $in: vehicleIds }, tripType: { $in: tripTypes } }).lean()
    : [];
  const overrideMap = new Map(overrides.map((o) => [`${o.tripType}_${o.vehicleId}`, o]));
  const result = {};
  for (const vehicleId of vehicleIds) {
    result[vehicleId] = {};
    for (const tripType of tripTypes) {
      const override = overrideMap.get(`${tripType}_${vehicleId}`);
      result[vehicleId][tripType] = {
        enabled: override ? override.enabled : defaultOn,
        overridden: !!override,
        note: override ? override.note : "",
      };
    }
  }
  return { defaultOn, map: result };
}

module.exports = { TRIP_TYPES, isDefaultOperatingDay, isDefaultOperatingDayBulk, resolveOperationMap };
