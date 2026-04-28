/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep pdfkit out of the webpack bundle so it can resolve its
  // own font data files (data/Helvetica.afm, etc.) at runtime.
  serverExternalPackages: ["pdfkit"],
  // Ensure pdfkit's bundled .afm font metric files are shipped
  // with the serverless function output (Vercel /var/task).
  outputFileTracingIncludes: {
    "/api/report": ["./node_modules/pdfkit/js/data/**/*"],
    "/api/report/**": ["./node_modules/pdfkit/js/data/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
