const { z } = require('zod');

// Session contract mirrors client-generated identity payload.
const sessionSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['agent', 'customer'])
});

const createRoomSchema = z.object({
  name: z.string().trim().min(2).max(100),
  createdBy: z.string().uuid().optional()
});

const searchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  roomId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().optional()
});

function validateOrRespond(schema, value, res) {
  // Use one helper to keep every endpoint's validation error shape predictable.
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    res.status(400).json({
      message: 'Validation failed',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });

    return null;
  }

  return parsed.data;
}

module.exports = {
  sessionSchema,
  createRoomSchema,
  searchSchema,
  listMessagesSchema,
  validateOrRespond
};
