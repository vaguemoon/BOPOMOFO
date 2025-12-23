import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ✅ GitHub Pages 必設 base：/REPO_NAME/
export default defineConfig({
  plugins: [react()],
  base: "/bopomofo-mastery/",
});
