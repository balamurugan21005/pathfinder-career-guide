const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const authName = document.querySelector("#auth-name");
const authNameLabel = document.querySelector("#auth-name-label");
const authPassword = document.querySelector("#auth-password");
const coachTranscript = document.querySelector("#coach-transcript");
let authMode = "signin";
let coachMode = "explore";
let profileState = { assessment: null, savedCareers: [], messages: [] };
let currentUser = null;
let adminActivities = [];
let adminUnreadCount = 0;
let adminActivityTotal = 0;
let adminCourseSearchCount = 0;
let adminPollTimer = null;
let adminPollInProgress = false;

async function apiRequest(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function addCoachMessage(role, content) {
  const message = document.createElement("article");
  message.className = `coach-message ${role === "user" ? "user-message" : "assistant-message"}`;
  const label = document.createElement("span");
  label.className = "coach-message-label";
  label.textContent = role === "user" ? "YOU" : "YOUR GUIDE";
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  message.append(label, paragraph);
  coachTranscript.append(message);
  coachTranscript.scrollTop = coachTranscript.scrollHeight;
}

function restoreCoachMessages(messages) {
  coachTranscript.querySelectorAll(".coach-message:not(:first-child)").forEach((message) => message.remove());
  (messages || []).forEach((message) => addCoachMessage(message.role, message.content));
}

function setSignedIn(user, profile = {}) {
  currentUser = user;
  profileState = {
    assessment: profile.assessment || null,
    savedCareers: profile.savedCareers || [],
    messages: profile.messages || [],
  };
  authScreen.hidden = true;
  appShell.hidden = false;
  document.querySelector("#instructor-panel").hidden = !user.isInstructor;
  document.querySelector("#admin-notification-wrap").hidden = !user.isInstructor;
  document.querySelector("#activity-nav-link").hidden = !user.isInstructor;
  document.querySelector(".profile-mini-copy strong").textContent = user.name;
  document.querySelector(".profile-mini-copy small").textContent = user.email;
  const firstName = user.name.split(/\s+/)[0];
  document.querySelector("#coach-name").textContent = firstName;
  document.querySelector("#welcome-name").textContent = firstName;
  window.pathfinderApplyProfile(profileState);
  restoreCoachMessages(profileState.messages);
  document.querySelector("#coach-status").textContent = "Connecting to your career guide…";
  fetch("/api/health", { credentials: "same-origin" })
    .then((response) => response.json())
    .then((health) => {
      document.querySelector("#coach-status").textContent = health.ai ? "AI career guide · Connected" : "Personalized local guide";
    })
    .catch(() => {
      document.querySelector("#coach-status").textContent = "Career guide · Ready";
    });
  if (user.isInstructor) {
    pollAdminActivities();
    window.clearInterval(adminPollTimer);
    adminPollTimer = window.setInterval(pollAdminActivities, 5000);
    if (authMode === "admin") document.querySelector("#activity-nav-link").click();
  } else {
    window.clearInterval(adminPollTimer);
    adminActivities = [];
    adminUnreadCount = 0;
    adminActivityTotal = 0;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegistering = mode === "register";
  const isAdmin = mode === "admin";
  document.querySelector("#signin-tab").classList.toggle("active", !isRegistering && !isAdmin);
  document.querySelector("#register-tab").classList.toggle("active", isRegistering);
  document.querySelector("#admin-tab").classList.toggle("active", isAdmin);
  document.querySelector("#signin-tab").setAttribute("aria-selected", String(!isRegistering && !isAdmin));
  document.querySelector("#register-tab").setAttribute("aria-selected", String(isRegistering));
  document.querySelector("#admin-tab").setAttribute("aria-selected", String(isAdmin));
  document.querySelector(".auth-form-wrap > .eyebrow").textContent = isAdmin ? "ADMIN WORKSPACE" : "YOUR STUDENT WORKSPACE";
  document.querySelector("#auth-title").textContent = isRegistering ? "Create your account." : isAdmin ? "Admin access." : "Welcome back.";
  document.querySelector("#auth-subtitle").textContent = isRegistering
    ? "A space for the paths you are figuring out."
    : isAdmin ? "Sign in with your authorized administrator account." : "Sign in to pick up where you left off.";
  document.querySelector("#auth-submit").innerHTML = isRegistering
    ? 'Create account <span aria-hidden="true">→</span>'
    : isAdmin ? 'Admin sign in <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
  authName.hidden = !isRegistering;
  authNameLabel.hidden = !isRegistering;
  authName.required = isRegistering;
  document.querySelector("#register-tab").hidden = isAdmin;
  document.querySelector(".auth-privacy").textContent = isAdmin
    ? "Admin access is limited to accounts on the server's administrator allowlist."
    : "Your account keeps your profile and saved career paths together.";
  authPassword.type = "password";
  authPassword.autocomplete = isRegistering ? "new-password" : "current-password";
  const passwordToggle = document.querySelector("#password-toggle");
  passwordToggle.textContent = "Show";
  passwordToggle.setAttribute("aria-label", "Show password");
  passwordToggle.setAttribute("aria-pressed", "false");
  authError.hidden = true;
  authError.textContent = "";
}

window.pathfinderApi = {
  saveProfile: async ({ assessment, savedCareers }) => {
    const updated = await apiRequest("/api/profile", {
      method: "PUT",
      body: {
        assessment,
        savedCareers,
        messages: profileState.messages,
      },
    });
    profileState = updated.profile;
    return updated.profile;
  },
  recordActivity: async (type, subject) => {
    if (!currentUser) return;
    await apiRequest("/api/activity", { method: "POST", body: { type, subject } });
  },
};

function escapeActivityText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatActivityDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function activityIcon(type) {
  return ({
    account_created: "＋",
    user_login: "↗",
    search: "⌕",
    course_search: "⌕",
    career_search: "⌕",
    career_view: "◎",
    course_view: "▣",
    video_view: "▶",
    section_click: "↗",
  })[type] || "•";
}

function activityDescription(activity) {
  return `<strong>${escapeActivityText(activity.userName)}</strong> ${escapeActivityText(activity.label)} <strong>${escapeActivityText(activity.subject)}</strong>.`;
}

function updateActivityBadge(unreadCount) {
  const badge = document.querySelector("#notification-count");
  const navCount = document.querySelector("#activity-nav-count");
  badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  badge.hidden = unreadCount === 0;
  navCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  navCount.hidden = unreadCount === 0;
  document.querySelector("#notification-button").setAttribute(
    "aria-label",
    unreadCount ? `Admin activity notifications, ${unreadCount} unread` : "Admin activity notifications",
  );
}

function renderActivityDashboard() {
  const history = document.querySelector("#activity-history");
  document.querySelector("#activity-total").textContent = `${adminActivities.length} ${adminActivities.length === 1 ? "activity" : "activities"}`;
  document.querySelector("#activity-course-search-total").textContent = `${adminCourseSearchCount} course ${adminCourseSearchCount === 1 ? "search" : "searches"}`;
  document.querySelector("#activity-mark-all").disabled = adminUnreadCount === 0;
  document.querySelector("#activity-clear").disabled = adminActivities.length === 0;
  const loadMore = document.querySelector("#activity-load-more");
  loadMore.hidden = adminActivities.length >= adminActivityTotal;
  loadMore.disabled = false;
  loadMore.textContent = "Load more activity";
  history.innerHTML = adminActivities.length
    ? adminActivities.map((activity) => `
      <article class="activity-item${activity.isRead ? "" : " unread"}">
        <span class="activity-icon" aria-hidden="true">${activityIcon(activity.type)}</span>
        <div class="activity-copy">
          <p>${activityDescription(activity)}</p>
          <div class="activity-meta"><span>${escapeActivityText(activity.userEmail)}</span><time datetime="${escapeActivityText(activity.createdAt)}">${escapeActivityText(formatActivityDate(activity.createdAt))}</time></div>
        </div>
        <button class="activity-read-button" type="button" data-mark-activity="${escapeActivityText(activity.id)}"${activity.isRead ? " disabled" : ""}>${activity.isRead ? "Read" : "Mark read"}</button>
      </article>`).join("")
    : '<p class="activity-empty">No student activity yet. New searches and course visits will appear here.</p>';
  const preview = document.querySelector("#notification-preview");
  const recent = adminActivities.slice(0, 5);
  preview.innerHTML = recent.length
    ? `${recent.map((activity) => `
      <article class="activity-preview-item${activity.isRead ? "" : " unread"}">
        <span class="activity-preview-icon" aria-hidden="true">${activityIcon(activity.type)}</span>
        <div><p>${activityDescription(activity)}</p><time datetime="${escapeActivityText(activity.createdAt)}">${escapeActivityText(formatActivityDate(activity.createdAt))}</time></div>
      </article>`).join("")}${adminActivities.length > recent.length ? `<div class="activity-preview-more">${adminActivities.length - recent.length} more activities</div>` : ""}`
    : '<p class="activity-empty">No student activity yet.</p>';
  updateActivityBadge(adminUnreadCount);
}

async function pollAdminActivities() {
  if (!currentUser?.isInstructor || adminPollInProgress) return;
  adminPollInProgress = true;
  try {
    const result = await apiRequest("/api/admin/activities?limit=100");
    const newestIds = new Set(result.activities.map((activity) => activity.id));
    adminActivities = [...result.activities, ...adminActivities.slice(100).filter((activity) => !newestIds.has(activity.id))];
    adminUnreadCount = result.unreadCount;
    adminActivityTotal = result.totalCount;
    adminCourseSearchCount = result.courseSearchCount;
    renderActivityDashboard();
    document.querySelector("#activity-live-status").classList.remove("offline");
  } catch (error) {
    console.error("Could not refresh admin activity notifications.", error);
    document.querySelector("#activity-live-status").classList.add("offline");
  } finally {
    adminPollInProgress = false;
  }
}

async function markActivitiesRead(ids) {
  try {
    const result = await apiRequest("/api/admin/activities/read", {
      method: "PATCH",
      body: ids === null ? { all: true } : { ids },
    });
    adminUnreadCount = result.unreadCount;
    adminActivities = adminActivities.map((activity) => ids === null || ids.includes(activity.id) ? { ...activity, isRead: true } : activity);
    renderActivityDashboard();
  } catch (error) {
    document.querySelector("#toast").textContent = error.message || "Activities could not be marked as read.";
    document.querySelector("#toast").classList.add("show");
  }
}

document.querySelector("#activity-history").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mark-activity]");
  if (button) markActivitiesRead([button.dataset.markActivity]);
});

