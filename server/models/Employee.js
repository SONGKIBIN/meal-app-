const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, trim: true }, // 사번
    name: { type: String, required: true, trim: true }, // 이름
    department: { type: String, default: "", trim: true }, // 부서
    // user=일반직원, admin=전체 관리자, manager=부서 운영자(자기 부서 + managedDepartments에 한해 제한된 관리 권한)
    role: { type: String, enum: ["user", "admin", "manager"], default: "user" },
    // 부서 운영자(role=manager)가 자기 부서 외에 추가로 조회/관리할 수 있는 부서 목록 (관리자가 지정).
    // 본인 소속 부서(department)는 별도 설정 없이 항상 자동으로 포함됩니다.
    managedDepartments: { type: [String], default: [] },
    active: { type: Boolean, default: true }, // 재직 여부 (퇴사자는 false)
    // individual = 개인 직원(1명씩 신청), contractor = 도급회사 등 단체 계정(인원수를 숫자로 입력해 일괄 신청)
    employeeType: { type: String, enum: ["individual", "contractor"], default: "individual" },
    // 도급회사(단체) 계정의 총 인원(TO). 설정해두면 신청 인원을 뺀 나머지를 "미신청 인원"으로 계산합니다.
    // 개인 직원에게는 사용하지 않습니다 (null).
    totalHeadcount: { type: Number, default: null, min: 0 },
    // 도급(단체) 계정이 직접 요청한 총원(TO) 수정 제안. 관리자가 승인하면 totalHeadcount에 반영되고 초기화됩니다.
    requestedHeadcount: { type: Number, default: null, min: 0 },
    requestedHeadcountNote: { type: String, default: "", trim: true },
    requestedHeadcountAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 사번 + 이름으로 로그인하므로 두 값이 함께 유일하게 매칭되어야 합니다.
employeeSchema.index({ employeeId: 1, name: 1 });

module.exports = mongoose.model("Employee", employeeSchema);
