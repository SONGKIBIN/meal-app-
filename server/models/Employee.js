const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, trim: true }, // 사번
    name: { type: String, required: true, trim: true }, // 이름
    department: { type: String, default: "", trim: true }, // 부서
    role: { type: String, enum: ["user", "admin"], default: "user" },
    active: { type: Boolean, default: true }, // 재직 여부 (퇴사자는 false)
    // individual = 개인 직원(1명씩 신청), contractor = 도급회사 등 단체 계정(인원수를 숫자로 입력해 일괄 신청)
    employeeType: { type: String, enum: ["individual", "contractor"], default: "individual" },
  },
  { timestamps: true }
);

// 사번 + 이름으로 로그인하므로 두 값이 함께 유일하게 매칭되어야 합니다.
employeeSchema.index({ employeeId: 1, name: 1 });

module.exports = mongoose.model("Employee", employeeSchema);
