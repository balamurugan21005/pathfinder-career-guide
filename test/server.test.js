const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createServer } = require("../server");

async function startServer(dataFile, options = {}) {
  const server = createServer({ dataFile, ...options });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function withServer(run, serverOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pathfinder-test-"));
  const dataFile = path.join(directory, "pathfinder.sqlite");
  const options = { mongoUri: null, ...serverOptions };
  let instance = await startServer(dataFile, options);
  try {
    await run({ ...instance, dataFile, restart: async () => {
      await new Promise((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()));
      instance = await startServer(dataFile, options);
      return instance;
    } });
  } finally {
    await new Promise((resolve) => instance.server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function request(baseUrl, endpoint, { method = "GET", body, cookie, origin = baseUrl } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

async function register(baseUrl, overrides = {}) {
  const { response, data } = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: { name: "Avery Morgan", email: "avery@example.edu", password: "secure-student-password", ...overrides },
  });
  return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("registers accounts with hashed passwords and rejects duplicate or weak credentials", async () => {
  await withServer(async ({ baseUrl, dataFile }) => {
    const first = await register(baseUrl);
    assert.equal(first.response.status, 201);
    assert.equal(first.data.user.email, "avery@example.edu");
    assert.match(first.response.headers.getSetCookie()[0], /HttpOnly/);
    const database = new DatabaseSync(dataFile, { readOnly: true });
    const stored = database.prepare("SELECT password_hash FROM users WHERE email = ?").get("avery@example.edu");
    database.close();
    assert.match(stored.password_hash, /^[a-f0-9]{128}$/);
    assert.notEqual(stored.password_hash, "secure-student-password");
    const duplicate = await register(baseUrl, { email: "AVERY@example.edu" });
    assert.equal(duplicate.response.status, 409);
    const weak = await register(baseUrl, { email: "new@example.edu", password: "short" });
    assert.equal(weak.response.status, 400);
  });
});

test("exposes instructor status only for configured accounts and scopes media policy", async () => {
  await withServer(async ({ baseUrl }) => {
    const health = await request(baseUrl, "/api/health");
    assert.deepEqual(health.data, { ok: true, ai: false, database: "sqlite" });
    const instructor = await register(baseUrl, { email: "teacher@example.edu" });
    assert.equal(instructor.data.user.isInstructor, true);
    const session = await request(baseUrl, "/api/auth/me", { cookie: instructor.cookie });
    assert.equal(session.data.user.isInstructor, true);
    const page = await fetch(baseUrl);
    const policy = page.headers.get("content-security-policy");
    assert.match(policy, /img-src[^;]*https:\/\/img\.youtube\.com/);
    assert.match(policy, /frame-src https:\/\/www\.youtube-nocookie\.com/);
  }, { instructorEmails: ["teacher@example.edu"] });
});

test("requires a session and persists profile changes across server restarts", async () => {
  await withServer(async ({ baseUrl, restart }) => {
    const anonymous = await request(baseUrl, "/api/profile", { method: "PUT", body: { assessment: null } });
    assert.equal(anonymous.response.status, 401);
    const account = await register(baseUrl);
    const profile = {
      assessment: { interest: "Technology", workStyle: "Solving a puzzle" },
      savedCareers: ["Front-end Developer"],
      messages: [{ role: "user", content: "What should I try?" }],
    };
    const updated = await request(baseUrl, "/api/profile", { method: "PUT", body: profile, cookie: account.cookie });
    assert.equal(updated.response.status, 200);
    const secondServer = await restart();
    const resumedSession = await request(secondServer.baseUrl, "/api/auth/me", { cookie: account.cookie });
    assert.equal(resumedSession.data.user.email, "avery@example.edu");
    assert.deepEqual(resumedSession.data.profile, profile);
    const signedIn = await request(secondServer.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "avery@example.edu", password: "secure-student-password" },
    });
    assert.equal(signedIn.response.status, 200);
    assert.deepEqual(signedIn.data.profile, profile);
  });
});

test("rejects cross-origin writes and invalid sign-ins", async () => {
  await withServer(async ({ baseUrl }) => {
    const blocked = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      origin: "https://untrusted.example",
      body: { name: "Avery Morgan", email: "avery@example.edu", password: "secure-student-password" },
    });
    assert.equal(blocked.response.status, 403);
    await register(baseUrl);
    const invalid = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "avery@example.edu", password: "not-the-password" },
    });
    assert.equal(invalid.response.status, 401);
  });
});

