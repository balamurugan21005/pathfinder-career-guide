# Pathfinder

Pathfinder is a student career-exploration workspace with account sign-in, persistent profiles, saved career paths, and a conversational career guide.

The overview also includes a searchable Skill Studio with free video courses from beginner through advanced levels. Course completion is saved in the current browser; an internet connection is needed to load the videos. Instructors can be configured with `INSTRUCTOR_EMAILS` (a comma-separated list); they can add local demo courses with video and thumbnail files. Local uploads stay in that browser and are not shared with other accounts or devices.

## Requirements

- Node.js 22.13 or newer.
- MongoDB 6.0 or newer (optional; SQLite remains the default for local development).

## Run locally

From this folder, install dependencies and start the server with:

```powershell
npm install
node server.js
```

Open http://127.0.0.1:3000. Create an account to use the workspace. By default the app uses SQLite at `data/pathfinder.sqlite`; the `data` folder is ignored by Git. Set `PORT` to change the port or `PATHFINDER_DB_PATH` to use a different SQLite file.

### Use MongoDB

The backend can use MongoDB locally or MongoDB Atlas. Set `MONGODB_URI` in the server environment; the application connects on startup and creates its collections and indexes as needed. Keep this connection string private and never put it in frontend files.

For a local MongoDB server:

```powershell
$env:MONGODB_URI = "mongodb://127.0.0.1:27017/pathfinder"
node server.js
```

For MongoDB Atlas, use the connection string from your Atlas cluster and optionally set the database name explicitly:

```powershell
$env:MONGODB_URI = "mongodb+srv://<username>:<password>@<cluster-host>/pathfinder?retryWrites=true&w=majority"
$env:PATHFINDER_MONGODB_DATABASE = "pathfinder"
node server.js
```

The MongoDB database stores accounts and password hashes in `users`, hashed login sessions in `sessions`, and login throttling data in `login_attempts`. The `/api/health` response identifies the active database adapter. When `MONGODB_URI` is not set, the existing SQLite backend continues to work.

Switching from SQLite to MongoDB starts using a separate data store; this project does not automatically migrate existing accounts. Back up data and plan a migration before switching an existing deployment.

### Admin sign-in and activity dashboard

Set `INSTRUCTOR_EMAILS` to a comma-separated allowlist of administrator account emails in `.env`. Create each account using the student account registration, then use **Admin sign in** with that account's email and password. The server enforces the allowlist for admin login and the admin activity API; changing the frontend alone cannot grant admin access.

Student account creation, successful student sign-ins, career/course searches, career/course/video visits, and guidance-section visits generate stored activity events. Allowlisted admins can open **Activity history** to see user identity, search/topic, date and time, unread count, mark-as-read controls, and clear history. The notification badge and list refresh automatically every five seconds. Events are stored in the active database's `activities` collection/table.

Run the API and persistence tests with:

```powershell
node --test
```

## Enable hosted AI

Without provider credentials the guide uses personalized built-in recommendations, project plans, and interview practice. To enable a hosted language model, create a `.env` file in this folder:

```env
AI_API_KEY=your-replacement-provider-key
AI_MODEL=your-provider-model-id
```

Start the app normally with `node server.js`; it loads `.env` automatically. OpenRouter keys (starting with `sk-or-`) use OpenRouter's Chat Completions endpoint automatically. For another OpenAI-compatible provider, set `AI_API_URL` to its Chat Completions endpoint in `.env`. Use the exact model ID shown by your provider. The `.env` file is ignored by Git; keep credentials there and never add them to `script.js`, `auth.js`, or HTML. The key is not required to use the local guide.

## Deploy on Render

This repository includes a Render Blueprint in `render.yaml`. To deploy:

1. Push the repository to GitHub.
2. In Render, create a new **Blueprint** and connect the GitHub repository.
3. Create a MongoDB Atlas database and copy its connection string. Configure Atlas network access so the Render service can reach the cluster.
4. When Render prompts for `MONGODB_URI`, enter the Atlas connection string. Keep it private. Set `INSTRUCTOR_EMAILS` to a comma-separated list of administrator account emails, or leave it empty if the admin dashboard is not needed.
5. Deploy, then verify the service's `/api/health` endpoint reports `"ok": true` and `"database": "mongodb"`.

The Blueprint configures production session cookies, binds the server to the host interface, and checks service health. Keep the MongoDB connection string in Render's environment settings; never commit it to GitHub. Configure database backups before relying on this deployment. This starter does not include email verification, password reset, account recovery, or managed multi-region database hosting.

Instructor email allowlisting controls the local demo tools; it is not a full role-management or media-upload service. Before production, enforce instructor authorization on every upload endpoint and store video assets in managed object storage.
