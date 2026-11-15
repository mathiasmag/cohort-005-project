import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

// A Note body as it arrives from the form: trimmed, plain text, capped.
export const noteBodySchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, `A Note can be at most ${MAX_NOTE_LENGTH} characters.`);
