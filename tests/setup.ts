process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://proxy:proxy@localhost:5432/proxy_test";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.APP_BASE_URL = "http://localhost:3000";
delete process.env.SERPAPI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.RESEND_API_KEY;
