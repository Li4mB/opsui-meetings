import type {
  CalendarMeeting,
  DbAiMeetingGuideRow,
  DbAiPostCaptionGenerationRow,
  DbAiPostImageGenerationRow,
  DbAutoPostAgentConfigRow,
  DbCallingBatchRow,
  DbCallingCallRow,
  DbCallingProspectRow,
  DbCallingSheetSourceRow,
  DbCallingBatchStatus,
  DbCallingCallStatus,
  DbCallingProspectStatus,
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

export type UpsertCallingProspectsResult = {
  imported: number;
  updated: number;
  skipped: number;
  syncedAt: string;
};

export type CallingCallStatusPatch = {
  status: DbCallingCallStatus;
  outcome?: string | null;
  notes?: string;
  durationSeconds?: number | null;
  externalCallId?: string | null;
  statusMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CallingBatchStatusPatch = {
  status: DbCallingBatchStatus;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CallingProspectStatusPatch = {
  status: DbCallingProspectStatus;
  lastCallAt?: string | null;
  lastCallOutcome?: string | null;
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
  // Newest-first posts for the given accounts in the given statuses, capped
  // PER account (window function) so per-account history stays bounded.
  listPostsForAccounts(
    accountIds: string[],
    statuses: DbScheduledSocialPostStatus[],
    perAccountLimit: number,
  ): Promise<DbScheduledSocialPostWithCreatorRow[]>;
  insertMeetingRequest(row: DbMeetingRequestRow): Promise<void>;
  findMeetingRequestById(id: string): Promise<DbMeetingRequestRow | null>;
  deleteMeetingRequestById(id: string): Promise<void>;
  insertLoftBooking(row: DbLoftBookingRow): Promise<void>;
  listLoftBookings(): Promise<DbLoftBookingRow[]>;
  hasLoftAccess(userId: string): Promise<boolean>;
  grantLoftAccess(userId: string): Promise<void>;
  listCallingProspects(): Promise<DbCallingProspectRow[]>;
  findCallingProspectById(id: string): Promise<DbCallingProspectRow | null>;
  insertCallingProspect(row: DbCallingProspectRow): Promise<void>;
  upsertCallingProspects(
    rows: DbCallingProspectRow[],
  ): Promise<UpsertCallingProspectsResult>;
  updateCallingProspectStatus(
    prospectId: string,
    patch: CallingProspectStatusPatch,
  ): Promise<DbCallingProspectRow | null>;
  listCallingBatches(limit: number): Promise<DbCallingBatchRow[]>;
  findCallingBatchById(id: string): Promise<DbCallingBatchRow | null>;
  insertCallingBatch(
    batch: DbCallingBatchRow,
    calls: DbCallingCallRow[],
  ): Promise<void>;
  updateCallingBatchStatus(
    batchId: string,
    patch: CallingBatchStatusPatch,
  ): Promise<DbCallingBatchRow | null>;
  listCallingCalls(limit: number): Promise<DbCallingCallRow[]>;
  listCallingCallsByBatch(batchId: string): Promise<DbCallingCallRow[]>;
  findCallingCallById(id: string): Promise<DbCallingCallRow | null>;
  findNextQueuedCallingCall(batchId: string): Promise<DbCallingCallRow | null>;
  updateCallingCallStatus(
    callId: string,
    patch: CallingCallStatusPatch,
  ): Promise<DbCallingCallRow | null>;
  listCallingSheetSources(): Promise<DbCallingSheetSourceRow[]>;
  insertCallingSheetSource(row: DbCallingSheetSourceRow): Promise<void>;
  deleteCallingSheetSource(id: string): Promise<boolean>;
  getLastCallingSheetSyncAt(): Promise<string | null>;
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
  // Edit a draft/scheduled post's caption (only on editable statuses).
  updateScheduledSocialPostCaption(
    id: string,
    caption: string,
  ): Promise<DbScheduledSocialPostWithCreatorRow | null>;
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
  // Atomically win one timeslot: set slot_runs_json[slotId]=nowIso only if the
  // slot's stored last-fired still equals expectedLastFiredAt. Returns true if
  // this caller claimed the slot. Independent per slot + restart-safe.
  claimAutoPostAgentSlot(
    slotId: string,
    expectedLastFiredAt: string | null,
    nowIso: string,
  ): Promise<boolean>;
}
