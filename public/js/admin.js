/* 관리자 화면 로직 */

function openModal(innerHtml) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modalBackdrop";
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}
function closeModal() {
  const el = document.getElementById("modalBackdrop");
  if (el) el.remove();
}

async function downloadFile(path, filename) {
  try {
    const res = await API.get(path);
    const blob = res instanceof Response ? await res.blob() : res;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

const AdminUI = {
  currentTab: null,
  employeesCache: [],
  statusDate: null,
  dailyDate: null,
  month: null,

  init() {
    document.querySelectorAll("#adminTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.atab));
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll("#adminTabs button").forEach((b) => b.classList.toggle("active", b.dataset.atab === tab));
    const map = { status: "adminStatusView", daily: "adminDailyView", monthly: "adminMonthlyView", employees: "adminEmployeesView" };
    Object.entries(map).forEach(([name, id]) => {
      document.getElementById(id).classList.toggle("hidden", name !== tab);
    });
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "employees") this.renderEmployees();
  },

  /* -------------------- 신청 현황 (당일 신청/취소 강제 변경 가능) -------------------- */
  async renderStatus() {
    const container = document.getElementById("adminStatusView");
    const date = this.statusDate || todayStr();
    this.statusDate = date;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <label>${t("selectDate")}</label>
          <input type="date" id="statusDateInput" value="${date}">
        </div>
        <p class="deadline-note">${t("adminOverrideNotice")}</p>
        <div class="toolbar">
          <input type="text" id="overrideEmpId" placeholder="${t("employeeId")}" style="width:120px;">
          <select id="overrideMealType">
            <option value="lunch">${t("lunch")}</option>
            <option value="dinner">${t("dinner")}</option>
          </select>
          <button id="overrideAddBtn">${t("apply")}</button>
        </div>
        <div id="statusLists">${t("loading")}</div>
      </div>
    `;
    document.getElementById("statusDateInput").addEventListener("change", (e) => { this.statusDate = e.target.value; this.renderStatus(); });
    document.getElementById("overrideAddBtn").addEventListener("click", () => this.overrideApply());
    await this.loadStatusList();
  },

  async loadStatusList() {
    const listEl = document.getElementById("statusLists");
    try {
      const data = await API.get(`/admin/reservations?date=${this.statusDate}`);
      const rowsHtml = (rows, mealType) => rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.employeeId)}</td>
          <td>${escapeHtml(r.employeeName)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${r.modifiedByAdmin ? "O" : ""}</td>
          <td><button class="danger" data-cancel-id="${escapeHtml(r.employeeId)}" data-meal="${mealType}">${t("cancel")}</button></td>
        </tr>`).join("");
      listEl.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunchCount")}</div></div>
          <div class="stat"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinnerCount")}</div></div>
        </div>
        <h3>${t("lunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.lunch, "lunch") || `<tr><td colspan="5">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("dinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.dinner, "dinner") || `<tr><td colspan="5">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
      listEl.querySelectorAll("[data-cancel-id]").forEach((btn) => {
        btn.addEventListener("click", () => this.overrideSet(btn.dataset.cancelId, btn.dataset.meal, "cancelled"));
      });
    } catch (err) {
      listEl.textContent = err.message;
    }
  },

  async overrideApply() {
    const employeeId = document.getElementById("overrideEmpId").value.trim();
    const mealType = document.getElementById("overrideMealType").value;
    if (!employeeId) return;
    await this.overrideSet(employeeId, mealType, "applied");
    document.getElementById("overrideEmpId").value = "";
  },

  async overrideSet(employeeId, mealType, status) {
    if (status === "cancelled" && !confirm(t("confirmCancel"))) return;
    try {
      await API.put("/admin/reservations/override", { employeeId, date: this.statusDate, mealType, status });
      showToast(status === "applied" ? t("applySuccess") : t("cancelSuccess"));
      this.loadStatusList();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 일일 집계 -------------------- */
  async renderDaily() {
    const container = document.getElementById("adminDailyView");
    const date = this.dailyDate || todayStr();
    this.dailyDate = date;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar no-print">
          <label>${t("selectDate")}</label>
          <input type="date" id="dailyDateInput" value="${date}">
          <div class="spacer"></div>
          <button class="secondary" id="dailyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="dailyPrintBtn">${t("print")}</button>
        </div>
        <h2>${date}</h2>
        <div id="dailyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("dailyDateInput").addEventListener("change", (e) => { this.dailyDate = e.target.value; this.renderDaily(); });
    document.getElementById("dailyExcelBtn").addEventListener("click", () => downloadFile(`/admin/export/daily?date=${this.dailyDate}`, `meal_${this.dailyDate}.xlsx`));
    document.getElementById("dailyPrintBtn").addEventListener("click", () => window.print());
    await this.loadDaily();
  },

  async loadDaily() {
    const el = document.getElementById("dailyContent");
    try {
      const data = await API.get(`/admin/summary/daily?date=${this.dailyDate}`);
      const rows = [
        ...data.lunch.map((r) => ({ ...r, mealLabel: t("lunch") })),
        ...data.dinner.map((r) => ({ ...r, mealLabel: t("dinner") })),
      ];
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunchCount")}</div></div>
          <div class="stat"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinnerCount")}</div></div>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("mealType")}</th><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${r.mealLabel}</td><td>${escapeHtml(r.employeeId)}</td><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.department)}</td></tr>`).join("") || `<tr><td colspan="4">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
    } catch (err) {
      el.textContent = err.message;
    }
  },

  /* -------------------- 월간 집계 -------------------- */
  async renderMonthly() {
    const container = document.getElementById("adminMonthlyView");
    const month = this.month || todayStr().slice(0, 7);
    this.month = month;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar no-print">
          <label>${t("selectMonth")}</label>
          <input type="month" id="monthInput" value="${month}">
          <div class="spacer"></div>
          <button class="secondary" id="monthlyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="monthlyPrintBtn">${t("print")}</button>
        </div>
        <h2>${month}</h2>
        <div id="monthlyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("monthInput").addEventListener("change", (e) => { this.month = e.target.value; this.renderMonthly(); });
    document.getElementById("monthlyExcelBtn").addEventListener("click", () => downloadFile(`/admin/export/monthly?month=${this.month}`, `meal_${this.month}.xlsx`));
    document.getElementById("monthlyPrintBtn").addEventListener("click", () => window.print());
    await this.loadMonthly();
  },

  async loadMonthly() {
    const el = document.getElementById("monthlyContent");
    try {
      const data = await API.get(`/admin/summary/monthly?month=${this.month}`);
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.totalLunch}</div><div class="lbl">${t("lunchCount")} ${t("total")}</div></div>
          <div class="stat"><div class="num">${data.totalDinner}</div><div class="lbl">${t("dinnerCount")} ${t("total")}</div></div>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("date")}</th><th>${t("lunchCount")}</th><th>${t("dinnerCount")}</th></tr></thead>
          <tbody>${data.days.map((d) => `<tr><td>${d.date}</td><td>${d.lunchCount}</td><td>${d.dinnerCount}</td></tr>`).join("")}</tbody>
        </table></div>
      `;
    } catch (err) {
      el.textContent = err.message;
    }
  },

  /* -------------------- 직원 관리 -------------------- */
  async renderEmployees() {
    const container = document.getElementById("adminEmployeesView");
    container.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <button id="addEmpBtn">${t("addEmployee")}</button>
          <div class="spacer"></div>
          <button class="secondary" id="downloadTemplateBtn">${t("downloadTemplate")}</button>
        </div>
        <div class="toolbar">
          <input type="file" id="importFileInput" accept=".xlsx,.xls">
          <button id="importUploadBtn">${t("uploadFile")}</button>
        </div>
        <div id="importResult" class="deadline-note"></div>
        <div class="table-wrap"><table class="data-table" id="empTable">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("role")}</th><th>${t("active")}</th><th></th></tr></thead>
          <tbody><tr><td colspan="6">${t("loading")}</td></tr></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("addEmpBtn").addEventListener("click", () => this.openEmployeeModal());
    document.getElementById("downloadTemplateBtn").addEventListener("click", () => downloadFile("/admin/employees/import-template", "employee_template.xlsx"));
    document.getElementById("importUploadBtn").addEventListener("click", () => this.uploadImport());
    await this.loadEmployees();
  },

  async loadEmployees() {
    const tbody = document.querySelector("#empTable tbody");
    try {
      const data = await API.get("/admin/employees");
      this.employeesCache = data.employees;
      tbody.innerHTML = data.employees.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.role === "admin" ? t("admin") : t("user")}</td>
          <td>${e.active ? t("active") : t("inactive")}</td>
          <td>
            <button class="secondary" data-edit="${e._id}">${t("edit")}</button>
            <button class="danger" data-del="${e._id}">${t("delete")}</button>
          </td>
        </tr>
      `).join("") || `<tr><td colspan="6">${t("noData")}</td></tr>`;
      tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => this.openEmployeeModal(b.dataset.edit)));
      tbody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => this.deleteEmployee(b.dataset.del)));
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  openEmployeeModal(id) {
    const emp = id ? this.employeesCache.find((e) => e._id === id) : null;
    openModal(`
      <h3>${emp ? t("edit") : t("addEmployee")}</h3>
      <div class="field"><label>${t("employeeId")}</label><input id="mEmpId" value="${emp ? escapeHtml(emp.employeeId) : ""}" ${emp ? "disabled" : ""}></div>
      <div class="field"><label>${t("name")}</label><input id="mName" value="${emp ? escapeHtml(emp.name) : ""}"></div>
      <div class="field"><label>${t("department")}</label><input id="mDept" value="${emp ? escapeHtml(emp.department) : ""}"></div>
      <div class="field"><label>${t("role")}</label>
        <select id="mRole">
          <option value="user" ${!emp || emp.role === "user" ? "selected" : ""}>${t("user")}</option>
          <option value="admin" ${emp && emp.role === "admin" ? "selected" : ""}>${t("admin")}</option>
        </select>
      </div>
      <div class="toolbar" style="margin-top:14px;">
        <button id="mSaveBtn">${t("save")}</button>
        <button class="secondary" id="mCloseBtn">${t("close")}</button>
      </div>
    `);
    document.getElementById("mCloseBtn").addEventListener("click", closeModal);
    document.getElementById("mSaveBtn").addEventListener("click", async () => {
      const employeeId = document.getElementById("mEmpId").value.trim();
      const name = document.getElementById("mName").value.trim();
      const department = document.getElementById("mDept").value.trim();
      const role = document.getElementById("mRole").value;
      try {
        if (emp) await API.put(`/admin/employees/${emp._id}`, { name, department, role });
        else await API.post("/admin/employees", { employeeId, name, department, role });
        closeModal();
        showToast(t("save"));
        this.loadEmployees();
      } catch (err) {
        alert(err.message);
      }
    });
  },

  async deleteEmployee(id) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await API.del(`/admin/employees/${id}`);
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  },

  async uploadImport() {
    const fileInput = document.getElementById("importFileInput");
    if (!fileInput.files.length) {
      alert(t("uploadFile"));
      return;
    }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    const resultEl = document.getElementById("importResult");
    resultEl.textContent = t("loading");
    try {
      const data = await API.request("POST", "/admin/employees/import", fd, { isFormData: true });
      resultEl.innerHTML = `${t("save")}: +${data.created} / ${t("edit")}: ${data.updated}` +
        (data.errors && data.errors.length ? "<br>" + data.errors.map(escapeHtml).join("<br>") : "");
      fileInput.value = "";
      this.loadEmployees();
    } catch (err) {
      resultEl.textContent = err.message;
    }
  },
};

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