document.querySelector("#activity-mark-all").addEventListener("click", () => {
  markActivitiesRead(null);
});

document.querySelector("#activity-load-more").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!currentUser?.isInstructor || button.disabled) return;
  button.disabled = true;
  button.textContent = "Loading activity…";
  try {
    const query = new URLSearchParams({ offset: String(adminActivities.length), limit: "100" });
    const result = await apiRequest(`/api/admin/activities?${query}`);
    const loadedIds = new Set(adminActivities.map((activity) => activity.id));
    adminActivities = [...adminActivities, ...result.activities.filter((activity) => !loadedIds.has(activity.id))];
    adminUnreadCount = result.unreadCount;
    adminActivityTotal = result.totalCount;
    adminCourseSearchCount = result.courseSearchCount;
    renderActivityDashboard();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Could not load activity. Try again.";
    console.error("Could not load older admin activity.", error);
  }
});

document.querySelector("#activity-clear").addEventListener("click", async () => {
  if (!currentUser?.isInstructor || !window.confirm("Clear the complete activity history for all admins? This cannot be undone.")) return;
  try {
    await apiRequest("/api/admin/activities", { method: "DELETE" });
    adminActivities = [];
    adminUnreadCount = 0;
    adminActivityTotal = 0;
    adminCourseSearchCount = 0;
    renderActivityDashboard();
  } catch (error) {
    document.querySelector("#toast").textContent = error.message || "Activity history could not be cleared.";
    document.querySelector("#toast").classList.add("show");
  }
});

