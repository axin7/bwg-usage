import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return <main className="mx-auto w-full max-w-md px-4 py-12">
    <h1 className="mb-8 text-2xl font-semibold">VPS 控制面板</h1>
    <LoginForm />
  </main>;
}
