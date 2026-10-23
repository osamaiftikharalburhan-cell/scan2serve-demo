import { LoginForm } from '@/components/auth/login-form';

export const metadata = { title: 'Login' };

export default async function LoginPage({ searchParams }) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === 'string' ? next : ''} />;
}
