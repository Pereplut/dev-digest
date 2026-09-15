import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build output folder. scripts/e2e.sh sets NEXT_DIST_DIR=.next-e2e so its
  // second `next dev` (pointed at the throwaway API) never overwrites the dev
  // server's .next — NEXT_PUBLIC_* values are compiled into these files.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
};

export default withNextIntl(nextConfig);
