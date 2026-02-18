const { z } = require('zod');
const { STATUS_VALUES } = require('./constants');

// Shared primitive prevents subtle mismatch between register/login email validation.
const emailSchema = z.string().trim().email().max(200);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: z.string().min(8).max(100)
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1)
});

const optionalDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  // Frontend often sends empty strings for optional fields; transform keeps handlers clean.
  .or(z.literal('').transform(() => undefined));

const optionalUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .or(z.literal('').transform(() => undefined));

// Base schema covers shared create/update fields; update uses partial() below.
const applicationBaseSchema = z.object({
  company: z.string().trim().min(2).max(150),
  role: z.string().trim().min(2).max(150),
  location: z.string().trim().max(150).optional().or(z.literal('').transform(() => undefined)),
  job_url: optionalUrlSchema,
  salary_min: z.coerce.number().int().nonnegative().optional().or(z.literal('').transform(() => undefined)),
  salary_max: z.coerce.number().int().nonnegative().optional().or(z.literal('').transform(() => undefined)),
  applied_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  next_step_date: optionalDateSchema,
  status: z.enum(STATUS_VALUES),
  notes: z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined))
});

const createApplicationSchema = applicationBaseSchema.refine(
  (value) => value.salary_min === undefined || value.salary_max === undefined || value.salary_max >= value.salary_min,
  {
    message: 'salary_max must be greater than or equal to salary_min',
    path: ['salary_max']
  }
);

// Partial update still keeps cross-field invariant checks (salary_min <= salary_max).
const updateApplicationSchema = applicationBaseSchema.partial().refine(
  (value) => value.salary_min === undefined || value.salary_max === undefined || value.salary_max >= value.salary_min,
  {
    message: 'salary_max must be greater than or equal to salary_min',
    path: ['salary_max']
  }
);

const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  sort_by: z.enum(['created_at', 'updated_at', 'applied_date', 'company', 'role', 'status']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().optional(),
  // Hard cap prevents oversized pages from creating accidental heavy queries.
  page_size: z.coerce.number().int().positive().max(100).optional()
});

module.exports = {
  registerSchema,
  loginSchema,
  createApplicationSchema,
  updateApplicationSchema,
  querySchema
};
