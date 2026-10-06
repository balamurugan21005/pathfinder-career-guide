const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createDataStore } = require("./database");

const ROOT = __dirname;
const envFile = path.join(ROOT, ".env");
if (fsSync.existsSync(envFile)) process.loadEnvFile(envFile);
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 40 * 1024;
const PASSWORD_BYTES = 64;
const PASSWORD_COST = 16384;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const CAREER_HINTS = [
  { title: "UX / UI Designer", category: "Creative", skills: "Design and research", reason: "you enjoy making things useful and human-centered" },
  { title: "Product Designer", category: "Creative", skills: "Strategy and design", reason: "you like turning ideas into useful experiences" },
  { title: "Front-end Developer", category: "Technology", skills: "JavaScript and accessibility", reason: "you enjoy building things with technology" },
  { title: "Data Storyteller", category: "Technology", skills: "Analysis and communication", reason: "you like finding patterns and explaining them" },
  { title: "Learning Experience Designer", category: "People", skills: "Learning design and facilitation", reason: "you want to help people learn and grow" },
  { title: "Creative Technologist", category: "Technology", skills: "Prototyping and creative code", reason: "you enjoy exploring where creativity meets technology" },
];

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function createServer(options = {}) {
  const aiApiKey = (options.aiApiKey ?? process.env.AI_API_KEY ?? "").trim();
  const defaultAiApiUrl = aiApiKey.startsWith("sk-or-")
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const aiApiUrl = options.aiApiUrl || process.env.AI_API_URL || defaultAiApiUrl;
  const aiModel = options.aiModel || process.env.AI_MODEL || "gpt-4o-mini";
  const configuredInstructorEmails = options.instructorEmails ?? process.env.INSTRUCTOR_EMAILS ?? "";
  const instructorEmailList = Array.isArray(configuredInstructorEmails) ? configuredInstructorEmails : String(configuredInstructorEmails).split(",");
  const instructorEmails = new Set(instructorEmailList.map((email) => String(email).trim().toLowerCase()).filter(Boolean));
  const isAdmin = (user) => instructorEmails.has(user.email);
  const publicUser = (user) => ({ name: user.name, email: user.email, isInstructor: instructorEmails.has(user.email) });
  async function recordAccountActivity(user, type, subject, label) {
    await store.createActivity({
      id: crypto.randomUUID(),
      type,
      subject,
      label,
      userEmail: user.email,
      userName: user.name,
      createdAt: new Date().toISOString(),
    });
  }
  let store;
  const ready = createDataStore(options).then((database) => {
    store = database;
    return database;
  });

  async function getUser(email) {
    return store.findUser(email);
  }

  async function createSession(email, response) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = Date.now() + SESSION_TTL;
    await store.createSession(tokenHash, email, expiresAt);
    response.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL / 1000));
  }

  function sessionCookie(token, maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `pathfinder_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
  }

  async function getSession(request) {
    const cookie = request.headers.cookie || "";
    const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pathfinder_session="))?.split("=")[1];
    if (!token) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await store.findSession(tokenHash);
    if (!session || session.expires_at <= Date.now()) {
      if (session) await store.deleteSession(tokenHash);
      return null;
    }
    return { tokenHash, email: session.email, expiresAt: session.expires_at };
  }

  function isSameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  async function readJson(request) {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large.");
        error.status = 413;
        throw error;
      }
    }
    try {
      return JSON.parse(body || "{}");
    } catch {
      const error = new Error("Request must contain valid JSON.");
      error.status = 400;
      throw error;
    }
  }

  async function authenticatedUser(request) {
    const session = await getSession(request);
    return session ? { session, user: await getUser(session.email) } : null;
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, ai: Boolean(aiApiKey), database: store.kind });
    }

    if (request.method === "POST" && ["/api/auth/register", "/api/auth/login", "/api/auth/admin-login", "/api/auth/logout"].includes(url.pathname)) {
      if (!isSameOrigin(request)) return json(response, 403, { error: "Cross-origin request rejected." });
    }
    if (["POST", "PATCH", "DELETE"].includes(request.method) && url.pathname.startsWith("/api/") && !isSameOrigin(request)) {
      return json(response, 403, { error: "Cross-origin request rejected." });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      const auth = await authenticatedUser(request);
      if (!auth?.user) return json(response, 200, { user: null });
      return json(response, 200, {
        user: publicUser(auth.user),
        profile: auth.user.profile,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await readJson(request);
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (name.length < 2 || name.length > 60) return json(response, 400, { error: "Enter a name between 2 and 60 characters." });
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 400, { error: "Enter a valid email address." });
      if (password.length < 10 || password.length > 128) return json(response, 400, { error: "Your password must be between 10 and 128 characters." });
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = await new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, PASSWORD_BYTES, { N: PASSWORD_COST }, (error, hash) => error ? reject(error) : resolve(hash.toString("hex")));
      });
      try {
        await store.createUser({ email, name, salt, password_hash: passwordHash, created_at: new Date().toISOString() });
      } catch (error) {
        if ([1555, 2067].includes(error.errcode) || error.code === 11000) {
          return json(response, 409, { error: "An account already exists for this email." });
        }
        throw error;
      }
      await store.deleteExpiredSessions(Date.now());
      await createSession(email, response);
      const user = await getUser(email);
      if (!isAdmin(user)) await recordAccountActivity(user, "account_created", "Pathfinder", "created an account on");
      return json(response, 201, { user: publicUser(user), profile: user.profile });
    }

    if (request.method === "POST" && ["/api/auth/login", "/api/auth/admin-login"].includes(url.pathname)) {
      const isAdminLogin = url.pathname === "/api/auth/admin-login";
      const body = await readJson(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const now = Date.now();
      await store.trimLoginAttempts(now - 24 * 60 * 60 * 1000);
      const attemptKey = `${request.socket.remoteAddress || "unknown"}:${email}`;
      const storedAttempts = await store.getLoginAttempts(attemptKey);
      const attempts = !storedAttempts || storedAttempts.updated_at < now - 10 * 60 * 1000
        ? { count: 0, until: 0 }
        : { count: storedAttempts.count, until: storedAttempts.locked_until };
      if (attempts.until > now) return json(response, 429, { error: "Too many attempts. Please try again in a few minutes." });
      const user = await getUser(email);
      const candidate = await new Promise((resolve, reject) => {
        crypto.scrypt(password.slice(0, 128), user?.salt || "00000000000000000000000000000000", PASSWORD_BYTES, { N: PASSWORD_COST }, (error, hash) => error ? reject(error) : resolve(hash));
      });
      const expectedHash = Buffer.from(user?.password_hash || "0".repeat(PASSWORD_BYTES * 2), "hex");
      const valid = password.length <= 128 && user !== null && crypto.timingSafeEqual(candidate, expectedHash);
      if (!valid) {
        attempts.count += 1;
        if (attempts.count >= 6) {
          attempts.count = 0;
          attempts.until = now + 5 * 60 * 1000;
        }
        await store.setLoginAttempts(attemptKey, attempts.count, attempts.until, now);
        return json(response, 401, { error: "Email or password isn’t correct." });
      }
      if (isAdminLogin && !isAdmin(user)) return json(response, 403, { error: "This account is not authorized for admin access." });
      await store.clearLoginAttempts(attemptKey);
      await store.deleteExpiredSessions(now);
      await createSession(email, response);
      if (!isAdminLogin && !isAdmin(user)) await recordAccountActivity(user, "user_login", "Pathfinder", "signed in to");
      return json(response, 200, { user: publicUser(user), profile: user.profile });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const auth = await getSession(request);
      if (auth) await store.deleteSession(auth.tokenHash);
      response.setHeader("Set-Cookie", sessionCookie("", 0));
      return json(response, 200, { ok: true });
    }

    const auth = await authenticatedUser(request);
    if (!auth?.user) return json(response, 401, { error: "Sign in to continue." });

    if (request.method === "PUT" && url.pathname === "/api/profile") {
      const body = await readJson(request);
      const assessment = body.assessment === undefined ? auth.user.profile.assessment : body.assessment;
      if (assessment !== null && (!assessment || !["Technology", "Creative", "People", "All"].includes(assessment.interest) || typeof assessment.workStyle !== "string" || assessment.workStyle.length > 80)) {
        return json(response, 400, { error: "That profile check-in isn’t valid." });
      }
      const savedCareers = Array.isArray(body.savedCareers) ? [...new Set(body.savedCareers.filter((title) => typeof title === "string" && title.length <= 100))].slice(0, 30) : auth.user.profile.savedCareers;
      const messages = Array.isArray(body.messages) ? body.messages.filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.length <= 1600).slice(-12) : auth.user.profile.messages;
      const profile = { assessment, savedCareers, messages };
      await store.updateProfile(auth.user.email, profile);
      return json(response, 200, { profile });
    }

    if (request.method === "POST" && url.pathname === "/api/activity") {
      const body = await readJson(request);
      const types = {
        search: "searched for",
        course_search: "searched courses for",
        career_search: "searched career paths for",
        career_view: "viewed the career path",
        course_view: "viewed the course",
        video_view: "started a video for",
        section_click: "visited the section",
      };
      const type = typeof body.type === "string" ? body.type : "";
      const subject = typeof body.subject === "string" ? body.subject.trim().replace(/\s+/g, " ") : "";
      if (!Object.hasOwn(types, type) || !subject || subject.length > 160) {
        return json(response, 400, { error: "Provide a valid activity type and a subject under 160 characters." });
      }
      const activity = {
        id: crypto.randomUUID(),
        type,
        subject,
        label: types[type],
        userEmail: auth.user.email,
        userName: auth.user.name,
        createdAt: new Date().toISOString(),
      };
      await store.createActivity(activity);
      return json(response, 201, { ok: true });
    }

    if (url.pathname.startsWith("/api/admin/activities")) {
      if (!isAdmin(auth.user)) return json(response, 403, { error: "Admin access is required." });
      if (request.method === "GET" && url.pathname === "/api/admin/activities") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 100));
        const offset = Math.min(1000000, Math.max(0, Number(url.searchParams.get("offset")) || 0));
        const [activities, unreadCount, totalCount, courseSearchCount] = await Promise.all([
          store.listActivities(offset, limit),
          store.countUnreadActivities(),
          store.countActivities(),
          store.countCourseSearchActivities(),
        ]);
        return json(response, 200, { activities, unreadCount, totalCount, courseSearchCount });
      }
      if (request.method === "PATCH" && url.pathname === "/api/admin/activities/read") {
        const body = await readJson(request);
        if (body.all === true) {
          await store.markAllActivitiesRead();
          return json(response, 200, { ok: true, unreadCount: await store.countUnreadActivities() });
        }
        const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id) => typeof id === "string" && id.length <= 100))].slice(0, 200) : [];
        if (!ids.length) return json(response, 400, { error: "Select at least one activity to mark as read." });
        for (const id of ids) await store.markActivityRead(id);
        return json(response, 200, { ok: true, unreadCount: await store.countUnreadActivities() });
      }
      if (request.method === "DELETE" && url.pathname === "/api/admin/activities") {
        await store.clearActivities();
        return json(response, 200, { ok: true, unreadCount: 0 });
      }
      return json(response, 405, { error: "Method not allowed." });
    }

    if (request.method === "POST" && url.pathname === "/api/coach") {
      const body = await readJson(request);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
      const mode = ["career", "skills", "interview"].includes(body.mode) ? body.mode : "career";
      const messages = Array.isArray(body.messages) ? body.messages.filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string").slice(-8).map((message) => ({ role: message.role, content: message.content.slice(0, 1200) })) : [];
      if (!prompt) return json(response, 400, { error: "Write a question for your career guide first." });
      const assessment = auth.user.profile.assessment;
      const modeInstructions = {
        career: "Suggest fitting paths, explain the fit, and offer a low-risk way to test an option.",
        skills: "Build a practical, beginner-friendly four-week skill plan with weekly outcomes and one small portfolio project.",
        interview: "Run a supportive interview practice session. Ask one realistic question at a time, then offer concise feedback when the student answers.",
      };
      const systemPrompt = `You are Pathfinder, a supportive and practical career guide for college students. Help the student explore options without making decisions for them. ${modeInstructions[mode]} Give specific, realistic next steps and distinguish facts from suggestions. Keep responses to 180 words or fewer. Never claim certainty about job outcomes. Student name: ${auth.user.name}. Interest: ${assessment?.interest || "not shared yet"}. Preferred work style: ${assessment?.workStyle || "not shared yet"}. Saved career paths: ${auth.user.profile.savedCareers.join(", ") || "none yet"}.`;
      if (aiApiKey) {
        try {
          const aiResponse = await fetch(aiApiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: aiModel, temperature: 0.7, max_tokens: 300, messages: [{ role: "system", content: systemPrompt }, ...messages, { role: "user", content: prompt }] }),
            signal: AbortSignal.timeout(20000),
          });
          if (!aiResponse.ok) {
            const statusMessages = {
              401: "The AI provider rejected the API key. Check AI_API_KEY.",
              403: "The AI provider denied the request. Check the API key's permissions and model access.",
              404: "The AI model or API URL was not found. Check AI_MODEL and AI_API_URL.",
              429: "The AI provider is rate-limiting requests or the account has no available quota.",
            };
            const message = statusMessages[aiResponse.status]
              || (aiResponse.status >= 500
                ? "The AI provider is temporarily unavailable. Please try again shortly."
                : `The AI provider returned HTTP ${aiResponse.status}. Check its API settings.`);
            console.error(`AI provider request failed with HTTP status ${aiResponse.status}`);
            return json(response, 502, { error: message });
          }
          const result = await aiResponse.json();
          const answer = result.choices?.[0]?.message?.content?.trim();
          if (typeof answer !== "string" || !answer) throw new Error("AI provider returned an empty response");
          return json(response, 200, { answer, mode: "ai" });
        } catch (error) {
          console.error("AI provider request failed:", error.message);
          return json(response, 502, { error: "Could not reach the AI provider. Check AI_API_URL and your internet connection." });
        }
      }
      const selected = CAREER_HINTS.filter((career) => !assessment || assessment.interest === "All" || career.category === assessment.interest);
      const chosen = selected.length ? selected.slice(0, 3) : CAREER_HINTS.slice(0, 3);
      const style = assessment?.workStyle || "Learning something";
      const answers = {
        career: `A few paths worth exploring for you, ${auth.user.name.split(" ")[0]}:\n\n${chosen.map((career) => `• ${career.title}: a fit if ${career.reason}. Start with ${career.skills.toLowerCase()}.`).join("\n\n")}\n\nA small experiment: spend 30 minutes on a beginner ${style.toLowerCase()} project, then note what you enjoyed and what you would change. Your interests can guide the next step without locking you into a choice.`,
        skills: `A starter skill plan for ${assessment?.interest || "your interests"}:\n\nWeek 1: Pick one beginner-friendly tool and complete its first guided lesson.\nWeek 2: Recreate a small example in your own style and write down what you learned.\nWeek 3: Make a tiny project that solves a real problem you care about.\nWeek 4: Share it with one person, gather feedback, and revise one thing.\n\nKeep the project small enough to finish. If you tell me which role interests you, I can tailor the skills and project.`,
        interview: `Let’s practice one question at a time.\n\nFirst question: Tell me about a small project, class assignment, or challenge you enjoyed. What were you trying to do, what did you contribute, and what did you learn?\n\nReply as if you were in the interview. I’ll help you make your answer clearer and more specific.`,
      };
      const answer = answers[mode];
      return json(response, 200, { answer, mode: "local" });
    }

    return json(response, 404, { error: "That API route doesn’t exist." });
  }

  const server = http.createServer(async (request, response) => {
    try {
      await server.ready;
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed." });
      const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const allowedFiles = new Set(["index.html", "script.js", "style.css", "auth.js"]);
      if (!allowedFiles.has(relativePath)) return json(response, 404, { error: "Page not found." });
      const filePath = path.join(ROOT, relativePath);
      const contents = await fs.readFile(filePath);
      response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https://images.unsplash.com https://img.youtube.com data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "Something went wrong on the server." });
      else response.destroy();
      if (!error.status) console.error(error);
    }
  });

  server.ready = ready;
  server.on("close", () => {
    if (store) Promise.resolve(store.close()).catch((error) => console.error("Could not close the user database:", error));
  });
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.ready.then(() => {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || "127.0.0.1";
    server.listen(port, host, () => console.log(`Pathfinder is running at http://${host}:${port}`));
  }).catch((error) => {
    console.error("Could not load the user database:", error);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