document.querySelector("#notification-button").addEventListener("click", () => {
  const menu = document.querySelector("#notification-menu");
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  document.querySelector("#notification-button").setAttribute("aria-expanded", String(willOpen));
  if (willOpen) pollAdminActivities();
});

document.querySelector("#notification-view-all").addEventListener("click", () => {
  document.querySelector("#notification-menu").hidden = true;
  document.querySelector("#notification-button").setAttribute("aria-expanded", "false");
  document.querySelector('[data-view="activity"]').click();
});

document.addEventListener("click", (event) => {
  const wrap = document.querySelector("#admin-notification-wrap");
  if (!wrap.contains(event.target)) {
    document.querySelector("#notification-menu").hidden = true;
    document.querySelector("#notification-button").setAttribute("aria-expanded", "false");
  }
});

document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
});

document.querySelector("#password-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isVisible = authPassword.type === "text";
  authPassword.type = isVisible ? "password" : "text";
  button.textContent = isVisible ? "Show" : "Hide";
  button.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  button.setAttribute("aria-pressed", String(!isVisible));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.hidden = true;
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  submit.textContent = authMode === "register" ? "Creating account…" : authMode === "admin" ? "Checking admin access…" : "Signing in…";
  const form = new FormData(authForm);
  const route = authMode === "register" ? "/api/auth/register" : authMode === "admin" ? "/api/auth/admin-login" : "/api/auth/login";
  const body = { email: form.get("email"), password: form.get("password") };
  if (authMode === "register") body.name = form.get("name");
  try {
    const result = await apiRequest(route, { method: "POST", body });
    setSignedIn(result.user, result.profile);
  } catch (error) {
    authError.textContent = error.message.includes("Failed to fetch")
      ? "The server is not responding. Start Pathfinder with node server.js, then try again."
      : error.message;
    authError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.innerHTML = authMode === "register"
      ? 'Create account <span aria-hidden="true">→</span>'
      : authMode === "admin" ? 'Admin sign in <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: {} });
    window.location.reload();
  } catch {
    document.querySelector("#toast").textContent = "Sign out could not reach the server. Try again.";
    document.querySelector("#toast").classList.add("show");
  }
});