test("records student activity and restricts the live admin dashboard to allowlisted accounts", async () => {
  await withServer(async ({ baseUrl }) => {
    const student = await register(baseUrl);
    const admin = await register(baseUrl, { name: "Casey Admin", email: "admin@example.edu" });
    const signedInStudent = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "avery@example.edu", password: "secure-student-password" },
    });
    assert.equal(signedInStudent.response.status, 200);
    const deniedAdminLogin = await request(baseUrl, "/api/auth/admin-login", {
      method: "POST",
      body: { email: "avery@example.edu", password: "secure-student-password" },
    });
    assert.equal(deniedAdminLogin.response.status, 403);

    const unauthorized = await request(baseUrl, "/api/admin/activities", { cookie: student.cookie });
    assert.equal(unauthorized.response.status, 403);
    const anonymous = await request(baseUrl, "/api/activity", {
      method: "POST",
      body: { type: "course_search", subject: "Python" },
    });
    assert.equal(anonymous.response.status, 401);

    const created = await request(baseUrl, "/api/activity", {
      method: "POST",
      cookie: student.cookie,
      body: { type: "course_search", subject: "  Python   Course " },
    });
    assert.equal(created.response.status, 201);
    const secondSearch = await request(baseUrl, "/api/activity", {
      method: "POST",
      cookie: signedInStudent.response.headers.get("set-cookie")?.split(";")[0],
      body: { type: "course_search", subject: "JavaScript" },
    });
    assert.equal(secondSearch.response.status, 201);
    const listed = await request(baseUrl, "/api/admin/activities", { cookie: admin.cookie });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.unreadCount, 4);
    assert.equal(listed.data.activities.length, 4);
    const courseSearches = listed.data.activities.filter((activity) => activity.type === "course_search");
    assert.deepEqual(new Set(courseSearches.map((activity) => activity.subject)), new Set(["Python Course", "JavaScript"]));
    assert.ok(courseSearches.every((activity) => activity.userName === "Avery Morgan" && activity.userEmail === "avery@example.edu" && !activity.isRead));
    assert.ok(listed.data.activities.some((activity) => activity.type === "user_login" && activity.label === "signed in to"));
    assert.ok(listed.data.activities.some((activity) => activity.type === "account_created" && activity.label === "created an account on"));
    assert.equal(listed.data.totalCount, 4);
    assert.equal(listed.data.courseSearchCount, 2);
    assert.doesNotThrow(() => new Date(courseSearches[0].createdAt).toISOString());
    await request(baseUrl, "/api/activity", {
      method: "POST",
      cookie: student.cookie,
      body: { type: "course_view", subject: "Python from zero" },
    });
    const olderPage = await request(baseUrl, "/api/admin/activities?offset=1&limit=1", { cookie: admin.cookie });
    const currentActivityList = await request(baseUrl, "/api/admin/activities?limit=100", { cookie: admin.cookie });
    assert.equal(olderPage.data.totalCount, 5);
    assert.equal(olderPage.data.courseSearchCount, 2);
    assert.equal(olderPage.data.activities.length, 1);
    assert.equal(olderPage.data.activities[0].id, currentActivityList.data.activities[1].id);

    const read = await request(baseUrl, "/api/admin/activities/read", {
      method: "PATCH",
      cookie: admin.cookie,
      body: { ids: [courseSearches[0].id] },
    });
    assert.equal(read.data.unreadCount, 4);
    const readAll = await request(baseUrl, "/api/admin/activities/read", {
      method: "PATCH",
      cookie: admin.cookie,
      body: { all: true },
    });
    assert.equal(readAll.data.unreadCount, 0);
    const cleared = await request(baseUrl, "/api/admin/activities", { method: "DELETE", cookie: admin.cookie });
    assert.equal(cleared.data.unreadCount, 0);
    const empty = await request(baseUrl, "/api/admin/activities", { cookie: admin.cookie });
    assert.deepEqual(empty.data.activities, []);
    assert.equal(empty.data.courseSearchCount, 0);
  }, { instructorEmails: ["admin@example.edu"] });
});

