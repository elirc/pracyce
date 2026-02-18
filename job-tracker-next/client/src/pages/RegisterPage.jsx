import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(100),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string()
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords must match'
  });

function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const { token, isReady } = useAuthStore((state) => ({ token: state.token, isReady: state.isReady }));

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: ''
    }
  });

  if (isReady && token) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(values) {
    try {
      // Register endpoint returns a full session, so user can enter app immediately.
      const response = await api.post('/auth/register', {
        name: values.name,
        email: values.email,
        password: values.password
      });
      setSession(response.data);
      navigate('/', { replace: true });
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to create account';
      setError('root', { message });
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <h1>Create account</h1>
        <p>Track every application in one place.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
          <label>
            Full name
            <input type="text" {...register('name')} placeholder="Jane Smith" />
            {errors.name && <small>{errors.name.message}</small>}
          </label>

          <label>
            Email
            <input type="email" {...register('email')} placeholder="you@example.com" />
            {errors.email && <small>{errors.email.message}</small>}
          </label>

          <label>
            Password
            <input type="password" {...register('password')} placeholder="At least 8 chars" />
            {errors.password && <small>{errors.password.message}</small>}
          </label>

          <label>
            Confirm password
            <input type="password" {...register('confirmPassword')} placeholder="Repeat password" />
            {errors.confirmPassword && <small>{errors.confirmPassword.message}</small>}
          </label>

          {errors.root && <p className="error-text">{errors.root.message}</p>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}

export default RegisterPage;
