import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { STATUS_OPTIONS } from '../utils/status';

const optionalNumber = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}, z.number().int().nonnegative().optional());

// UI schema intentionally mirrors backend rules to fail fast before network calls.
const schema = z
  .object({
    company: z.string().trim().min(2, 'Company is required').max(150),
    role: z.string().trim().min(2, 'Role is required').max(150),
    location: z.string().trim().max(150).optional(),
    job_url: z
      .string()
      .trim()
      .url('Enter a valid URL')
      .max(500)
      .optional()
      .or(z.literal('')),
    salary_min: optionalNumber,
    salary_max: optionalNumber,
    applied_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date'),
    next_step_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date')
      .optional()
      .or(z.literal('')),
    status: z.enum(['applied', 'interview', 'offer', 'rejected']),
    notes: z.string().trim().max(5000).optional()
  })
  .refine((value) => value.salary_min === undefined || value.salary_max === undefined || value.salary_max >= value.salary_min, {
    message: 'Maximum salary must be greater than or equal to minimum salary',
    path: ['salary_max']
  });

const emptyValues = {
  company: '',
  role: '',
  location: '',
  job_url: '',
  salary_min: '',
  salary_max: '',
  applied_date: new Date().toISOString().slice(0, 10),
  next_step_date: '',
  status: 'applied',
  notes: ''
};

function normalizeValues(data) {
  // Convert DB null/undefined shapes into form-friendly strings.
  return {
    company: data.company,
    role: data.role,
    location: data.location || '',
    job_url: data.job_url || '',
    salary_min: data.salary_min ?? '',
    salary_max: data.salary_max ?? '',
    applied_date: data.applied_date || emptyValues.applied_date,
    next_step_date: data.next_step_date || '',
    status: data.status || 'applied',
    notes: data.notes || ''
  };
}

function toPayload(values) {
  // Convert form-friendly strings back into API contract (undefined for optional empties).
  return {
    company: values.company,
    role: values.role,
    location: values.location || undefined,
    job_url: values.job_url || undefined,
    salary_min: values.salary_min === undefined ? undefined : Number(values.salary_min),
    salary_max: values.salary_max === undefined ? undefined : Number(values.salary_max),
    applied_date: values.applied_date,
    next_step_date: values.next_step_date || undefined,
    status: values.status,
    notes: values.notes || undefined
  };
}

function ApplicationFormModal({ open, initialData, onClose, onSubmit, isSubmitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: emptyValues
  });

  useEffect(() => {
    if (!open) return;
    // Reinitialize form whenever modal opens so edits don't leak between records.
    reset(initialData ? normalizeValues(initialData) : emptyValues);
  }, [open, initialData, reset]);

  if (!open) {
    return null;
  }

  const title = initialData ? 'Edit Application' : 'New Application';

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <form
          className="form-grid"
          onSubmit={handleSubmit((values) => {
            // Keep submit handler thin by centralizing payload conversion above.
            onSubmit(toPayload(values));
          })}
        >
          <label>
            Company
            <input {...register('company')} placeholder="Acme Inc" />
            {errors.company && <small>{errors.company.message}</small>}
          </label>

          <label>
            Role
            <input {...register('role')} placeholder="Frontend Developer" />
            {errors.role && <small>{errors.role.message}</small>}
          </label>

          <label>
            Location
            <input {...register('location')} placeholder="Remote" />
            {errors.location && <small>{errors.location.message}</small>}
          </label>

          <label>
            Job URL
            <input {...register('job_url')} placeholder="https://company.com/jobs/123" />
            {errors.job_url && <small>{errors.job_url.message}</small>}
          </label>

          <label>
            Min Salary
            <input type="number" {...register('salary_min')} placeholder="100000" />
            {errors.salary_min && <small>{errors.salary_min.message}</small>}
          </label>

          <label>
            Max Salary
            <input type="number" {...register('salary_max')} placeholder="135000" />
            {errors.salary_max && <small>{errors.salary_max.message}</small>}
          </label>

          <label>
            Applied Date
            <input type="date" {...register('applied_date')} />
            {errors.applied_date && <small>{errors.applied_date.message}</small>}
          </label>

          <label>
            Next Step Date
            <input type="date" {...register('next_step_date')} />
            {errors.next_step_date && <small>{errors.next_step_date.message}</small>}
          </label>

          <label>
            Status
            <select {...register('status')}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.status && <small>{errors.status.message}</small>}
          </label>

          <label className="full-row">
            Notes
            <textarea rows="4" {...register('notes')} placeholder="Add interview prep or follow-up notes" />
            {errors.notes && <small>{errors.notes.message}</small>}
          </label>

          <div className="form-actions full-row">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Application'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default ApplicationFormModal;
