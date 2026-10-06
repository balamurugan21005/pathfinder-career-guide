const careers = [
  { title: "UX / UI Designer", category: "Creative", image: "https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?auto=format&fit=crop&w=800&q=82", match: 94, description: "Shape digital experiences that feel clear, useful, and human.", skills: "Design · Research", outlook: "Growing field" },
  { title: "Product Designer", category: "Creative", image: "https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=800&q=82", match: 91, description: "Bring people, ideas, and technology together to solve real needs.", skills: "Strategy · Design", outlook: "High impact" },
  { title: "Front-end Developer", category: "Technology", image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=82", match: 88, description: "Turn a blank screen into something people love using.", skills: "Code · Creativity", outlook: "Growing field" },
  { title: "Data Storyteller", category: "Technology", image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=82", match: 84, description: "Find the story inside information and make it easy to understand.", skills: "Analysis · Communication", outlook: "In demand" },
  { title: "Learning Experience Designer", category: "People", image: "https://images.unsplash.com/photo-1529390079861-591de354faf5?auto=format&fit=crop&w=800&q=82", match: 81, description: "Create thoughtful ways for people to learn and grow.", skills: "Teaching · Design", outlook: "Meaningful work" },
  { title: "Creative Technologist", category: "Technology", image: "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=800&q=82", match: 78, description: "Experiment at the intersection of code, art, and new ideas.", skills: "Prototyping · Ideas", outlook: "Emerging field" }
];

const courses = [
  { id: "html-starter", title: "Build your first webpage", subject: "HTML", level: "Beginner", creator: "freeCodeCamp.org", video: "pQN-pnXPaVg", videoTitle: "HTML Full Course - Build a Website Tutorial", description: "Learn the building blocks of the web and make a page of your own.", skills: ["HTML", "Web basics"], color: "html" },
  { id: "css-design", title: "Style with CSS", subject: "CSS", level: "Beginner", creator: "Traversy Media", video: "yfoY53QXEnI", videoTitle: "CSS Crash Course For Absolute Beginners", description: "Turn a plain page into a responsive design with color, layout, and type.", skills: ["CSS", "Visual design"], color: "css" },
  { id: "javascript-advanced", title: "Advanced JavaScript", subject: "JavaScript", level: "Advanced", creator: "Codevolution", video: "R9I85RhI7Cg", videoTitle: "Advanced JavaScript Crash Course", description: "Go beyond the basics and sharpen the JavaScript concepts behind modern apps.", skills: ["JavaScript", "Programming"], color: "javascript" },
  { id: "react-builder", title: "Build apps with React", subject: "React", level: "Intermediate", creator: "freeCodeCamp.org", video: "bMknfKXIFA8", videoTitle: "React Course - Beginner's Tutorial for React JavaScript Library [2022]", description: "Explore components, state, and the tools used to build interactive interfaces.", skills: ["React", "Front-end"], color: "react" },
  { id: "python-foundations", title: "Python from zero", subject: "Python", level: "Beginner", creator: "freeCodeCamp.org", video: "rfscVS0vtbw", videoTitle: "Learn Python - Full Course for Beginners [Tutorial]", description: "Start programming with Python and practice the fundamentals step by step.", skills: ["Python", "Problem solving"], color: "python" },
  { id: "sql-data", title: "Explore data with SQL", subject: "SQL", level: "Beginner", creator: "freeCodeCamp.org", video: "HXV3zeQKqGY", videoTitle: "SQL Tutorial - Full Database Course for Beginners", description: "Learn how databases work and use SQL to ask better questions of data.", skills: ["SQL", "Data"], color: "sql" },
  { id: "algorithms-advanced", title: "Algorithms & data structures", subject: "Computer science", level: "Advanced", creator: "freeCodeCamp.org", video: "8hly31xKli0", videoTitle: "Algorithms and Data Structures Tutorial - Full Course for Beginners", description: "Practice core computer-science patterns for solving harder problems.", skills: ["Algorithms", "Data structures"], color: "algorithms" }
];

function loadCompletedCourses() {
  const savedProgress = window.localStorage.getItem("pathfinder.completedCourses");
  if (!savedProgress) return new Set();
  try {
    const storedIds = JSON.parse(savedProgress);
    if (!Array.isArray(storedIds)) throw new TypeError("Saved course progress is not a list.");
    const localMetadata = JSON.parse(window.localStorage.getItem("pathfinder.uploadedCourses") || "[]");
    const knownIds = new Set([...courses.map((course) => course.id), ...(Array.isArray(localMetadata) ? localMetadata.map((course) => course.id) : [])]);
    return new Set(storedIds.filter((id) => knownIds.has(id)));
  } catch (error) {
    console.error("Could not read saved course progress.", error);
    showToast("Saved course progress could not be read.");
    return new Set();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

const uploadedCourses = [];
const localVideoProgress = new Map();
const themeKey = "pathfinder.theme";
let activeCareerTitle = null;
let careerTrigger = null;
let objectUrls = [];

function openMediaDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open("pathfinder-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("uploads", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadUploadedCourses() {
  try {
    const metadata = JSON.parse(window.localStorage.getItem("pathfinder.uploadedCourses") || "[]");
    if (!Array.isArray(metadata)) throw new TypeError("Saved course metadata is not a list.");
    const database = await openMediaDatabase();
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction("uploads", "readonly").objectStore("uploads").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const blobs = new Map(records.map((record) => [record.id, record]));
    metadata.forEach((course) => {
      const record = blobs.get(course.id);
      if (!record) return;
      course.videoUrl = URL.createObjectURL(record.video);
      course.thumbnailUrl = record.thumbnail ? URL.createObjectURL(record.thumbnail) : "";
      objectUrls.push(course.videoUrl);
      if (course.thumbnailUrl) objectUrls.push(course.thumbnailUrl);
      uploadedCourses.push(course);
    });
    renderCourses();
  } catch (error) {
    console.error("Could not load locally uploaded courses.", error);
    showToast("Local instructor courses could not be loaded.");
  }
}

const savedCareers = new Set();
let activeFilter = "All";
let toastTimer;
const completedCourses = loadCompletedCourses();
let currentAssessment = null;
let activeCourseId = null;
let courseTrigger = null;
let activeCourseLevel = "All";
let activeCourseProgress = 0;
const searchActivityTimers = new WeakMap();

try {
  const savedProgress = JSON.parse(window.localStorage.getItem("pathfinder.courseProgress") || "{}");
  Object.entries(savedProgress).forEach(([id, progress]) => {
    if (Number.isFinite(progress) && progress >= 0 && progress < 100) localVideoProgress.set(id, progress);
  });
} catch (error) {
  console.error("Could not read saved video progress.", error);
}

function saveProfile() {
  return window.pathfinderApi?.saveProfile({ assessment: currentAssessment, savedCareers: [...savedCareers] });
}

window.pathfinderApplyProfile = (profile = {}) => {
  currentAssessment = profile.assessment || null;
  savedCareers.clear();
  (profile.savedCareers || []).forEach((title) => savedCareers.add(title));
  if (currentAssessment) {
    document.querySelector("#interest-select").value = currentAssessment.interest;
    document.querySelector("#work-style").value = currentAssessment.workStyle;
  }
  const progress = currentAssessment ? "82" : "68";
  document.querySelector("#profile-progress").textContent = progress;
  document.querySelector(".progress-ring").setAttribute("aria-label", `Profile ${progress} percent complete`);
  document.querySelector("#featured-careers").innerHTML = careers.slice(0, 3).map(careerCard).join("");
  renderCareers();
  renderSkillGap();
};

function careerCard(career) {
  const isSaved = savedCareers.has(career.title);
  return `<article class="career-card"><div class="career-image"><img src="${career.image}" alt="" loading="lazy"><span class="match-badge">${career.match}% match</span><button class="save-button${isSaved ? " saved" : ""}" type="button" data-save-career="${career.title}" aria-label="${isSaved ? "Remove saved" : "Save"} ${career.title}" aria-pressed="${isSaved}">${isSaved ? "♥" : "♡"}</button></div><div class="career-card-body"><p class="career-category">${career.category} · CAREER PATH</p><h3>${career.title}</h3><p>${career.description}</p><div class="career-meta"><span>${career.skills}</span><span>${career.outlook}</span></div><button class="career-detail-link" type="button" data-open-career="${career.title}">Explore this role →</button></div></article>`;
}

function renderCareers() {
  const search = document.querySelector("#career-search").value.trim().toLowerCase();
  const filtered = careers.filter((career) => {
    const matchesCategory = activeFilter === "All" || career.category === activeFilter;
    const searchable = `${career.title} ${career.category} ${career.description} ${career.skills}`.toLowerCase();
    return matchesCategory && searchable.includes(search);
  });
  document.querySelector("#career-directory").innerHTML = filtered.map(careerCard).join("");
  document.querySelector("#results-count").textContent = `${filtered.length} ${filtered.length === 1 ? "path" : "paths"} to explore`;
  document.querySelector("#empty-state").hidden = filtered.length > 0;
  renderSavedCareers();
}

function renderSavedCareers() {
  const saved = careers.filter((career) => savedCareers.has(career.title));
  document.querySelector("#saved-careers").innerHTML = saved.map(careerCard).join("");
  document.querySelector("#saved-empty").hidden = saved.length > 0;
}

function renderSkillGap() {
  const careerSelect = document.querySelector("#skill-gap-career");
  if (!careerSelect) return;
  const selected = window.localStorage.getItem("pathfinder.skillGapCareer") || careers[0].title;
  careerSelect.innerHTML = careers.map((career) => `<option value="${escapeHtml(career.title)}">${escapeHtml(career.title)}</option>`).join("");
  careerSelect.value = careers.some((career) => career.title === selected) ? selected : careers[0].title;
  const career = careers.find((item) => item.title === careerSelect.value);
  const skills = career.skills.split(" · ");
  let knownSkills = [];
  try {
    const stored = JSON.parse(window.localStorage.getItem("pathfinder.skillGap") || "{}");
    knownSkills = Array.isArray(stored[career.title]) ? stored[career.title] : [];
  } catch (error) {
    console.error("Could not read the saved skill profile.", error);
  }
  document.querySelector("#skill-gap-options").innerHTML = skills.map((skill) =>
    `<label class="skill-gap-option"><input type="checkbox" value="${escapeHtml(skill)}"${knownSkills.includes(skill) ? " checked" : ""}><span>${escapeHtml(skill)}</span></label>`
  ).join("");
  const missing = skills.filter((skill) => !knownSkills.includes(skill));
  const closestCourse = [...courses, ...uploadedCourses].find((course) => missing.some((skill) => `${course.subject} ${course.skills.join(" ")}`.toLowerCase().includes(skill.toLowerCase())));
  const result = document.querySelector("#skill-gap-result");
  result.textContent = missing.length
    ? `Good next skills to explore: ${missing.join(", ")}. Start small and build one example you can show.`
    : "You’ve checked every suggested skill. Choose a small project to turn that knowledge into evidence.";
  const courseButton = document.querySelector("[data-scroll-course]");
  courseButton.dataset.suggestedCourse = closestCourse?.id || "";
  courseButton.textContent = closestCourse ? `Start ${closestCourse.title} →` : "Browse learning courses →";
}

function saveSkillGap() {
  const career = document.querySelector("#skill-gap-career").value;
  const knownSkills = [...document.querySelectorAll("#skill-gap-options input:checked")].map((input) => input.value);
  try {
    const stored = JSON.parse(window.localStorage.getItem("pathfinder.skillGap") || "{}");
    stored[career] = knownSkills;
    window.localStorage.setItem("pathfinder.skillGap", JSON.stringify(stored));
    window.localStorage.setItem("pathfinder.skillGapCareer", career);
    renderSkillGap();
  } catch (error) {
    console.error("Could not save the skill profile.", error);
    showToast("Your skill check could not be saved on this device.");
  }
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function recordUserActivity(type, subject) {
  const recordActivity = window.pathfinderApi?.recordActivity;
  if (typeof recordActivity !== "function") return;
  recordActivity(type, subject).catch((error) => console.error("Could not record user activity.", error));
}

function scheduleSearchActivity(input, type) {
  window.clearTimeout(searchActivityTimers.get(input));
  const subject = input.value.trim().replace(/\s+/g, " ");
  if (!subject) return;
  const timer = window.setTimeout(() => recordUserActivity(type, subject), 650);
  searchActivityTimers.set(input, timer);
}

function setView(viewName) {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const isActive = panel.id === `view-${viewName}`;
    panel.hidden = !isActive;
    panel.classList.toggle("active", isActive);
  });
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
  const currentLink = document.querySelector(`.nav-link[data-view="${viewName}"] span:not(.nav-link-symbol)`);
  document.querySelector("#breadcrumb-current").textContent = viewName === "overview" ? "Overview" : currentLink?.textContent || "Overview";
  document.querySelector("#sidebar").classList.remove("open");
  if (viewName === "careers") renderCareers();
  if (viewName === "saved") renderSavedCareers();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAssessment() {
  document.querySelector("#assessment-modal").hidden = false;
  document.querySelector("#modal-close").focus();
}

function closeAssessment() {
  document.querySelector("#assessment-modal").hidden = true;
}

function renderCourses() {
  const search = document.querySelector("#course-search").value.trim().toLowerCase();
  const filtered = courses.filter((course) => {
    const searchable = `${course.title} ${course.subject} ${course.level} ${course.skills.join(" ")}`.toLowerCase();
    return (activeCourseLevel === "All" || course.level === activeCourseLevel) && searchable.includes(search);
  });
  document.querySelector("#course-results").textContent = `${filtered.length} ${filtered.length === 1 ? "course" : "courses"} · free video lessons`;
  document.querySelector("#course-empty").hidden = filtered.length > 0;
  document.querySelector("#course-library").innerHTML = filtered.map((course) => {
    const completed = completedCourses.has(course.id);
    const thumbnail = course.thumbnailUrl || `https://img.youtube.com/vi/${course.video}/hqdefault.jpg`;
    const progress = localVideoProgress.get(course.id);
    return `<article class="course-card${completed ? " course-completed" : ""}">
      <button class="course-cover course-cover-${course.color}" type="button" data-open-course="${escapeHtml(course.id)}" aria-label="Play ${escapeHtml(course.title)}">
        <img src="${thumbnail}" alt="" loading="lazy">
        <span class="course-cover-shade"></span><span class="course-subject">${escapeHtml(course.subject)}</span><span class="course-play" aria-hidden="true">▶</span>
        ${completed ? '<span class="course-done-badge">✓ Completed</span>' : progress ? `<span class="course-done-badge">${Math.floor(progress)}% watched</span>` : ""}
      </button>
      <div class="course-card-body">
        <div class="course-card-meta"><span class="course-level">${escapeHtml(course.level)}</span><span>VIDEO COURSE</span></div>
        <h3>${escapeHtml(course.title)}</h3><p>${escapeHtml(course.description)}</p>
        <div class="course-card-bottom"><span>${escapeHtml(course.skills.join(" · "))}</span><button class="course-open-link" type="button" data-open-course="${escapeHtml(course.id)}">${completed ? "Watch again" : "Start learning"} <span aria-hidden="true">→</span></button></div>
      </div>
    </article>`;
  }).join("");
  updateCourseProgress();
  renderSkillGap();
}

function updateCourseProgress() {
  const allCourses = [...courses, ...uploadedCourses];
  const completed = allCourses.filter((course) => completedCourses.has(course.id)).length;
  const total = allCourses.length;
  document.querySelector("#course-progress-count").textContent = `${completed} / ${total}`;
  document.querySelector("#course-progress-bar").style.width = `${(completed / total) * 100}%`;
  document.querySelector(".studio-progress").setAttribute("aria-valuemax", String(total));
  document.querySelector(".studio-progress").setAttribute("aria-valuenow", String(completed));
  document.querySelector("#course-progress-title").textContent = completed === total ? "Every course complete — amazing work!" : completed ? "You’re building real momentum" : "Your learning journey";
  document.querySelector("#course-progress-copy").textContent = completed ? `${completed} ${completed === 1 ? "course" : "courses"} complete. Keep exploring at your own pace.` : "Pick a course, learn at your pace, and track what you finish.";
}

function openCourse(courseId, trigger) {
  const allCourses = [...courses, ...uploadedCourses];
  const courseIndex = allCourses.findIndex((course) => course.id === courseId);
  if (courseIndex < 0) return;
  activeCourseId = courseId;
  courseTrigger = trigger || courseTrigger;
  const course = allCourses[courseIndex];
  recordUserActivity("course_view", course.title);
  recordUserActivity("video_view", course.title);
  activeCourseProgress = localVideoProgress.get(course.id) || 0;
  document.querySelector("#video-title").textContent = course.title;
  document.querySelector("#video-course-meta").textContent = `${course.subject} · ${course.creator} video`;
  document.querySelector("#video-course-level").textContent = course.level;
  document.querySelector("#video-course-description").textContent = course.description;
  const remotePlayer = document.querySelector("#course-player");
  const localPlayer = document.querySelector("#local-course-player");
  localPlayer.pause();
  localPlayer.hidden = !course.local;
  remotePlayer.hidden = Boolean(course.local);
  if (course.local) {
    remotePlayer.src = "about:blank";
    localPlayer.src = course.videoUrl;
    localPlayer.currentTime = 0;
  } else {
    localPlayer.removeAttribute("src");
    remotePlayer.title = `${course.videoTitle} by ${course.creator}`;
    remotePlayer.src = `https://www.youtube-nocookie.com/embed/${course.video}?autoplay=1&rel=0&controls=1`;
  }
  document.querySelector("#previous-course").disabled = courseIndex === 0;
  document.querySelector("#next-course").disabled = courseIndex === allCourses.length - 1;
  const completeButton = document.querySelector("#complete-course");
  completeButton.disabled = completedCourses.has(course.id);
  completeButton.textContent = completedCourses.has(course.id) ? "Completed ✓" : "Mark complete ✓";
  const related = allCourses.filter((item) => item.id !== course.id && (item.subject === course.subject || item.level === course.level)).slice(0, 3);
  document.querySelector("#related-courses").innerHTML = related.map((item) => `<button class="related-course" type="button" data-related-course="${escapeHtml(item.id)}">${escapeHtml(item.title)} <span>→</span></button>`).join("") || "<span>More courses are coming soon.</span>";
  document.querySelector("#video-modal").hidden = false;
  document.querySelector("#video-modal-close").focus();
}

function closeVideo() {
  const modal = document.querySelector("#video-modal");
  const player = document.querySelector("#course-player");
  const localPlayer = document.querySelector("#local-course-player");
  if (modal.hidden) return;
  localPlayer.pause();
  localPlayer.removeAttribute("src");
  player.src = "about:blank";
  modal.hidden = true;
  courseTrigger?.focus();
  courseTrigger = null;
  activeCourseId = null;
}

function openCareer(title, trigger) {
  const career = careers.find((item) => item.title === title);
  if (!career) return;
  activeCareerTitle = title;
  recordUserActivity("career_view", title);
  careerTrigger = trigger || careerTrigger;
  document.querySelector("#career-modal-title").textContent = career.title;
  document.querySelector("#career-modal-description").textContent = `${career.category} · ${career.outlook}. ${career.description}`;
  document.querySelector("#career-modal-skills").textContent = career.skills;
  document.querySelector("#career-modal-next-step").textContent = `Try a 30-minute beginner project related to ${career.title.toLowerCase()}, then write down what felt energizing.`;
  const saved = savedCareers.has(title);
  const saveButton = document.querySelector("#career-modal-save");
  saveButton.textContent = saved ? "Remove from saved ♥" : "Save this path ♡";
  document.querySelector("#career-modal").hidden = false;
  document.querySelector("#career-modal-close").focus();
}

function closeCareer() {
  const modal = document.querySelector("#career-modal");
  if (modal.hidden) return;
  modal.hidden = true;
  careerTrigger?.focus();
  careerTrigger = null;
  activeCareerTitle = null;
}

function initializeTheme() {
  const preference = window.localStorage.getItem(themeKey);
  document.body.dataset.theme = preference === "dark" ? "dark" : "light";
  updateThemeButton();
}

function updateThemeButton() {
  const dark = document.body.dataset.theme === "dark";
  const button = document.querySelector("#theme-toggle");
  button.textContent = dark ? "☼" : "◐";
  button.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
}

renderCourses();
document.querySelector("#featured-careers").innerHTML = careers.slice(0, 3).map(careerCard).join("");
renderCareers();
initializeTheme();
loadUploadedCourses();

document.addEventListener("click", (event) => {
  const courseButton = event.target.closest("[data-open-course]");
  if (courseButton) {
    openCourse(courseButton.dataset.openCourse, courseButton);
    return;
  }
  const relatedCourse = event.target.closest("[data-related-course]");
  if (relatedCourse) {
    openCourse(relatedCourse.dataset.relatedCourse);
    return;
  }
  const careerButton = event.target.closest("[data-open-career]");
  if (careerButton) {
    openCareer(careerButton.dataset.openCareer, careerButton);
    return;
  }
  const courseCard = event.target.closest(".course-card");
  if (courseCard && !event.target.closest("button, a, input, textarea, select, label")) {
    const fallbackCourseButton = courseCard.querySelector("[data-open-course]");
    if (fallbackCourseButton) {
      openCourse(fallbackCourseButton.dataset.openCourse, fallbackCourseButton);
      return;
    }
  }
  const careerCard = event.target.closest(".career-card");
  if (careerCard && !event.target.closest("button, a, input, textarea, select, label")) {
    const fallbackCareerButton = careerCard.querySelector("[data-open-career]");
    if (fallbackCareerButton) {
      openCareer(fallbackCareerButton.dataset.openCareer, fallbackCareerButton);
      return;
    }
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.view !== "activity") {
      const label = viewButton.textContent.trim().replace(/\s+/g, " ").slice(0, 160) || viewButton.dataset.view;
      recordUserActivity("section_click", label);
    }
    setView(viewButton.dataset.view);
    if (viewButton.hasAttribute("data-coach-practice")) document.querySelector('[data-coach-mode="practice"]').click();
    return;
  }
  if (event.target.closest("[data-open-assessment]")) {
    recordUserActivity("section_click", "Career profile assessment");
    openAssessment();
    return;
  }
  const saveButton = event.target.closest("[data-save-career]");
  if (saveButton) {
    const careerTitle = saveButton.dataset.saveCareer;
    if (savedCareers.has(careerTitle)) {
      savedCareers.delete(careerTitle);
      showToast(`${careerTitle} removed from saved paths.`);
    } else {
      savedCareers.add(careerTitle);
      showToast(`${careerTitle} saved for later.`);
    }
    saveProfile().then(() => showToast(savedCareers.has(careerTitle) ? `${careerTitle} saved to your paths.` : `${careerTitle} removed from saved paths.`))
      .catch((error) => showToast(error.message || "Could not save your career paths."));
    document.querySelector("#featured-careers").innerHTML = careers.slice(0, 3).map(careerCard).join("");
    renderCareers();
    return;
  }
  if (event.target.closest("#modal-close") || event.target.id === "assessment-modal") closeAssessment();
  if (event.target.closest("#career-modal-close") || event.target.id === "career-modal") closeCareer();
  if (event.target.closest("#video-modal-close") || event.target.id === "video-modal") closeVideo();
  if (event.target.closest("#previous-course") || event.target.closest("#next-course")) {
    const offset = event.target.closest("#next-course") ? 1 : -1;
    const allCourses = [...courses, ...uploadedCourses];
    const courseIndex = allCourses.findIndex((course) => course.id === activeCourseId);
    const nextCourse = allCourses[courseIndex + offset];
    if (nextCourse) openCourse(nextCourse.id);
  }
  if (event.target.closest("#complete-course") && activeCourseId) {
    const courseId = activeCourseId;
    completedCourses.add(courseId);
    try {
      window.localStorage.setItem("pathfinder.completedCourses", JSON.stringify([...completedCourses]));
    } catch (error) {
      completedCourses.delete(courseId);
      showToast("Course progress could not be saved on this device.");
      return;
    }
    renderCourses();
    openCourse(courseId, document.querySelector(`[data-open-course="${courseId}"]`));
  }
  if (event.target.closest("#career-modal-save") && activeCareerTitle) {
    const title = activeCareerTitle;
    if (savedCareers.has(title)) savedCareers.delete(title);
    else savedCareers.add(title);
    document.querySelector("#featured-careers").innerHTML = careers.slice(0, 3).map(careerCard).join("");
    renderCareers();
    const trigger = [...document.querySelectorAll("[data-open-career]")].find((button) => button.dataset.openCareer === title);
    openCareer(title, trigger);
    saveProfile().catch((error) => showToast(error.message || "Could not save your career paths."));
  }
  if (event.target.closest("#career-modal-roadmap") && activeCareerTitle) {
    const career = careers.find((item) => item.title === activeCareerTitle);
    window.localStorage.setItem("pathfinder.roadmapCareer", career.title);
    document.querySelector("#roadmap-focus-title").textContent = `Explore ${career.title}`;
    document.querySelector("#roadmap-focus-copy").textContent = `Start with ${career.skills.toLowerCase()}. Try a small project and notice which parts you want to learn more about.`;
    closeCareer();
    setView("roadmap");
    showToast(`${career.title} added to your roadmap.`);
  }
  if (event.target.closest("#theme-toggle")) {
    document.body.dataset.theme = document.body.dataset.theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(themeKey, document.body.dataset.theme);
    updateThemeButton();
  }
  if (event.target.closest("[data-scroll-course]")) {
    const suggestedId = event.target.closest("[data-scroll-course]").dataset.suggestedCourse;
    setView("overview");
    window.setTimeout(() => {
      document.querySelector("#demo-title").scrollIntoView({ behavior: "smooth" });
      if (suggestedId) {
        const courseCard = [...document.querySelectorAll("[data-open-course]")].find((button) => button.dataset.openCourse === suggestedId);
        courseCard?.focus();
      }
    }, 0);
  }
  if (event.target.closest("#menu-toggle")) document.querySelector("#sidebar").classList.toggle("open");
});

document.querySelector("#career-search").addEventListener("input", (event) => {
  renderCareers();
  scheduleSearchActivity(event.currentTarget, "career_search");
});
document.querySelector("#course-search").addEventListener("input", (event) => {
  renderCourses();
  scheduleSearchActivity(event.currentTarget, "course_search");
});
document.addEventListener("click", (event) => {
  const opportunityLink = event.target.closest(".opportunity-card a, .prep-card a");
  if (opportunityLink) recordUserActivity("section_click", opportunityLink.textContent.trim().replace(/\s+/g, " ").slice(0, 160));
  if (event.target.closest("[data-scroll-course]")) recordUserActivity("section_click", "Skills learning recommendations");
});
document.querySelector("#skill-gap-career").addEventListener("change", () => {
  window.localStorage.setItem("pathfinder.skillGapCareer", document.querySelector("#skill-gap-career").value);
  renderSkillGap();
});
document.querySelector("#skill-gap-options").addEventListener("change", saveSkillGap);
document.querySelectorAll(".course-filter").forEach((button) => {
  button.addEventListener("click", () => {
    activeCourseLevel = button.dataset.courseLevel;
    document.querySelectorAll(".course-filter").forEach((filter) => {
      const isActive = filter === button;
      filter.classList.toggle("active", isActive);
      filter.setAttribute("aria-pressed", String(isActive));
    });
    renderCourses();
  });
});
document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((filter) => filter.classList.toggle("active", filter === button));
    renderCareers();
  });
});

