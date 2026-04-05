import type {
  CalendarMeeting,
  DbAiMeetingGuideRow,
  DbMeetingRequestRow,
  DbMeetingRow,
  DbPastMeetingRow,
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
  insertMeetingRequest(row: DbMeetingRequestRow): Promise<void>;
  findMeetingRequestById(id: string): Promise<DbMeetingRequestRow | null>;
  deleteMeetingRequestById(id: string): Promise<void>;
}
