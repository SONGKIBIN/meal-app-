// 통근버스 운행 여부 계산 유틸.
// 이 파일은 서로 다른 두 가지 개념을 다룹니다 — 헷갈리지 않도록 구분해서 사용하세요.
//
// 1) "차량 운행 여부"(resolveOperationMap): 그 차량이 그날 실제로 다니는지 여부입니다. 모든 날짜는
//    기본적으로 운행하는 것으로 간주하고, 관리자가 [운행일 지정] 화면에서 특정 날짜/차량/운행구분만
//    명시적으로 꺼서(취소해서) 예외로 관리합니다(예: 회사 휴무일, 차량 정비일).
// 2) "기본 등록 자동 탑승일 여부"(isDefaultOperatingDay/Bulk): 직원이 등록해둔 "내가 타는 차"가
//    별도 신청 없이 자동으로 탑승자 명단에 포함되는 날인지 여부입니다. 평일(월~금)이고 공휴일이
//    아닌 날에만 자동 적용되며, 주말/공휴일에는 차량이 운행하더라도 직원이 그때그때 명시적으로
//    신청해야 합니다.
//    단, 이 자동 탑승은 "commute"(출근)에만 적용됩니다(AUTO_DEFAULT_TRIP_TYPES 참고). 정시퇴근/연장퇴근은
//    직원이 하루에 한 번만 퇴근하므로 자동 탑승 대상이 아니며, 그날그날 둘 중 하나를 직접 선택(신청)해야
//    합니다 — 등록된 기본 차량은 신청 시 차량을 다시 고르지 않아도 되도록 값만 채워주는 참고용입니다.
const Holiday = require("../models/Holiday");
const BusOperationDay = require("../models/BusOperationDay");
const { isWeekendDate, fixedHolidayLabel } = require("./dateUtil");

const TRIP_TYPES = ["commute", "regularLeave", "extendedLeave"];
// 기본 등록(BusDefaultRide)이 별도 신청 없이 자동으로 탑승 처리되는 운행구분입니다.
const AUTO_DEFAULT_TRIP_TYPES = ["commute"];
// 하루에 하나만 선택 가능한(상호 배타적인) 퇴근 운행구분입니다 - 정시퇴근차를 신청하면 연장퇴근차는
// 자동으로 취소되고, 그 반대도 마찬가지입니다.
const MUTUALLY_EXCLUSIVE_TRIP_GROUPS = [["regularLeave", "extendedLeave"]];

// "기본 등록"이 별도 신청 없이 자동으로 탑승자 명단에 포함되는 날인지 여부 (평일 + 공휴일 아님).
async function isDefaultOperatingDay(date) {
  if (isWeekendDate(date)) return false;
  if (fixedHolidayLabel(date)) return false;
  const custom = await Holiday.findOne({ date }).lean();
  if (custom) return false;
  return true;
}

// 여러 날짜에 대해 한 번에 계산합니다 (주간 뷰 등에서 N+1 쿼리를 피하기 위함).
async function isDefaultOperatingDayBulk(dates) {
  const customHolidays = await Holiday.find({ date: { $in: dates } }).lean();
  const customSet = new Set(customHolidays.map((h) => h.date));
  const map = {};
  for (const date of dates) {
    map[date] = !isWeekendDate(date) && !fixedHolidayLabel(date) && !customSet.has(date);
  }
  return map;
}

// 특정 날짜의 tripType x vehicle 조합별 실제 차량 운행 여부를 계산합니다.
// 평일/주말/공휴일 구분 없이 모든 날짜가 기본적으로 "운행"이며, 관리자가 [운행일 지정]에서
// 명시적으로 끈(취소한) 날짜/차량/운행구분만 예외로 운행하지 않습니다(관리자 지정이 항상 최우선).
async function resolveOperationMap(date, vehicleIds, tripTypes = TRIP_TYPES) {
  const defaultOn = true;
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

module.exports = {
  TRIP_TYPES,
  AUTO_DEFAULT_TRIP_TYPES,
  MUTUALLY_EXCLUSIVE_TRIP_GROUPS,
  isDefaultOperatingDay,
  isDefaultOperatingDayBulk,
  resolveOperationMap,
};