document.querySelector("#local-course-player").addEventListener("timeupdate", (event) => {
  const player = event.currentTarget;
  if (!activeCourseId || !Number.isFinite(player.duration) || !player.duration) return;
  const progress = Math.min(100, (player.currentTime / player.duration) * 100);
  if (progress - activeCourseProgress < 5 && progress < 100) return;
  activeCourseProgress = progress;
  localVideoProgress.set(activeCourseId, progress);
  try {
    window.localStorage.setItem("pathfinder.courseProgress", JSON.stringify(Object.fromEntries(localVideoProgress)));
    renderCourses();
  } catch (error) {
    showToast("Video progress could not be saved on this device.");
  }
});
document.querySelector("#local-course-player").addEventListener("ended", () => {
  if (!activeCourseId) return;
  completedCourses.add(activeCourseId);
  localVideoProgress.set(activeCourseId, 100);
  try {
    window.localStorage.setItem("pathfinder.completedCourses", JSON.stringify([...completedCourses]));
    window.localStorage.setItem("pathfinder.courseProgress", JSON.stringify(Object.fromEntries(localVideoProgress)));
    renderCourses();
    document.querySelector("#complete-course").disabled = true;
    document.querySelector("#complete-course").textContent = "Completed ✓";
    showToast("Course complete. Great work!");
  } catch (error) {
    showToast("Course progress could not be saved on this device.");
  }
});

