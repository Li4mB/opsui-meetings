export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  colorHex: string;
};

export type DbUserRow = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "member";
  password_hash: string;
  color_hex: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export type DbMeetingRow = {
  id: string;
  google_event_id: string;
  title: string;
  client_name: string;
  company: string;
  country: "Australia" | "NZ" | "Unknown";
  meeting_type: string;
  start_at_utc: string;
  end_at_utc: string;
  source_timezone: string;
  google_meet_url: string | null;
  google_doc_url: string | null;
  client_email: string | null;
  phone: string | null;
  company_size: string | null;
  modules_of_interest_json: string;
  description_raw: string;
  calendar_html_url: string | null;
  assigned_user_id: string | null;
  updated_at: string;
  last_synced_at: string;
};

export type DbPastMeetingRow = DbMeetingRow & {
  resolved_at: string;
};

export type DbAiMeetingGuideRow = {
  google_event_id: string;
  guide_json: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type DbMeetingRequestRow = {
  id: string;
  client_name: string;
  email: string;
  phone: string;
  company_name: string;
  country: "Australia" | "New Zealand" | "Unknown";
  business_size: string;
  modules_json: string;
  meeting_mode: "google_meet" | "in_person";
  preferred_date: string;
  preferred_time: string;
  additional_info: string;
  created_by_user_id: string;
  created_at: string;
};

export type CalendarMeeting = {
  googleEventId: string;
  title: string;
  clientName: string;
  company: string;
  country: "Australia" | "NZ" | "Unknown";
  meetingType: string;
  startAtUtc: string;
  endAtUtc: string;
  sourceTimezone: string;
  googleMeetUrl: string | null;
  googleDocUrl: string | null;
  clientEmail: string | null;
  phone: string | null;
  companySize: string | null;
  modulesOfInterest: string[];
  descriptionRaw: string;
  calendarHtmlUrl: string | null;
  updatedAt: string;
};

export type MeetingBrief = {
  fileId: string;
  fileName: string;
  googleDocUrl: string;
  eventName: string | null;
  clientName: string | null;
  company: string | null;
  country: "Australia" | "NZ" | "Unknown" | null;
  meetingType: string | null;
  clientEmail: string | null;
  phone: string | null;
  companySize: string | null;
  modulesOfInterest: string[];
  additionalInformation: string | null;
  googleMeetUrl: string | null;
  updatedAt: string;
  sourceText: string;
};
