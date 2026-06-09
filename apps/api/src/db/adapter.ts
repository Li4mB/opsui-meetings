import type {
  CalendarMeeting,
  DbAiMeetingGuideRow,
  DbAiPostCaptionGenerationRow,
  DbAiPostImageGenerationRow,
  DbAutoPostAgentConfigRow,
  DbLoftBookingRow,
  DbMeetingRequestRow,
  DbMeetingRow,
  DbPastMeetingRow,
  DbScheduledSocialPostRow,
  DbScheduledSocialPostStatus,
  DbSocialAccountRow,
  DbSocialPlatform,
  DbUserRow,
} from "../types.js";

export type DbMeetingFilters = {
  country?: DbMeetingRow["country"];
  assignedUserId?: string;
  from?: string;
  to?: string;
};

export type DbMeetingWithAssignmentRow = DbMeetingRow & {
  assigned_user_name: string | null;
  assigned_user_color: string | null;
};

export type DbPastMeetingWithAssignmentRow = DbPastMeetingRow & {
  assigned_user_name: string | null;
  assigned_user_color: string | null;
};

export type DbScheduledSocialPostWithCreatorRow = DbScheduledSocialPostRow & {
  created_by_user_name: string | null;
};

export type DbSocialAccountWithCreatorRow = DbSocialAccountRow & {
  created_by_user_name: string | null;
};

export type ReplaceMeetingsResult = {
  imported: number;
  updated: number;
  removed: number;
  syncedAt: string;
};

export interface StorageAdapter {
  initialize(): Promise<void>;
  close(): Promise<void>;
  seedAdminIfMissing(): Promise<void>;
  findActiveUserByUsername(username: string): Promise<DbUserRow | null>;
  findUserById(id: string): Promise<DbUserRow | null>;
  findUserIdByUsername(username: string): Promise<{ id: string } | null>;
  listUsers(): Promise<DbUserRow[]>;
  insertUser(user: DbUserRow): Promise<void>;
  updateUser(user: DbUserRow): Promise<void>;
  clearMeetingAssignmentsForUser(userId: string): Promise<void>;
  deleteUserById(userId: string): Promise<boolean>;
  listMeetings(filters: DbMeetingFilters): Promise<DbMeetingWithAssignmentRow[]>;
  listPastMeetings(filters: DbMeetingFilters): Promise<DbPastMeetingWithAssignmentRow[]>;
  getLastSuccessfulSyncAt(): Promise<string | null>;
  updateMeetingAssignment(
    meetingId: string,
    assignedUserId: string | null,
  ): Promise<DbMeetingWithAssignmentRow | null>;
  resolveMeeting(meetingId: string, resolvedAt: string): Promise<boolean>;
  replaceMeetings(meetings: CalendarMeeting[]): Promise<ReplaceMeetingsResult>;
  findMeetingByIdIncludingPast(
    meetingId: string,
  ): Promise<DbMeetingWithAssignmentRow | DbPastMeetingWithAssignmentRow | null>;
  getAiMeetingGuideByGoogleEventId(
    googleEventId: string,
  ): Promise<DbAiMeetingGuideRow | null>;
  upsertAiMeetingGuide(row: DbAiMeetingGuideRow): Promise<void>;
  deleteAiMeetingGuideByGoogleEventId(googleEventId: string): Promise<void>;
  insertAiPostImageGeneration(row: DbAiPostImageGenerationRow): Promise<void>;
  listRecentAiPostImageGenerations(
    conversationId: string,
    userId: string,
    limit: number,
  ): Promise<DbAiPostImageGenerationRow[]>;
  insertAiPostCaptionGeneration(
    row: DbAiPostCaptionGenerationRow,
  ): Promise<void>;
  listRecentAiPostCaptionGenerations(
    userId: string,
    limit: number,
  ): Promise<DbAiPostCaptionGenerationRow[]>;
  listPublishedSocialPosts(
    limit: number,
  ): Promise<DbScheduledSocialPostWithCreatorRow[]>;
  insertMeetingRequest(row: DbMeetingRequestRow): Promise<void>;
  findMeetingRequestById(id: string): Promise<DbMeetingRequestRow | null>;
  deleteMeetingRequestById(id: string): Promise<void>;
  insertLoftBooking(row: DbLoftBookingRow): Promise<void>;
  listLoftBookings(): Promise<DbLoftBookingRow[]>;
  hasLoftAccess(userId: string): Promise<boolean>;
  grantLoftAccess(userId: string): Promise<void>;
  insertScheduledSocialPosts(rows: DbScheduledSocialPostRow[]): Promise<void>;
  listScheduledSocialPosts(): Promise<DbScheduledSocialPostWithCreatorRow[]>;
  findScheduledSocialPostById(
    id: string,
  ): Promise<DbScheduledSocialPostWithCreatorRow | null>;
  listDueScheduledSocialPosts(
    nowIso: string,
    limit: number,
  ): Promise<DbScheduledSocialPostWithCreatorRow[]>;
  rescheduleScheduledSocialPost(
    id: string,
    scheduledFor: string,
    timezone: string,
  ): Promise<DbScheduledSocialPostWithCreatorRow | null>;
  deleteScheduledSocialPost(id: string): Promise<boolean>;
  approvePendingSocialPost(
    id: string,
    scheduledFor: string,
    timezone: string,
  ): Promise<DbScheduledSocialPostWithCreatorRow | null>;
  updateScheduledSocialPostStatus(
    id: string,
    status: DbScheduledSocialPostStatus,
    patch?: {
      statusMessage?: string | null;
      externalPostId?: string | null;
      publishedAt?: string | null;
    },
  ): Promise<DbScheduledSocialPostWithCreatorRow | null>;
  upsertSocialAccount(row: DbSocialAccountRow): Promise<void>;
  listSocialAccounts(): Promise<DbSocialAccountWithCreatorRow[]>;
  findSocialAccountByPlatform(
    platform: DbSocialPlatform,
  ): Promise<DbSocialAccountWithCreatorRow | null>;
  findSocialAccountById(
    id: string,
  ): Promise<DbSocialAccountWithCreatorRow | null>;
  updateSocialAccountTokens(
    id: string,
    patch: {
      accessToken: string;
      expiresAt: string | null;
      metadataJson: string;
    },
  ): Promise<void>;
  deleteSocialAccount(id: string): Promise<boolean>;
  getAutoPostAgentConfig(): Promise<DbAutoPostAgentConfigRow | null>;
  upsertAutoPostAgentConfig(row: DbAutoPostAgentConfigRow): Promise<void>;
  // Atomically win a cadence slot: set last_run_at=nowIso only if it still
  // equals expectedLastRunAt. Returns true if this caller claimed the run.
  claimAutoPostAgentRun(
    expectedLastRunAt: string | null,
    nowIso: string,
  ): Promise<boolean>;
}