document.querySelector("#instructor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (document.querySelector("#instructor-panel").hidden) {
    showToast("Instructor access is required to add courses.");
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const video = data.get("video");
  const thumbnail = data.get("thumbnail");
  const allowedTypes = ["video/mp4", "video/webm", "video/ogg"];
  if (!(video instanceof File) || !allowedTypes.includes(video.type) || video.size > 100 * 1024 * 1024) {
    showToast("Choose an MP4, WebM, or Ogg video smaller than 100 MB.");
    return;
  }
  if (thumbnail instanceof File && thumbnail.size > 5 * 1024 * 1024) {
    showToast("Choose a thumbnail smaller than 5 MB.");
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Saving local course…";
  const course = {
    id: `local-${crypto.randomUUID()}`,
    title: String(data.get("title")).trim(),
    subject: String(data.get("category")).trim(),
    level: "Beginner",
    creator: "Local instructor",
    videoTitle: video.name,
    description: String(data.get("description")).trim(),
    skills: [String(data.get("category")).trim(), "Instructor upload"],
    color: "html",
    local: true,
  };
  try {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("uploads", "readwrite");
      transaction.objectStore("uploads").put({ id: course.id, video, thumbnail: thumbnail instanceof File && thumbnail.size ? thumbnail : null });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    const metadata = JSON.parse(window.localStorage.getItem("pathfinder.uploadedCourses") || "[]");
    metadata.push(course);
    window.localStorage.setItem("pathfinder.uploadedCourses", JSON.stringify(metadata));
    course.videoUrl = URL.createObjectURL(video);
    course.thumbnailUrl = thumbnail instanceof File && thumbnail.size ? URL.createObjectURL(thumbnail) : "";
    objectUrls.push(course.videoUrl);
    if (course.thumbnailUrl) objectUrls.push(course.thumbnailUrl);
    uploadedCourses.push(course);
    renderCourses();
    form.reset();
    showToast("Your course was added to this browser.");
  } catch (error) {
    console.error("Could not save local instructor course.", error);
    showToast("The course could not be saved. Check browser storage and try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Add local course <span aria-hidden="true">＋</span>';
  }
});

document.querySelector("#resume-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const resume = [
    String(values.get("name")).trim(),
    String(values.get("email")).trim(),
    "",
    `TARGET ROLE: ${String(values.get("role")).trim()}`,
    `EDUCATION: ${String(values.get("education")).trim()}`,
    `SKILLS: ${String(values.get("skills")).trim()}`,
    "",
    "PROJECT HIGHLIGHT",
    String(values.get("project")).trim(),
    "",
    "Review this draft and tailor it to each application."
  ].join("\r\n");
  const file = new Blob([resume], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pathfinder-resume-draft.txt";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Your resume draft is ready to review.");
});

