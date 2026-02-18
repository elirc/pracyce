import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required')
});

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
      email: '',
      password: ''
    }
  });

  if (isReady && token) {
    return <Navigate to="/" replace />;
  }

  const from = location.state?.from?.pathname || '/';

  async function onSubmit(values) {
    try {
      // Successful login writes Zustand + localStorage session through one store action.
      const response = await api.post('/auth/login', values);
      setSession(response.data);
      navigate(from, { replace: true });
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to sign in';
      setError('root', { message });
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <h1>Welcome back</h1>
        <p>Sign in to manage your job pipeline.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
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

          {errors.root && <p className="error-text">{errors.root.message}</p>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="auth-footer">
          New here? <Link to="/register">Create account</Link>
        </p>
      </section>
    </div>
  );
}

export default LoginPage;
