import { z } from "zod";
import { protectedProcedure } from "./base";

export const me = protectedProcedure
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
  }))
  .handler(({ context }) => ({
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    emailVerified: context.user.emailVerified,
    image: context.user.image ?? null,
  }));