document.querySelectorAll("[data-coach-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    coachMode = button.dataset.coachMode;
    document.querySelectorAll("[data-coach-mode]").forEach((modeButton) => {
      const active = modeButton === button;
      modeButton.classList.toggle("active", active);
      modeButton.setAttribute("aria-pressed", String(active));
    });
  });
});

document.querySelectorAll("[data-coach-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector("#coach-input");
    input.value = button.dataset.coachPrompt;
    input.focus();
  });
});

document.querySelector("#coach-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#coach-input");
  const send = document.querySelector("#coach-send");
  const prompt = input.value.trim();
  if (!prompt || send.disabled) return;
  const mode = { explore: "career", projects: "skills", practice: "interview" }[coachMode];
  const previousMessages = profileState.messages.slice(-8);
  addCoachMessage("user", prompt);
  input.value = "";
  send.disabled = true;
  send.setAttribute("aria-label", "Guide is responding");
  try {
    const result = await apiRequest("/api/coach", {
      method: "POST",
      body: { prompt, mode, messages: previousMessages },
    });
    addCoachMessage("assistant", result.answer);
    profileState.messages = [...previousMessages, { role: "user", content: prompt }, { role: "assistant", content: result.answer }].slice(-12);
    await apiRequest("/api/profile", {
      method: "PUT",
      body: {
        assessment: profileState.assessment,
        savedCareers: profileState.savedCareers,
        messages: profileState.messages,
      },
    }).then((updated) => { profileState = updated.profile; });
  } catch (error) {
    addCoachMessage("assistant", error.message || "I couldn’t reach the guide just now. Please try again.");
  } finally {
    send.disabled = false;
    send.setAttribute("aria-label", "Send message");
    input.focus();
  }
});

(async () => {
  try {
    const result = await apiRequest("/api/auth/me");
    if (result.user) setSignedIn(result.user, result.profile);
  } catch {
    authError.textContent = "The server is not responding. Start Pathfinder with node server.js, then try again.";
    authError.hidden = false;
  }
})();
