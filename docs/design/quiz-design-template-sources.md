# Live quiz design templates — 8 September 2026

The first two additions extend the existing main-builder Theme → Templates
gallery for decider quizzes. They are original token adaptations of observed
live quiz surfaces. They do not import brand logos, product photos, proprietary
fonts, question copy, recommendation logic, or third-party CSS.

## Discovery

Source: [Trade's live discovery-trial quiz](https://www.drinktrade.com/pages/find-my-discovery-trial).
The older find-my-match URL now redirects through a discovery landing page;
the observation was made on the questionnaire itself.

Observed in the browser: white canvas, centered serif question heading, narrow
stacked image-answer options, pale blue progress, charcoal text, generous space,
and a lime promotional strip. Computed heading: GT Alpina, 40px, weight 500,
rgb(37,37,37). Answer: white, 1px rgb(215,215,218) border, 16px radius,
Inter/Helvetica/Arial, padding 24px 24px 24px 16px.

Adaptation: available Lora/Figtree fonts, white and charcoal tokens, a darker
blue accent for contrast, rounded answers, spacious spacing and no shadow.
The lime becomes a secondary palette role. Layout, image options, progress
and promotions remain independent existing quiz settings; a theme selection
does not invent content or alter a merchant's flow.

## Clear Care

Source: [CeraVe's moisturizer quiz](https://www.cerave.com/facialmoisturizerquiz),
including its embedded Jebbit introduction (`ceraveusa.jebbit.com/6gpt94kk`).

Observed: white page, navy sans-serif heading, strong blue quiz introduction,
product imagery and a short four-question promise. Only the introduction was
inspected; the start control presents terms, so no questionnaire answers or
results are claimed as observed.

Adaptation: available Figtree, navy text, blue primary/accent, white background,
crisp square corners, generous spacing and no shadow. This is a visual starting
point for care/routine finders, not a copy of CeraVe's branding or medical claims.

## Acceptance and scope

- Both choices appear in the decider builder's existing template gallery.
- Selecting one changes design tokens only and shows the selected state.
- Existing global preset IDs, defaults, legacy gallery and legacy documents
  remain unchanged. Legacy mutation calls reject both new IDs.
- All schema and contrast checks pass before release.
- These are design presets, not a URL-import feature or new quiz-flow templates.
  The separate industry work-bank item remains WIS-002.

Persistence review: mutation validates tokens, keeps all content/edge references,
does not mutate its input, and declines unknown/legacy-only-invalid IDs. Existing
commit/autosave/undo mechanics persist the resulting document.

Legacy review: additions are outside THEME_PRESETS and gated on logic_model.
The shared swatch gallery's default input is unchanged; no runtime components,
schema defaults, published quizzes or default seeding paths change.

Visual verification: selected both templates through the real BuilderThemePanel
controls in a temporary local harness rendering QuizRuntime in preview mode.
Reviewed desktop and 375px mobile screenshots for both; serif/sans typography,
rounded/square answers, palette and selected card state rendered correctly.
The harness used the application's body reset and was removed after review.