test("returns personalized career guidance when no external AI key is configured", async () => {
  await withServer(async ({ baseUrl }) => {
    const account = await register(baseUrl);
    await request(baseUrl, "/api/profile", {
      method: "PUT",
      cookie: account.cookie,
      body: { assessment: { interest: "Creative", workStyle: "Making something" }, savedCareers: ["UX / UI Designer"], messages: [] },
    });
    const reply = await request(baseUrl, "/api/coach", {
      method: "POST",
      cookie: account.cookie,
      body: { prompt: "Which career should I explore?" },
    });
    assert.equal(reply.response.status, 200);
    assert.equal(reply.data.mode, "local");
    assert.match(reply.data.answer, /UX \/ UI Designer/);
    assert.match(reply.data.answer, /Avery/);
  });
});

test("provides project and interview modes and serves the account experience", async () => {
  await withServer(async ({ baseUrl }) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Create account/);
    assert.match(html, /Admin sign in/);
    assert.match(html, /Activity history/);
    const accountModule = await fetch(`${baseUrl}/auth.js`);
    assert.equal(accountModule.status, 200);

    const account = await register(baseUrl);
    for (const [mode, expected] of [["skills", /Week 1:/], ["interview", /First question:/]]) {
      const reply = await request(baseUrl, "/api/coach", {
        method: "POST",
        cookie: account.cookie,
        body: { prompt: "Help me take a first step.", mode },
      });
      assert.equal(reply.data.mode, "local");
      assert.match(reply.data.answer, expected);
    }

    await request(baseUrl, "/api/auth/logout", { method: "POST", cookie: account.cookie, body: {} });
    const signedOut = await request(baseUrl, "/api/auth/me", { cookie: account.cookie });
    assert.equal(signedOut.data.user, null);
  });
});

test("sends profile-aware prompts to a configured AI provider without exposing its key", async () => {
  let providerRequest;
  const provider = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    providerRequest = { authorization: request.headers.authorization, body: JSON.parse(body) };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "Try a small design portfolio project." } }] }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  try {
    await withServer(async ({ baseUrl }) => {
      const account = await register(baseUrl);
      await request(baseUrl, "/api/profile", {
        method: "PUT",
        cookie: account.cookie,
        body: { assessment: { interest: "Creative", workStyle: "Making something" }, savedCareers: [], messages: [] },
      });
      const result = await request(baseUrl, "/api/coach", {
        method: "POST",
        cookie: account.cookie,
        body: { mode: "skills", prompt: "Give me one idea." },
      });
      assert.equal(result.data.mode, "ai");
      assert.equal(result.data.answer, "Try a small design portfolio project.");
      assert.equal(providerRequest.authorization, "Bearer test-provider-key");
      assert.equal(providerRequest.body.model, "test-model");
      assert.match(providerRequest.body.messages[0].content, /Interest: Creative/);
      assert.doesNotMatch(JSON.stringify(result.data), /test-provider-key/);
    }, {
      aiApiKey: "test-provider-key",
      aiModel: "test-model",
      aiApiUrl: `http://127.0.0.1:${address.port}/chat/completions`,
    });
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});

test("routes OpenRouter keys to OpenRouter and explains provider configuration errors", async () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.AI_API_URL;
  delete process.env.AI_API_URL;
  let providerUrl;
  global.fetch = async (input, init) => {
    if (String(input) === "https://openrouter.ai/api/v1/chat/completions") {
      providerUrl = String(input);
      assert.equal(init.headers.Authorization, "Bearer sk-or-test-key");
      return new Response(JSON.stringify({ error: { message: "model not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  try {
    await withServer(async ({ baseUrl }) => {
      const account = await register(baseUrl);
      const result = await request(baseUrl, "/api/coach", {
        method: "POST",
        cookie: account.cookie,
        body: { prompt: "What should I try?" },
      });
      assert.equal(result.response.status, 502);
      assert.match(result.data.error, /Check AI_MODEL and AI_API_URL/);
      assert.equal(providerUrl, "https://openrouter.ai/api/v1/chat/completions");
    }, { aiApiKey: "sk-or-test-key" });
  } finally {
    global.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = originalApiUrl;
  }
});
