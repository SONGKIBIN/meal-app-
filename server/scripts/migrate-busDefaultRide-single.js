// 1회성 마이그레이션 스크립트: BusDefaultRide를 "트립타입 x 요일별 등록" 방식에서
// "트립타입당 1개만 고정 등록" 방식으로 되돌리면서 기존 데이터를 정리합니다.
//
// 왜 필요한가:
//  - 이전 버전(18차)에서는 직원이 트립타입 x 요일(월~금)마다 각각 기본 차량을 등록할 수 있었습니다
//    (unique index: {employeeId, tripType, dayOfWeek}).
//  - 이번 업데이트로 트립타입당 1개만 고정 등록하는 방식으로 되돌아갔습니다
//    (unique index: {employeeId, tripType}).
//  - 만약 이미 한 직원이 같은 트립타입에 요일별로 서로 다른 차량을 등록해뒀다면, 그 중 하나만
//    남기고 나머지는 삭제해야 새 unique index를 걸 수 있습니다. 이 스크립트는 그 정리를 자동으로
//    해줍니다(월요일 등록분을 우선 보존, 없으면 가장 최근에 수정된 등록을 보존).
//
// 사용법 (배포 서버에서 1회 실행):
//   MONGODB_URI="mongodb://..." node server/scripts/migrate-busDefaultRide-single.js
//
// 이미 트립타입당 1개씩만 등록되어 있던 경우(요일별로 등록한 적이 없는 직원)에는 아무 영향이
// 없습니다. 여러 요일에 각각 다르게 등록해둔 직원의 경우, 하나만 남고 나머지 요일 등록은
// 삭제되며(그 직원은 업데이트 후 새 화면에서 "내가 타는 차"를 다시 확인/등록하면 됩니다),
// dayOfWeek 필드 자체도 모든 문서에서 제거합니다.

const mongoose = require("mongoose");

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI 환경변수가 필요합니다.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const coll = db.collection("busdefaultrides");

  const all = await coll.find({}).toArray();
  console.log(`총 ${all.length}개의 BusDefaultRide 문서를 확인합니다.`);

  const byKey = new Map(); // `${employeeId}_${tripType}` -> [docs]
  for (const doc of all) {
    const key = `${doc.employeeId}_${doc.tripType}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(doc);
  }

  let dupGroups = 0;
  let deleted = 0;
  for (const [key, docs] of byKey.entries()) {
    if (docs.length <= 1) continue;
    dupGroups++;
    // 월요일(dayOfWeek=1) 등록을 우선 보존하고, 없으면 가장 최근에 수정된 문서를 보존합니다.
    const survivor =
      docs.find((d) => d.dayOfWeek === 1) ||
      docs.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
    const toDelete = docs.filter((d) => String(d._id) !== String(survivor._id));
    console.log(`- ${key}: ${docs.length}개 중 1개만 남기고 ${toDelete.length}개 삭제 (남김: dayOfWeek=${survivor.dayOfWeek})`);
    await coll.deleteMany({ _id: { $in: toDelete.map((d) => d._id) } });
    deleted += toDelete.length;
  }

  // 남은 모든 문서에서 dayOfWeek 필드 제거
  const unsetResult = await coll.updateMany({ dayOfWeek: { $exists: true } }, { $unset: { dayOfWeek: "" } });
  console.log(`dayOfWeek 필드 제거: ${unsetResult.modifiedCount}개 문서`);

  // 예전(요일별) unique 인덱스가 남아있다면 제거하고, 새 인덱스가 자동 생성되도록 둡니다
  // (앱을 재시작하면 Mongoose가 새 스키마의 인덱스를 자동으로 만듭니다).
  const indexes = await coll.indexes();
  const staleIndex = indexes.find(
    (idx) => idx.key && idx.key.employeeId === 1 && idx.key.tripType === 1 && idx.key.dayOfWeek === 1
  );
  if (staleIndex) {
    console.log(`예전 인덱스(${staleIndex.name})를 제거합니다.`);
    await coll.dropIndex(staleIndex.name);
  }
  const staleIndex2 = indexes.find((idx) => idx.key && idx.key.tripType === 1 && idx.key.dayOfWeek === 1 && idx.key.vehicleId === 1);
  if (staleIndex2) {
    console.log(`예전 보조 인덱스(${staleIndex2.name})를 제거합니다.`);
    await coll.dropIndex(staleIndex2.name);
  }

  console.log(`완료: 중복 그룹 ${dupGroups}개 정리, 총 ${deleted}개 문서 삭제.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
