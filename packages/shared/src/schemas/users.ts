import { z } from "zod";

export const roleSchema = z.enum(["admin", "member"]);

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: roleSchema,
  colorHex: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createUserInputSchema = z.object({
  username: z.string().min(3).max(64),
  displayName: z.string().min(2).max(80),
  password: z.string().min(8).max(128),
  role: roleSchema,
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const updateUserInputSchema = createUserInputSchema.partial().extend({
  active: z.boolean().optional(),
});

export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
