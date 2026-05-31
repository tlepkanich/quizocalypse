// Per-step instructional video URLs for the onboarding wizard. All null until
// real walkthrough videos exist — QzEmbed renders a placeholder for nulls, so
// the "video per step" structure ships now and URLs drop in later (embed URLs:
// e.g. "https://www.youtube.com/embed/<id>" or a Vimeo/mp4 URL).

export type OnboardingStepKey = "start" | "about" | "design" | "build";

export const ONBOARDING_VIDEOS: Record<OnboardingStepKey, string | null> = {
  start: null,
  about: null,
  design: null,
  build: null,
};

export const ONBOARDING_VIDEO_TITLES: Record<OnboardingStepKey, string> = {
  start: "Getting started",
  about: "Telling AI about your quiz",
  design: "Designing from your brand",
  build: "Building your quiz",
};
