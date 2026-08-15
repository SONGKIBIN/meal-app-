// 특정 날짜 x 운행구분에 대해 "실제로 탑승하는 사람" 목록을 계산하는 공용 유틸입니다.
// - 기본 운행일(평일, 공휴일 아님)에는 그 날짜의 요일(dayOfWeek)에 해당하는 BusDefaultRide(기본 등록)를
//   자동으로 탑승자에 포함하되, 그날 명시적으로 취소(BusRide status=cancelled)했거나 다른 차량으로
//   명시 신청(status=applied)한 사람은 기본 등록에서 제외합니다(아래에서 명시 신청 쪽으로 다시 포함됨).
// - 기본 운행일이 아닌 날(주말/공휴일/특근일 등)에는 기본 등록이 자동 적용되지 않고,
//   그날 명시적으로 신청(status=applied)한 사람만 포함됩니다.
// - 두 경우 모두, 관리자가 그 차량/운행구분의 운행을 켜지 않았다면(opMap의 enabled=false) 아무도 포함되지 않습니다.
//
// 이 함수는 순수 함수입니다(DB 호출 없음) — 호출하는 쪽에서 필요한 데이터를 미리 조회해 넘겨줍니다.
// dayOfWeek: 이 date의 요일 (0=일요일 ~ 6=토요일, JS Date.getUTCDay()와 동일한 기준)
// allDefaults: BusDefaultRide 문서 배열 (날짜와 무관, 전체 또는 관심 차량 범위 — tripType x dayOfWeek별로 등록됨)
// explicitRowsForDate: 해당 date의 BusRide 문서 배열 (status 무관 — applied/cancelled 모두 포함해서 전달)
// opMap: resolveOperationMap()의 map 결과 (vehicleId -> tripType -> {enabled, ...})
// 반환값: { [vehicleId]: [{ employeeId, employeeName, department, stop, headcount, source }] }
function computeRiders(tripType, vehicleIds, opMap, isDefaultDay, dayOfWeek, allDefaults, explicitRowsForDate) {
  const result = {};
  vehicleIds.forEach((id) => (result[id] = []));

  const explicitForTrip = (explicitRowsForDate || []).filter((r) => r.tripType === tripType);
  const explicitByEmp = new Map(explicitForTrip.map((r) => [r.employeeId, r]));

  const vehicleEnabled = (vId) => !!(opMap[vId] && opMap[vId][tripType] && opMap[vId][tripType].enabled);

  if (isDefaultDay) {
    for (const d of allDefaults || []) {
      if (d.tripType !== tripType || d.dayOfWeek !== dayOfWeek) continue;
      const vId = String(d.vehicleId);
      if (!vehicleIds.includes(vId)) continue;
      if (!vehicleEnabled(vId)) continue;
      if (explicitByEmp.has(d.employeeId)) continue; // 그날 취소했거나 다른 차량으로 신청함 - 아래에서 처리
      result[vId].push({
        employeeId: d.employeeId,
        employeeName: d.employeeName,
        department: d.department,
        stop: d.stop,
        headcount: d.headcount || 1,
        source: "default",
      });
    }
  }

  for (const ex of explicitForTrip) {
    if (ex.status !== "applied") continue;
    const vId = String(ex.vehicleId);
    if (!result[vId]) continue;
    if (!vehicleEnabled(vId)) continue;
    result[vId].push({
      employeeId: ex.employeeId,
      employeeName: ex.employeeName,
      department: ex.department,
      stop: ex.stop,
      headcount: ex.headcount || 1,
      source: "explicit",
      rideId: String(ex._id),
    });
  }

  return result;
}

module.exports = { computeRiders };
