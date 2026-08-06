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
    let blob;
    if (res instanceof Response) {
      blob = await res.blob();
    } else if (res instanceof Blob) {
      blob = res;
    } else {
      // 백업 다운로드처럼 서버 응답이 JSON 형식이라 api.js에서 이미 객체로 변환된 경우,
      // 다시 텍스트로 만들어 파일로 저장합니다.
      blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
    }
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

// 이번 주/다음 주 월요일 날짜(YYYY-MM-DD)를 구합니다.
function mondayOf(dateStr) {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=일 ... 6=토
  const offset = wd === 0 ? -6 : 1 - wd;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const AdminUI = {
  currentTab: null,
  employeesCache: [],
  empSearchTerm: "",
  statusDate: null,
  dailyDate: null,
  month: null,
  menuWeekStart: null,

  init() {
    document.querySelectorAll("#adminTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.atab));
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll("#adminTabs button").forEach((b) => b.classList.toggle("active", b.dataset.atab === tab));
    const map = {
      status: "adminStatusView",
      daily: "adminDailyView",
      monthly: "adminMonthlyView",
      employees: "adminEmployeesView",
      menu: "adminMenuView",
      settings: "adminSettingsView",
    };
    Object.entries(map).forEach(([name, id]) => {
      document.getElementById(id).classList.toggle("hidden", name !== tab);
    });
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "employees") this.renderEmployees();
    else if (tab === "menu") this.renderMenu();
    else if (tab === "settings") this.renderSettings();
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
      <div class="card">
        <h3>${t("pendingEmployees")}</h3>
        <div id="pendingLists">${t("loading")}</div>
      </div>
    `;
    document.getElementById("statusDateInput").addEventListener("change", (e) => { this.statusDate = e.target.value; this.renderStatus(); });
    document.getElementById("overrideAddBtn").addEventListener("click", () => this.overrideApply());
    await Promise.all([this.loadStatusList(), this.loadPendingList()]);
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

  // 아직 신청하지 않은 재직 직원 목록 (중식/석식 각각) - 급식 준비 인원 파악용
  async loadPendingList() {
    const el = document.getElementById("pendingLists");
    try {
      const data = await API.get(`/admin/reservations/pending?date=${this.statusDate}`);
      const rowsHtml = (rows) => rows.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.department)}</td>
        </tr>`).join("");
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.pendingLunch.length}</div><div class="lbl">${t("pendingLunch")}</div></div>
          <div class="stat"><div class="num">${data.pendingDinner.length}</div><div class="lbl">${t("pendingDinner")}</div></div>
        </div>
        <h3>${t("pendingLunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th></tr></thead>
          <tbody>${rowsHtml(data.pendingLunch) || `<tr><td colspan="3">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("pendingDinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th></tr></thead>
          <tbody>${rowsHtml(data.pendingDinner) || `<tr><td colspan="3">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
    } catch (err) {
      el.textContent = err.message;
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
      this.loadPendingList();
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
        <div class="toolbar">
          <label>${t("empSearch")}</label>
          <input type="text" id="empSearchInput" placeholder="${t("empSearchPlaceholder")}" value="${escapeHtml(this.empSearchTerm)}" style="min-width:220px;">
        </div>
        <div class="table-wrap"><table class="data-table" id="empTable">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("role")}</th><th>${t("active")}</th><th></th></tr></thead>
          <tbody><tr><td colspan="6">${t("loading")}</td></tr></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("addEmpBtn").addEventListener("click", () => this.openEmployeeModal());
    document.getElementById("downloadTemplateBtn").addEventListener("click", () => downloadFile("/admin/employees/import-template", "employee_template.xlsx"));
    document.getElementById("importUploadBtn").addEventListener("click", () => this.uploadImport());
    document.getElementById("empSearchInput").addEventListener("input", (e) => {
      this.empSearchTerm = e.target.value;
      this.renderEmployeeRows();
    });
    await this.loadEmployees();
  },

  async loadEmployees() {
    const tbody = document.querySelector("#empTable tbody");
    try {
      const data = await API.get("/admin/employees");
      // 서버에서 부서(가나다)→이름(가나다) 순으로 이미 정렬되어 내려옵니다.
      this.employeesCache = data.employees;
      this.renderEmployeeRows();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  // 검색어로 필터링 후 화면에 표시합니다 (정렬 순서는 서버에서 내려온 부서→이름 순 그대로 유지).
  renderEmployeeRows() {
    const tbody = document.querySelector("#empTable tbody");
    if (!tbody) return;
    const term = (this.empSearchTerm || "").trim().toLowerCase();
    const list = term
      ? this.employeesCache.filter((e) =>
          [e.employeeId, e.name, e.department].some((v) => String(v || "").toLowerCase().includes(term))
        )
      : this.employeesCache;
    tbody.innerHTML = list.map((e) => `
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

  /* -------------------- 식단표 관리 -------------------- */
  async renderMenu() {
    const container = document.getElementById("adminMenuView");
    const thisMonday = mondayOf(todayStr());
    const nextMonday = (() => {
      const d = new Date(thisMonday + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    this.menuWeekStart = this.menuWeekStart || thisMonday;
    container.innerHTML = `
      <div class="card">
        <h2>${t("menuManage")}</h2>
        <div class="toolbar">
          <button class="secondary" id="menuThisWeekBtn">${t("thisWeekMenu")}</button>
          <button class="secondary" id="menuNextWeekBtn">${t("nextWeekMenu")}</button>
          <label>${t("weekOf")}</label>
          <input type="date" id="menuWeekInput" value="${this.menuWeekStart}">
        </div>
        <div id="menuCurrentPreview">${t("loading")}</div>
        <div class="field"><label>${t("uploadMenuImage")}</label><input type="file" id="menuImageInput" accept="image/*"></div>
        <div class="field"><label>${t("menuNote")}</label><textarea id="menuNoteInput" rows="4" style="width:100%;"></textarea></div>
        <div class="toolbar">
          <button id="menuSaveBtn">${t("save")}</button>
          <button class="danger" id="menuDeleteBtn">${t("delete")}</button>
        </div>
      </div>
    `;
    document.getElementById("menuThisWeekBtn").addEventListener("click", () => { this.menuWeekStart = thisMonday; this.renderMenu(); });
    document.getElementById("menuNextWeekBtn").addEventListener("click", () => { this.menuWeekStart = nextMonday; this.renderMenu(); });
    document.getElementById("menuWeekInput").addEventListener("change", (e) => { this.menuWeekStart = mondayOf(e.target.value); this.renderMenu(); });
    document.getElementById("menuSaveBtn").addEventListener("click", () => this.saveMenu());
    document.getElementById("menuDeleteBtn").addEventListener("click", () => this.deleteMenu());
    await this.loadMenuPreview();
  },

  async loadMenuPreview() {
    const el = document.getElementById("menuCurrentPreview");
    try {
      const data = await API.get(`/menu/${this.menuWeekStart}`);
      const noteInput = document.getElementById("menuNoteInput");
      if (data.menu) {
        noteInput.value = data.menu.note || "";
        el.innerHTML = data.menu.imageData
          ? `<img src="${data.menu.imageData}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);margin-bottom:10px;">`
          : "";
      } else {
        noteInput.value = "";
        el.innerHTML = `<p class="deadline-note">${t("noMenu")}</p>`;
      }
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async saveMenu() {
    const fd = new FormData();
    fd.append("weekStart", this.menuWeekStart);
    fd.append("note", document.getElementById("menuNoteInput").value);
    const fileInput = document.getElementById("menuImageInput");
    if (fileInput.files.length) fd.append("image", fileInput.files[0]);
    try {
      await API.request("POST", "/menu", fd, { isFormData: true });
      showToast(t("save"));
      this.loadMenuPreview();
    } catch (err) {
      alert(err.message);
    }
  },

  async deleteMenu() {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await API.del(`/menu/${this.menuWeekStart}`);
      showToast(t("delete"));
      this.loadMenuPreview();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 설정 (마감시간 / 공지사항 / 백업) -------------------- */
  async renderSettings() {
    const container = document.getElementById("adminSettingsView");
    container.innerHTML = `
      <div class="card">
        <h2>${t("deadlineSettings")}</h2>
        <div class="toolbar">
          <label>${t("deadlineHourLabel")}</label>
          <input type="number" id="deadlineHourInput" min="0" max="23" style="width:70px;">
          <label>${t("deadlineMinuteLabel")}</label>
          <input type="number" id="deadlineMinuteInput" min="0" max="59" style="width:70px;">
          <button id="saveDeadlineBtn">${t("saveSettings")}</button>
        </div>
      </div>
      <div class="card">
        <h2>${t("announcementManage")}</h2>
        <textarea id="announcementInput" rows="3" style="width:100%;" placeholder="${t("announcementPlaceholder")}"></textarea>
        <div class="toolbar" style="margin-top:8px;">
          <button id="postAnnouncementBtn">${t("postAnnouncement")}</button>
        </div>
        <div id="announcementList">${t("loading")}</div>
      </div>
      <div class="card">
        <h2>${t("backupData")}</h2>
        <p class="deadline-note">${t("backupDesc")}</p>
        <button class="secondary" id="backupBtn">${t("backupData")}</button>
      </div>
    `;
    document.getElementById("saveDeadlineBtn").addEventListener("click", () => this.saveDeadline());
    document.getElementById("postAnnouncementBtn").addEventListener("click", () => this.postAnnouncement());
    document.getElementById("backupBtn").addEventListener("click", () => downloadFile("/admin/backup", `meal_app_backup_${todayStr()}.json`));
    await Promise.all([this.loadDeadline(), this.loadAnnouncements()]);
  },

  async loadDeadline() {
    try {
      const data = await API.get("/admin/settings");
      document.getElementById("deadlineHourInput").value = data.settings.deadlineHour;
      document.getElementById("deadlineMinuteInput").value = data.settings.deadlineMinute;
    } catch (err) {
      alert(err.message);
    }
  },

  async saveDeadline() {
    const deadlineHour = document.getElementById("deadlineHourInput").value;
    const deadlineMinute = document.getElementById("deadlineMinuteInput").value;
    try {
      await API.put("/admin/settings", { deadlineHour, deadlineMinute });
      showToast(t("settingsSaved"));
    } catch (err) {
      alert(err.message);
    }
  },

  async loadAnnouncements() {
    const el = document.getElementById("announcementList");
    try {
      const data = await API.get("/admin/announcements");
      el.innerHTML = data.announcements.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>${t("date")}</th><th>${t("announcementContent")}</th><th>${t("active")}</th><th></th></tr></thead>
            <tbody>${data.announcements.map((a) => `
              <tr>
                <td>${new Date(a.createdAt).toLocaleString()}</td>
                <td style="text-align:left;">${escapeHtml(a.message)}</td>
                <td>${a.active ? "O" : ""}</td>
                <td>${a.active ? `<button class="danger" data-end="${a._id}">${t("endAnnouncement")}</button>` : ""}</td>
              </tr>
            `).join("")}</tbody>
          </table></div>`
        : `<p class="deadline-note">${t("noAnnouncement")}</p>`;
      el.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", () => this.endAnnouncement(b.dataset.end)));
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async postAnnouncement() {
    const message = document.getElementById("announcementInput").value.trim();
    if (!message) return;
    try {
      await API.post("/admin/announcements", { message });
      document.getElementById("announcementInput").value = "";
      showToast(t("postAnnouncement"));
      this.loadAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  },

  async endAnnouncement(id) {
    if (!confirm(t("confirmEndAnnouncement"))) return;
    try {
      await API.put(`/admin/announcements/${id}/deactivate`, {});
      this.loadAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  },
};

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
