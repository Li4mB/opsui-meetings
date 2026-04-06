import { z } from "zod";

export const loginInputSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
});

export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  colorHex: z.string(),
});

export const sessionSchema = z.object({
  user: authUserSchema,
  token: z.string(),
});

export const authMeSchema = z.object({
  user: authUserSchema,
});

export const authBootstrapUserSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  colorHex: z.string(),
});

export const authBootstrapSchema = z.object({
  users: z.array(authBootstrapUserSchema),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type AuthBootstrapUser = z.infer<typeof authBootstrapUserSchema>;
