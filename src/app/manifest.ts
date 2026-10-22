import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Camera Insights",
    short_name: "Cameras",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#0f766e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
