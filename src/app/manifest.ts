import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WorkPulse",
    short_name: "WorkPulse",
    description: "Private career workspace for capturing activity and building one master CV.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F7FAF6",
    theme_color: "#567657",
    icons: [
      { src: "/brand/workpulse-app-icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
