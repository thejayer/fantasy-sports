import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Strictly Jayers",
    short_name: "Jayers",
    description: "Fantasy leagues and member hub for Strictly Jayers.",
    start_url: "/",
    display: "standalone",
    background_color: "#e7efe4",
    theme_color: "#1f4d3a",
    lang: "en",
  };
}
