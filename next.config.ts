import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `pg` is a CommonJS package that must not be bundled: the bundler rewrites
   * its exports and `new Pool(...)` fails at runtime with "is not a
   * constructor" — only in a production build, and only when DATABASE_URL is
   * set, which is exactly the deployed configuration.
   */
  serverExternalPackages: ["pg"],
};

export default nextConfig;
