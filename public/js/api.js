const API = {
  base: "/api",
  getToken() {
    return localStorage.getItem("meal_token");
  },
  setToken(token) {
    if (token) localStorage.setItem("meal_token", token);
    else localStorage.removeItem("meal_token");
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem("meal_user") || "null");
    } catch {
      return null;
    }
  },
  setUser(user) {
    if (user) localStorage.setItem("meal_user", JSON.stringify(user));
    else localStorage.removeItem("meal_user");
  },
  async request(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = this.getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    let fetchBody = undefined;
    if (body !== undefined && !opts.isFormData) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    } else if (opts.isFormData) {
      fetchBody = body;
    }
    const res = await fetch(this.base + path, { method, headers, body: fetchBody });
    if (res.status === 401 && opts.silent) {
      // silent 호출(예: 로그인)에서의 401은 세션 만료가 아니라 값 자체가 틀린 경우(예: 비밀번호 오류)이므로,
      // 강제 로그아웃/새로고침 없이 서버가 내려준 오류 메시지와 code를 그대로 호출자에게 전달합니다.
      const ct401 = res.headers.get("content-type") || "";
      const data401 = ct401.includes("application/json") ? await res.json().catch(() => ({})) : {};
      const err401 = new Error(data401.error || "요청 처리 중 오류가 발생했습니다.");
      err401.code = data401.code;
      throw err401;
    }
    if (res.status === 401) {
      this.setToken(null);
      this.setUser(null);
      window.location.reload();
      throw new Error("Unauthorized");
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      if (!res.ok) throw new Error("요청 처리 중 오류가 발생했습니다.");
      return res; // caller handles (e.g., file download)
    }
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
      err.code = data.code;
      throw err;
    }
    return data;
  },
  get(path) {
    return this.request("GET", path);
  },
  post(path, body, opts) {
    return this.request("POST", path, body, opts || {});
  },
  put(path, body, opts) {
    return this.request("PUT", path, body, opts || {});
  },
  del(path, body, opts) {
    return this.request("DELETE", path, body, opts || {});
  },
};
