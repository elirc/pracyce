const { z } = require('zod');

const createOrderSchema = z.object({
  channel: z.enum(['dine_in', 'delivery_app', 'phone']),
  ticketName: z.string().trim().max(80).optional(),
  targetMinutes: z.number().int().min(5).max(120).optional(),
  items: z.array(z.object({ menuItemId: z.string().min(1), notes: z.string().trim().max(250).optional() })).min(1).max(30)
});

const updateItemStatusSchema = z.object({
  status: z.enum(['started', 'cooking', 'ready'])
});

const bumpPrioritySchema = z.object({
  priority: z.enum(['high', 'rush'])
});

const eightySixSchema = z.object({
  reason: z.string().trim().min(2).max(120).optional()
});

const listOrdersSchema = z.object({
  station: z.enum(['grill', 'fryer', 'salad']).optional(),
  status: z.enum(['queued', 'in_progress', 'ready']).optional(),
  includeLateOnly: z.coerce.boolean().optional()
});

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
  reason: z.string().trim().min(2).max(120).optional()
});

function validateOrRespond(schema, value, res) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({
      message: 'Validation failed',
      errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    });
    return null;
  }
  return parsed.data;
}

module.exports = {
  createOrderSchema,
  updateItemStatusSchema,
  bumpPrioritySchema,
  eightySixSchema,
  listOrdersSchema,
  availabilitySchema,
  validateOrRespond
};
