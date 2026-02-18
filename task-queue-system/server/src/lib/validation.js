const { z } = require('zod');

// Payload limits are tuned to be realistic for demos while preventing accidental overload.
const campaignSchema = z.object({
  campaignName: z.string().trim().min(3).max(120),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(5).max(5000),
  recipients: z.array(z.string().trim().email()).min(1).max(5000),
  failRate: z.number().min(0).max(1).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  backoffMs: z.number().int().min(250).max(60000).optional()
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive()
});

function validateOrRespond(schema, value, res) {
  // Centralized formatter keeps validation error shape stable across all endpoints.
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  return parsed.data;
}

module.exports = {
  campaignSchema,
  listQuerySchema,
  idParamSchema,
  validateOrRespond
};
