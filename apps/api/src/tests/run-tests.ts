/**
 * OpsUI Meetings — Integration Test Runner (Node built-in test runner + tsx)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { env } from "../config/env.js";
import { createSqliteAdapter } from "../db/sqlite-adapter.js";
import type { StorageAdapter } from "../db/adapter.js";
import type {
  CalendarMeeting,
  DbAiPostImageGenerationRow,
  DbScheduledSocialPostRow,
  DbSocialAccountRow,
  DbUserRow,
} from "../types.js";

// Save original dbPath so we can restore it
const originalDbPath = env.dbPath;

const mkTemp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "opsui-test-")), "t.sqlite");
const cleanup = (db: string) => {
  fs.rmSync(path.dirname(db), { recursive: true, force: true });
  env.dbPath = originalDbPath;
};

const mkMeeting = (overrides: Partial<CalendarMeeting> & { googleEventId: string }): CalendarMeeting => ({
  title: "Test", clientName: "Client", company: "Co", country: "Australia",
  meetingType: "discovery", startAtUtc: "2026-02-01T10:00:00Z", endAtUtc: "2026-02-01T11:00:00Z",
  sourceTimezone: "Australia/Sydney", googleMeetUrl: null, googleDocUrl: null,
  clientEmail: null, phone: null, companySize: null, modulesOfInterest: [],
  descriptionRaw: "", calendarHtmlUrl: null, updatedAt: "2026-01-30T10:00:00Z",
  ...overrides,
});

const signToken = (u: { id: string; username: string; displayName: string; role: string; colorHex: string }, secret: string) =>
  new SignJWT({ username: u.username, displayName: u.displayName, role: u.role, colorHex: u.colorHex })
    .setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));

// ========== 1. Init & Admin Seed ==========
describe("1. Init & Admin Seed", () => {
  let db: string, adapter: StorageAdapter;
  before(() => { db = mkTemp(); env.dbPath = db; adapter = createSqliteAdapter(); });
  after(async () => { await adapter.close(); cleanup(db); });

  it("initializes", async () => { await adapter.initialize(); assert.ok(true); });
  it("seeds admin", async () => {
    await adapter.seedAdminIfMissing();
    const a = await adapter.findActiveUserByUsername("opsui-admin");
    assert.ok(a); assert.equal(a!.role, "admin"); assert.equal(a!.active, 1);
  });
  it("no duplicate admin", async () => {
    await adapter.seedAdminIfMissing(); await adapter.seedAdminIfMissing();
    assert.equal((await adapter.listUsers()).filter(u => u.username === "opsui-admin").length, 1);
  });
  it("admin password verifies", async () => {
    const a = (await adapter.findActiveUserByUsername("opsui-admin"))!;
    assert.ok(await argon2.verify(a.password_hash, "ChangeMe123!"));
  });
});

// ========== 2. User CRUD ==========
describe("2. User CRUD", () => {
  let db: string, adapter: StorageAdapter, userId: string;
  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("insert member", async () => {
    userId = nanoid();
    const now = new Date().toISOString();
    await adapter.insertUser({ id: userId, username: "jsmith", display_name: "John Smith", role: "member",
      password_hash: await argon2.hash("Pass123!"), color_hex: "#FF5733", active: 1, created_at: now, updated_at: now });
    const f = await adapter.findActiveUserByUsername("jsmith");
    assert.ok(f); assert.equal(f!.role, "member");
  });
  it("find by id", async () => {
    const f = await adapter.findUserById(userId); assert.ok(f); assert.equal(f!.username, "jsmith");
  });
  it("list users", async () => {
    const users = await adapter.listUsers();
    assert.ok(users.length >= 2);
    assert.ok(users.some(u => u.username === "opsui-admin"));
    assert.ok(users.some(u => u.username === "jsmith"));
  });
  it("update user", async () => {
    const u = (await adapter.listUsers()).find(x => x.username === "jsmith")!;
    await adapter.updateUser({ ...u, display_name: "Jonathan", updated_at: new Date().toISOString() });
    assert.equal((await adapter.findUserById(u.id))!.display_name, "Jonathan");
  });
  it("deactivate", async () => {
    const u = (await adapter.listUsers()).find(x => x.username === "jsmith")!;
    await adapter.updateUser({ ...u, active: 0, updated_at: new Date().toISOString() });
    assert.equal(await adapter.findActiveUserByUsername("jsmith"), null);
    assert.equal((await adapter.findUserById(u.id))!.active, 0);
  });
});

// ========== 3. Meetings ==========
describe("3. Meetings", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow;
  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("replace meetings", async () => {
    const r = await adapter.replaceMeetings([
      mkMeeting({ googleEventId: "e1", title: "M1", country: "Australia" }),
      mkMeeting({ googleEventId: "e2", title: "M2", country: "NZ" }),
    ]);
    assert.equal(r.imported, 2);
    assert.equal((await adapter.listMeetings({})).length, 2);
  });
  it("assign meeting", async () => {
    const m = (await adapter.listMeetings({}))[0];
    const u = await adapter.updateMeetingAssignment(m.id, admin.id);
    assert.ok(u); assert.equal(u!.assigned_user_id, admin.id);
  });
  it("preserve assignments on replace", async () => {
    await adapter.replaceMeetings([mkMeeting({ googleEventId: "e1", title: "M1u" })]);
    const m = (await adapter.listMeetings({}))[0];
    assert.equal(m.assigned_user_id, admin.id);
    assert.equal(m.title, "M1u");
  });
  it("resolve to past", async () => {
    const m = (await adapter.listMeetings({}))[0];
    assert.ok(await adapter.resolveMeeting(m.id, new Date().toISOString()));
    assert.equal((await adapter.listMeetings({})).length, 0);
    assert.equal((await adapter.listPastMeetings({})).length, 1);
  });
  it("filter by country", async () => {
    await adapter.replaceMeetings([
      mkMeeting({ googleEventId: "au1", country: "Australia" }),
      mkMeeting({ googleEventId: "nz1", country: "NZ" }),
    ]);
    assert.equal((await adapter.listMeetings({ country: "Australia" })).length, 1);
    assert.equal((await adapter.listMeetings({ country: "NZ" })).length, 1);
  });
  it("sync timestamp", async () => {
    const ts = await adapter.getLastSuccessfulSyncAt();
    assert.ok(ts);
  });
});

// ========== 4. AI Guides ==========
describe("4. AI Guides", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow;
  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("upsert & get", async () => {
    const now = new Date().toISOString();
    await adapter.upsertAiMeetingGuide({ google_event_id: "g1", guide_json: '{"s":"test"}', created_by_user_id: admin.id, created_at: now, updated_at: now });
    const g = await adapter.getAiMeetingGuideByGoogleEventId("g1");
    assert.ok(g); assert.equal(g!.guide_json, '{"s":"test"}');
  });
  it("update on upsert", async () => {
    const now = new Date().toISOString();
    await adapter.upsertAiMeetingGuide({ google_event_id: "g1", guide_json: '{"s":"v2"}', created_by_user_id: admin.id, created_at: now, updated_at: now });
    assert.equal((await adapter.getAiMeetingGuideByGoogleEventId("g1"))!.guide_json, '{"s":"v2"}');
  });
  it("delete", async () => {
    await adapter.deleteAiMeetingGuideByGoogleEventId("g1");
    assert.equal(await adapter.getAiMeetingGuideByGoogleEventId("g1"), null);
  });
  it("stores recent post image generation memory by conversation", async () => {
    const now = new Date().toISOString();
    const row: DbAiPostImageGenerationRow = {
      id: nanoid(),
      conversation_id: "post-image-test",
      prompt: "Create a warehouse stock accuracy campaign image.",
      caption: "Stock accuracy starts with visible operations.",
      tags_json: JSON.stringify(["inventory", "warehouse"]),
      image_name: "opsui-post-test.jpg",
      image_model: "test-image-model",
      created_by_user_id: admin.id,
      created_at: now,
    };

    await adapter.insertAiPostImageGeneration(row);

    const generations = await adapter.listRecentAiPostImageGenerations(
      "post-image-test",
      admin.id,
      5,
    );

    assert.equal(generations.length, 1);
    assert.equal(generations[0].prompt, row.prompt);
    assert.equal(
      (
        await adapter.listRecentAiPostImageGenerations(
          "another-conversation",
          admin.id,
          5,
        )
      ).length,
      0,
    );
  });
});

// ========== 5. Meeting Requests ==========
describe("5. Meeting Requests", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow;
  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("insert & find", async () => {
    const id = nanoid(), now = new Date().toISOString();
    await adapter.insertMeetingRequest({ id, client_name: "Jane", email: "j@e.com", phone: "", company_name: "Co",
      country: "Australia", business_size: "10-50", modules_json: "[]", meeting_mode: "google_meet",
      preferred_date: "2026-03-01", preferred_time: "10:00", additional_info: "", created_by_user_id: admin.id, created_at: now });
    const f = await adapter.findMeetingRequestById(id);
    assert.ok(f); assert.equal(f!.client_name, "Jane");
  });
  it("delete", async () => {
    const id = nanoid(), now = new Date().toISOString();
    await adapter.insertMeetingRequest({ id, client_name: "T", email: "t@e.com", phone: "", company_name: "T",
      country: "Australia", business_size: "1", modules_json: "[]", meeting_mode: "in_person",
      preferred_date: "2026-03-01", preferred_time: "14:00", additional_info: "", created_by_user_id: admin.id, created_at: now });
    await adapter.deleteMeetingRequestById(id);
    assert.equal(await adapter.findMeetingRequestById(id), null);
  });
});

// ========== 6. Fresh Install — No admin login needed ==========
describe("6. Fresh Install — Member independent of admin login", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow, member: DbUserRow;
  const PASS = "Member123!", SECRET = "test-jwt";

  before(async () => {
    db = mkTemp(); env.dbPath = db; process.env.JWT_SECRET = SECRET;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
    const now = new Date().toISOString();
    member = { id: nanoid(), username: "jsmith", display_name: "John", role: "member",
      password_hash: await argon2.hash(PASS), color_hex: "#FF5733", active: 1, created_at: now, updated_at: now };
    await adapter.insertUser(member);
  });
  after(async () => { await adapter.close(); cleanup(db); delete process.env.JWT_SECRET; });

  it("admin exists after init", async () => {
    const a = await adapter.findActiveUserByUsername("opsui-admin");
    assert.ok(a); assert.equal(a!.role, "admin");
  });
  it("member exists", async () => {
    const m = await adapter.findActiveUserByUsername("jsmith");
    assert.ok(m); assert.equal(m!.role, "member");
  });
  it("member authenticates without admin login", async () => {
    const m = (await adapter.findActiveUserByUsername("jsmith"))!;
    assert.ok(await argon2.verify(m.password_hash, PASS));
  });
  it("member gets valid JWT", async () => {
    const m = (await adapter.findActiveUserByUsername("jsmith"))!;
    const token = await signToken({ id: m.id, username: m.username, displayName: m.display_name, role: m.role, colorHex: m.color_hex }, SECRET);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    assert.equal(payload.sub, m.id); assert.equal(payload.username, "jsmith"); assert.equal(payload.role, "member");
  });
  it("member JWT resolves to active user (auth/me flow)", async () => {
    const m = (await adapter.findActiveUserByUsername("jsmith"))!;
    const token = await signToken({ id: m.id, username: m.username, displayName: m.display_name, role: m.role, colorHex: m.color_hex }, SECRET);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    const user = await adapter.findUserById(payload.sub as string);
    assert.ok(user); assert.equal(user!.active, 1); assert.equal(user!.username, "jsmith");
  });
  it("bootstrap returns all active users (unauthenticated)", async () => {
    const active = (await adapter.listUsers()).filter(u => Boolean(u.active));
    assert.equal(active.length, 2);
    assert.ok(active.some(u => u.username === "opsui-admin"));
    assert.ok(active.some(u => u.username === "jsmith"));
  });
  it("admin deactivation doesn't affect member", async () => {
    await adapter.updateUser({ ...admin, active: 0, updated_at: new Date().toISOString() });
    assert.equal(await adapter.findActiveUserByUsername("opsui-admin"), null);
    const m = await adapter.findActiveUserByUsername("jsmith");
    assert.ok(m); assert.equal(m!.active, 1);
    assert.ok(await argon2.verify(m!.password_hash, PASS));
    // Restore admin for cleanup
    await adapter.updateUser({ ...admin, active: 1, updated_at: new Date().toISOString() });
  });
});

// ========== 7. Server Restart — DB persists ==========
describe("7. Server Restart — Data persists across restarts", () => {
  let db: string, memberId: string;
  const PASS = "Restart123!", SECRET = "test-restart";

  before(() => { db = mkTemp(); env.dbPath = db; process.env.JWT_SECRET = SECRET; });
  after(() => { cleanup(db); delete process.env.JWT_SECRET; });

  it("first start: seeds admin + creates member", async () => {
    const a = createSqliteAdapter(); await a.initialize(); await a.seedAdminIfMissing();
    memberId = nanoid(); const now = new Date().toISOString();
    await a.insertUser({ id: memberId, username: "jsmith", display_name: "John", role: "member",
      password_hash: await argon2.hash(PASS), color_hex: "#FF5733", active: 1, created_at: now, updated_at: now });
    await a.close();
  });
  it("second start: admin re-seeded, member persists", async () => {
    const a = createSqliteAdapter(); await a.initialize(); await a.seedAdminIfMissing();
    assert.ok(await a.findActiveUserByUsername("opsui-admin"));
    const m = await a.findActiveUserByUsername("jsmith");
    assert.ok(m); assert.equal(m!.id, memberId);
    assert.ok(await argon2.verify(m!.password_hash, PASS));
    assert.equal((await a.listUsers()).filter(u => u.username === "opsui-admin").length, 1);
    await a.close();
  });
  it("member logs in on restarted server", async () => {
    const a = createSqliteAdapter(); await a.initialize();
    const m = (await a.findActiveUserByUsername("jsmith"))!;
    assert.ok(await argon2.verify(m.password_hash, PASS));
    const token = await signToken({ id: m.id, username: m.username, displayName: m.display_name, role: m.role, colorHex: m.color_hex }, SECRET);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    const user = await a.findUserById(payload.sub as string);
    assert.ok(user); assert.equal(user!.active, 1);
    await a.close();
  });
});

// ========== 8. Scheduled Social Posts ==========
describe("8. Scheduled Social Posts", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow;

  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("stores and lists shared scheduled posts", async () => {
    const now = new Date().toISOString();
    const row: DbScheduledSocialPostRow = {
      id: nanoid(),
      platform: "linkedin",
      account_id: null,
      caption: "Scheduled OpsUI post",
      image_data_url: "data:image/png;base64,abc",
      image_name: "post.png",
      thumbnail_data_url: "data:image/png;base64,thumb",
      scheduled_for: "2026-06-01T00:00:00.000Z",
      timezone: "Australia/Sydney",
      status: "scheduled",
      status_message: "Waiting",
      external_post_id: null,
      published_at: null,
      created_by_user_id: admin.id,
      created_at: now,
      updated_at: now,
    };

    await adapter.insertScheduledSocialPosts([row]);
    const posts = await adapter.listScheduledSocialPosts();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].caption, "Scheduled OpsUI post");
    assert.equal(posts[0].created_by_user_name, "OpsUI Admin");
    assert.ok(await adapter.findScheduledSocialPostById(row.id));
  });

  it("finds due posts and updates publish status", async () => {
    const due = await adapter.listDueScheduledSocialPosts("2026-06-01T00:01:00.000Z", 10);
    assert.equal(due.length, 1);

    const updated = await adapter.updateScheduledSocialPostStatus(due[0].id, "published", {
      statusMessage: "Published",
      externalPostId: "external-1",
      publishedAt: "2026-06-01T00:01:00.000Z",
    });

    assert.ok(updated);
    assert.equal(updated!.status, "published");
    assert.equal(updated!.external_post_id, "external-1");
    assert.equal((await adapter.listDueScheduledSocialPosts("2026-06-01T00:02:00.000Z", 10)).length, 0);
  });

  it("stores multiple accounts per platform, edits by id, refreshes, disconnects", async () => {
    const now = new Date().toISOString();
    const accountAu: DbSocialAccountRow = {
      id: "twitter-au",
      platform: "twitter",
      display_name: "X — AU",
      account_id: "@OpsuiAU",
      access_token: "token-au",
      token_type: "Bearer",
      expires_at: null,
      scopes: "tweet.write",
      metadata_json: "{}",
      active: 1,
      created_by_user_id: admin.id,
      created_at: now,
      updated_at: now,
    };
    const twitterAccounts = async () =>
      (await adapter.listSocialAccounts()).filter(
        (account) => account.platform === "twitter",
      );

    await adapter.upsertSocialAccount(accountAu);
    await adapter.upsertSocialAccount({
      ...accountAu,
      id: "twitter-nz",
      display_name: "X — NZ",
      account_id: "@OpsuiNZ",
      access_token: "token-nz",
    });

    // Two X accounts coexist on the same platform.
    assert.equal((await twitterAccounts()).length, 2);

    // Editing by id updates in place (no third row).
    await adapter.upsertSocialAccount({
      ...accountAu,
      display_name: "X — AU (updated)",
      access_token: "token-au-2",
      updated_at: new Date().toISOString(),
    });
    const editedAu = await adapter.findSocialAccountById("twitter-au");
    assert.ok(editedAu);
    assert.equal(editedAu!.display_name, "X — AU (updated)");
    assert.equal(editedAu!.access_token, "token-au-2");
    assert.equal((await twitterAccounts()).length, 2);

    // Token refresh persistence.
    await adapter.updateSocialAccountTokens("twitter-au", {
      accessToken: "token-au-refreshed",
      expiresAt: "2030-01-01T00:00:00.000Z",
      metadataJson: JSON.stringify({ refreshToken: "refresh-au" }),
    });
    const refreshed = await adapter.findSocialAccountById("twitter-au");
    assert.equal(refreshed!.access_token, "token-au-refreshed");
    assert.equal(refreshed!.expires_at, "2030-01-01T00:00:00.000Z");
    assert.match(refreshed!.metadata_json, /refresh-au/);

    // Disconnecting one leaves the other connected.
    assert.ok(await adapter.deleteSocialAccount("twitter-au"));
    const remaining = await twitterAccounts();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "twitter-nz");
  });
});

// ========== 9. Per-slot agent claim + per-account history ==========
describe("9. Auto-post slots + per-account history", () => {
  let db: string, adapter: StorageAdapter, admin: DbUserRow;

  before(async () => {
    db = mkTemp(); env.dbPath = db;
    adapter = createSqliteAdapter(); await adapter.initialize(); await adapter.seedAdminIfMissing();
    admin = (await adapter.findActiveUserByUsername("opsui-admin"))!;
    const now = new Date().toISOString();
    await adapter.upsertAutoPostAgentConfig({
      id: "default",
      enabled: 1,
      cadence_json: JSON.stringify({ mode: "slots", slots: [] }),
      posts_per_run: 1,
      target_account_ids_json: "[]",
      image_style: "realistic",
      timezone: "Pacific/Auckland",
      last_run_at: null,
      slot_runs_json: "{}",
      updated_by_user_id: admin.id,
      updated_at: now,
    });
  });
  after(async () => { await adapter.close(); cleanup(db); });

  it("claims each timeslot independently and is restart-safe (compare-and-swap)", async () => {
    // First claim of slot-1 wins.
    assert.equal(await adapter.claimAutoPostAgentSlot("slot-1", null, "T1"), true);
    // Re-claim with the stale expected (null) loses — already advanced to T1.
    assert.equal(await adapter.claimAutoPostAgentSlot("slot-1", null, "T2"), false);
    // Claim with the correct expected (T1) wins.
    assert.equal(await adapter.claimAutoPostAgentSlot("slot-1", "T1", "T3"), true);
    // A different slot is independent — its first claim still wins.
    assert.equal(await adapter.claimAutoPostAgentSlot("slot-2", null, "T1"), true);

    const row = await adapter.getAutoPostAgentConfig();
    const runs = JSON.parse(row!.slot_runs_json) as Record<string, string>;
    assert.equal(runs["slot-1"], "T3");
    assert.equal(runs["slot-2"], "T1");
  });

  it("lists posts per account, capped, newest-first, excluding null/other statuses", async () => {
    const base = (over: Partial<DbScheduledSocialPostRow>): DbScheduledSocialPostRow => ({
      id: nanoid(),
      platform: "twitter",
      account_id: "acc-a",
      caption: "c",
      image_data_url: null,
      image_name: null,
      thumbnail_data_url: null,
      scheduled_for: "2026-01-01T00:00:00.000Z",
      timezone: "Pacific/Auckland",
      status: "published",
      status_message: null,
      external_post_id: null,
      published_at: "2026-01-01T00:00:00.000Z",
      created_by_user_id: admin.id,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...over,
    });

    await adapter.insertScheduledSocialPosts([
      base({ account_id: "acc-a", caption: "a-old", published_at: "2026-01-01T00:00:00.000Z" }),
      base({ account_id: "acc-a", caption: "a-mid", published_at: "2026-02-01T00:00:00.000Z" }),
      base({ account_id: "acc-a", caption: "a-new", published_at: "2026-03-01T00:00:00.000Z" }),
      base({ account_id: "acc-b", caption: "b-1", published_at: "2026-02-15T00:00:00.000Z" }),
      base({ account_id: null, caption: "no-account" }),
      base({ account_id: "acc-a", caption: "a-scheduled", status: "scheduled" }),
    ]);

    const rows = await adapter.listPostsForAccounts(["acc-a", "acc-b"], ["published"], 2);
    const captions = rows.map((r) => r.caption);
    // acc-a capped at 2 newest published; acc-b 1; null account + scheduled excluded.
    assert.equal(rows.length, 3);
    assert.ok(captions.includes("a-new"));
    assert.ok(captions.includes("a-mid"));
    assert.ok(!captions.includes("a-old"));
    assert.ok(!captions.includes("no-account"));
    assert.ok(!captions.includes("a-scheduled"));
    assert.ok(captions.includes("b-1"));
  });

  it("edits caption only on editable statuses", async () => {
    const draft = nanoid();
    const published = nanoid();
    const ts = "2026-01-01T00:00:00.000Z";
    await adapter.insertScheduledSocialPosts([
      {
        id: draft, platform: "twitter", account_id: "acc-a", caption: "before",
        image_data_url: null, image_name: null, thumbnail_data_url: null,
        scheduled_for: ts, timezone: "Pacific/Auckland", status: "pending_review",
        status_message: null, external_post_id: null, published_at: null,
        created_by_user_id: admin.id, created_at: ts, updated_at: ts,
      },
      {
        id: published, platform: "twitter", account_id: "acc-a", caption: "locked",
        image_data_url: null, image_name: null, thumbnail_data_url: null,
        scheduled_for: ts, timezone: "Pacific/Auckland", status: "published",
        status_message: null, external_post_id: null, published_at: ts,
        created_by_user_id: admin.id, created_at: ts, updated_at: ts,
      },
    ]);

    const editedDraft = await adapter.updateScheduledSocialPostCaption(draft, "after");
    assert.equal(editedDraft!.caption, "after");

    // Published is immutable: the guard rejects the edit and returns null so the
    // route surfaces a 404 instead of a misleading success; caption is untouched.
    const editedPublished = await adapter.updateScheduledSocialPostCaption(published, "hacked");
    assert.equal(editedPublished, null);
    assert.equal((await adapter.findScheduledSocialPostById(published))!.caption, "locked");
  });
});