document.querySelector("#course-library").addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}, true);

document.querySelector("#assessment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const assessment = { interest: formData.get("interest"), workStyle: formData.get("workStyle") };
  const previousAssessment = currentAssessment;
  currentAssessment = assessment;
  try {
    await saveProfile();
  } catch (error) {
    currentAssessment = previousAssessment;
    showToast(error.message || "Your check-in could not be saved.");
    return;
  }
  document.querySelector("#profile-progress").textContent = "82";
  document.querySelector(".progress-ring").setAttribute("aria-label", "Profile 82 percent complete");
  closeAssessment();
  showToast("Your profile is updated. Your next steps are taking shape.");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAssessment();
    closeVideo();
    closeCareer();
    document.querySelector("#sidebar").classList.remove("open");
  }
  if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    setView("careers");
    document.querySelector("#career-search").focus();
  }
});

const savedRoadmapCareer = window.localStorage.getItem("pathfinder.roadmapCareer");
if (savedRoadmapCareer && careers.some((career) => career.title === savedRoadmapCareer)) {
  const career = careers.find((item) => item.title === savedRoadmapCareer);
  document.querySelector("#roadmap-focus-title").textContent = `Explore ${career.title}`;
  document.querySelector("#roadmap-focus-copy").textContent = `Start with ${career.skills.toLowerCase()}. Try a small project and notice which parts you want to learn more about.`;
}

window.addEventListener("beforeunload", () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
