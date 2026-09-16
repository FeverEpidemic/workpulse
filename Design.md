# Career Operating System — Design Guidelines

**Document:** `Design.md`  
**Status:** Design source of truth  
**Product stage:** MVP  
**Primary platforms:** Responsive Web + Mobile Web  
**Future-compatible:** Native mobile, browser extension, public career profile  
**Default language:** English, localization-ready  
**Accessibility target:** WCAG 2.2 AA

---

## 1. Product Design North Star

> **The product succeeds when users can input career data quickly without feeling that there is too much navigation.**

The product is a **personal workspace for a user's career**, not an HR system, ATS, LinkedIn clone, Notion clone, corporate dashboard, or AI chatbot wrapper.

The experience should feel:

- **Calm**
- **Focused**
- **Personal**
- **Professional**
- Productive
- Career-coach-like without becoming intrusive

The product should visually combine:

- **50% modern startup**
- **50% personal productivity**

Speed wins over aesthetics at approximately **70/30**. A beautiful interface must never make capture slower.

---

## 2. Core Design Principles

### 2.1 Capture First
The shortest path in the product should be:

**Open app → one action → type work activity → save**

Users should be able to record work before they lose context.

Rules:

- Activity capture is the primary creation flow.
- Minimum required activity data is intentionally small.
- Default safe values should be inferred automatically.
- Extra detail is progressively disclosed.
- Mobile capture must be possible with one tap from the main interface.

---

### 2.2 AI Should Assist, Not Distract
AI is always available but must not dominate the interface.

AI may:

- Detect potential achievements.
- Suggest improved wording.
- Identify patterns in activity history.
- Provide coaching.
- Recommend relevant career data for a target role.
- Select relevant achievements for CV generation.

AI must not:

- Convert an activity into a final achievement without approval.
- Hide or overwrite the original activity.
- Make career decisions on behalf of the user.
- Present AI-generated content as user-authored without disclosure.

All AI output must remain editable.

---

### 2.3 Professional, Not Formal
The product must feel credible enough for career data while avoiding institutional HR-software aesthetics.

Prefer:

- Clear language
- Warm but restrained coaching
- Simple geometry
- Muted colors
- Comfortable spacing
- Direct feedback

Avoid:

- Bureaucratic wording
- Enterprise HRIS styling
- Dense administrative tables as default views
- Excessive corporate blue
- Decorative business illustrations
- Formal HR terminology when simpler language exists

---

### 2.4 Fast Over Fancy
When interaction speed and visual novelty conflict, choose speed.

Avoid animation, navigation, cards, dialogs, or visual effects that add friction without adding comprehension.

---

## 3. Product Personality

The closest conceptual reference is the **simplicity and neutrality of Notion**, but the application must not visually resemble a Notion clone.

The application should feel more opinionated about career workflows than a generic workspace.

### Desired impression

A user seeing the product should think:

> “This feels like Notion built specifically for my career.”

But the implementation should have its own identity through:

- Sage-green visual language
- Career-specific information hierarchy
- Guided capture flows
- Career timeline
- Achievement detection
- Job-readiness visualization
- Personal career profile

---

# 4. Information Architecture

## 4.1 Primary Navigation

The MVP primary navigation contains six destinations:

1. **Dashboard**
2. **Activity**
3. **Projects**
4. **Achievements**
5. **Skills**
6. **Career Profile**

Secondary/contextual destinations include:

- CV
- Evidence Library
- AI / Career Coach
- Settings
- Search

Do not promote every capability into primary navigation.

---

## 4.2 Desktop Navigation

Use a **collapsible left sidebar**.

Expanded state:

- Logo / product name
- Six primary destinations
- Search / command access
- Secondary utilities
- User profile / settings

Collapsed state:

- Icon rail
- Tooltips on hover/focus
- Active-state visibility must remain obvious

### Active item

Use a **sage background treatment** with sufficient contrast.

Navigation should feel minimal and visually quiet.

---

## 4.3 Mobile Navigation

Use a **drawer-based mobile navigation**, not a persistent desktop-style sidebar.

The persistent primary creation control is a floating **Add Activity** action.

Mobile must support:

**Open → tap Add Activity → keyboard active → type**

No additional screen is required before typing.

---

# 5. Dashboard

## 5.1 Purpose

The Dashboard provides a quick understanding of:

1. Overall career state
2. Recent activity
3. Current projects
4. Immediate capture
5. Job readiness

It is not intended to become an analytics-heavy cockpit.

---

## 5.2 Desktop Layout

Use a **two-column layout**:

### Main column
Primary working context.

Recommended content:

1. Quick Capture
2. Recent Activity
3. Current Projects

### Supporting column
Secondary career context.

Recommended content:

1. Job Readiness
2. AI Insight
3. Relevant setup/coaching item when required

The side column must not become a second navigation system.

---

## 5.3 Above the Fold

Prioritize:

- Quick Capture
- Recent Activities
- Current Projects
- Job Readiness

AI Insight may remain visible within the first viewport where screen size allows, but it must not displace the four priorities above.

---

# 6. Quick Capture

## 6.1 Component

Use a small **textarea-style capture surface**.

Suggested placeholder:

> What did you work on?

Do not begin with a multi-field form.

---

## 6.2 Minimum Activity Data

Required:

- Description
- Date

Automatically inferred:

- Date = current date/time

Optional:

- Project

Additional metadata must use progressive disclosure.

---

## 6.3 Save Behavior

Saving an activity should:

1. Save immediately.
2. Insert the activity into the timeline.
3. Show a subtle entrance transition.
4. Show a confirmation toast.
5. Trigger AI analysis asynchronously within the interface flow.

The user must not need to wait for AI analysis before the activity is considered saved.

---

# 7. Activity

## 7.1 Default View

Activity uses a **chronological timeline**, not a table.

Default grouping:

- **Weekly**

Recent activity should remain scannable without large card surfaces.

---

## 7.2 Activity Item Density

Use a **compact log-style item**.

Recommended visible information:

- Activity description
- Date/time
- Project, when available
- Minimal metadata
- AI suggestion, when meaningful

Avoid turning every activity into a large card.

---

## 7.3 Potential Achievement Detection

When AI detects achievement potential, show a subtle inline banner below the activity:

> **This could be an achievement → Review**

The banner must:

- Be visually associated with the activity
- Use subtle AI treatment
- Avoid blocking the timeline
- Never automatically create the achievement

Selecting **Review** opens a small modal.

---

# 8. Projects

## 8.1 Project List

Use a **list/database hybrid** rather than Kanban as the default.

Visible project-row information:

- Project name
- Status
- Role

Optional secondary information:

- Dates
- Progress
- Activity count

Do not overload the row.

---

## 8.2 Project Status

Supported baseline statuses:

- Active
- Completed
- Paused
- Archived

Status must always include a text label. Color alone must never communicate state.

---

## 8.3 Progress

Projects may show progress.

For MVP:

- Progress is optional.
- Manual percentage is acceptable.
- Do not require progress for every project.

Future iterations may derive progress from milestones if milestones become part of the product model.

---

## 8.4 Project Detail

Priority information:

1. Goal
2. User role
3. Timeline
4. Activities
5. Contributions

Secondary information may include:

- Achievements
- Evidence
- Skills
- AI summary
- Metrics

Use progressive disclosure.

### Mobile

Use vertically stacked content with **collapsible sections / accordion behavior** for secondary details.

---

# 9. Achievements

## 9.1 Default Presentation

Use **compact horizontal achievement cards**.

Primary hierarchy:

1. Achievement statement
2. Result / metric
3. Company or project context

Secondary information:

- Date
- Skills
- Evidence count

---

## 9.2 Achievement Structure

Each achievement should support:

- Statement
- Context
- Action
- Result
- Metrics
- Evidence
- Source activity
- Related project
- Company / experience

Example:

> **Built a personnel training database covering 4,900 employees**

Metadata:

`4,900 employees · Data Management · DAMRI · 2026`

---

## 9.3 Evidence

When evidence exists, expose a small indicator such as:

> `3 evidence items`

Do not visually overemphasize attachments over the achievement itself.

---

# 10. Career Profile

Career Profile is the user's **master professional record**.

It combines:

- Professional identity summary
- Work history
- Role history
- Career progression
- Skills
- Projects
- Achievements

The presentation should feel familiar to users of professional profile products, but must remain clearly private and workspace-oriented rather than social.

### Mobile

Use a profile-page composition.

---

# 11. Skills

The MVP uses a simple skill list.

Proficiency language:

- Beginner
- Intermediate
- Advanced

Avoid pseudo-precision such as `83% proficiency`.

Future versions may connect skills to activity evidence.

---

# 12. Target Role & Job Readiness

Users may set a target role such as:

> HR Business Partner

The system may use the target role to contextualize:

- Relevant skills
- Achievement quality
- Missing experience
- Job readiness
- CV content

---

## 12.1 Job Readiness

Primary visualization:

**Circular gauge**

Example:

> **72% Job Ready**

The score must always include explanation.

Do not show a percentage without context.

Tone combines:

1. Encouragement
2. Concrete coaching

Preferred pattern:

> You're making progress. Focus next on these three gaps.

Avoid:

> You're only 58% ready.

---

# 13. CV Experience

CV generation is target-job-oriented.

Primary flow:

1. User selects or provides a target job.
2. AI identifies the most relevant career data.
3. AI selects suitable achievements.
4. User reviews.
5. CV is generated.

CV is not a primary navigation destination in the MVP.

---

# 14. Evidence Library

Evidence has its own library.

Evidence may include:

- Documents
- Certificates
- Screenshots
- Links
- Other supporting files

Evidence may be linked to:

- Activity
- Project
- Achievement

Evidence is supporting context, not a core dashboard object.

---

# 15. Search & Command Palette

## 15.1 Search

Global search must be designed for long-term career histories.

Search should support:

- Activities
- Projects
- Achievements
- Skills
- Career entries
- Evidence metadata

MVP search should already anticipate users accumulating years of history.

---

## 15.2 Command Palette

Support:

`Ctrl/Cmd + K`

Potential commands:

- Add activity
- Find project
- Open achievement
- Open Career Profile
- Search
- Ask AI
- Navigate to a page

The command palette is an accelerator, not a required interaction path.

---

# 16. Visual Language

## 16.1 Core Visual Direction

The visual system is based on:

- Muted sage
- Soft surfaces
- Comfortable spacing
- Rounded modern SaaS geometry
- Minimal visual noise
- Strong information hierarchy

No gradients.

Illustration usage is minimal and reserved primarily for:

- Onboarding
- Empty states

---

# 17. Color System

## 17.1 Sage Primary

```css
--color-primary-50:  #F4F7F3;
--color-primary-100: #E8EFE5;
--color-primary-200: #D1E0CC;
--color-primary-300: #B3C9AC;
--color-primary-400: #8FAF87;
--color-primary-500: #6F9270;
--color-primary-600: #567657;
--color-primary-700: #435E45;
--color-primary-800: #374A39;
--color-primary-900: #2E3D31;
```

Default primary action:

```css
--color-action-primary: var(--color-primary-600);
```

Primary hover:

```css
--color-action-primary-hover: var(--color-primary-700);
```

---

## 17.2 Light Theme

```css
--color-bg-canvas:       #F7FAF6;
--color-bg-surface:      #FFFFFF;
--color-bg-subtle:       #F0F5EF;
--color-bg-elevated:     #FFFFFF;

--color-text-primary:    #1A211C;
--color-text-secondary:  #59635C;
--color-text-tertiary:   #7D887F;

--color-border-default:  #DDE5DC;
--color-border-strong:   #C9D5C8;
```

The canvas may carry a very light sage tint while content surfaces remain predominantly white.

---

## 17.3 Dark Theme

Dark mode is required for MVP.

```css
--color-dark-canvas:      #111613;
--color-dark-surface:     #171D19;
--color-dark-subtle:      #1E2621;
--color-dark-elevated:    #222B25;

--color-dark-text-primary:   #F1F5F2;
--color-dark-text-secondary: #B6C0B8;
--color-dark-text-tertiary:  #8F9B92;

--color-dark-border:      #2B352E;
--color-dark-border-strong:#3A463D;
```

Avoid pure black except when required for media or system contexts.

---

## 17.4 Semantic Colors

```css
--color-success: #3F7A55;
--color-info:    #4D6F91;
--color-warning: #A36D24;
--color-danger:  #B44A4A;
```

Semantic colors must always be paired with at least one of:

- Text
- Icon
- Shape
- Label

Never communicate status with color alone.

---

# 18. Typography

Primary typeface:

**Plus Jakarta Sans**

Fallback:

```css
font-family: "Plus Jakarta Sans", Inter, system-ui, -apple-system, sans-serif;
```

Optional data/code fallback:

```css
font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

Use monospace only when a true data/code context benefits from it.

---

## 18.1 Type Tokens

```css
--font-size-xs:  12px;
--font-size-sm:  14px;
--font-size-md:  16px;
--font-size-lg:  18px;
--font-size-xl:  20px;
--font-size-2xl: 24px;
--font-size-3xl: 28px;
--font-size-4xl: 32px;
--font-size-display: 40px;
```

Line-height guidance:

```css
--line-height-tight:   1.2;
--line-height-heading: 1.3;
--line-height-body:    1.55;
--line-height-loose:   1.7;
```

Weights:

```css
--font-weight-regular: 400;
--font-weight-medium:  500;
--font-weight-semibold:600;
--font-weight-bold:    700;
```

---

## 18.2 Usage

Main body:

- `16px`

Metadata:

- `14px`

Important dashboard numbers may use larger typography.

Examples:

- `72%`
- `12 Achievements`
- `4 Active Projects`

Oversized editorial typography is reserved for:

- Onboarding
- Career identity moments
- Hero/profile surfaces

Do not use oversized headings inside operational work screens.

---

# 19. Spacing

Use a consistent **4px base scale**.

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

Overall density should be comfortable.

Data-heavy lists may be slightly more compact than dashboards and profile pages.

---

# 20. Radius

```css
--radius-xs: 6px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 20px;
--radius-full: 9999px;
```

Default interactive surfaces should generally use:

`--radius-md`

Avoid excessive pill-shaped UI except for:

- Tags
- Status chips
- Compact filters

---

# 21. Elevation & Surfaces

Surface hierarchy:

1. Canvas
2. Surface
3. Elevated surface
4. Modal

Cards may use soft shadow.

```css
--shadow-sm: 0 1px 2px rgba(20, 30, 23, 0.06);
--shadow-md: 0 6px 18px rgba(20, 30, 23, 0.08);
--shadow-lg: 0 16px 40px rgba(20, 30, 23, 0.12);
```

Do not give every card a strong shadow.

---

# 22. Iconography

Use one consistent icon family.

Preferred visual character:

- Simple
- Geometric
- Filled where useful
- Recognizable at small sizes

Technology is intentionally not locked.

Icons that are not immediately understandable must provide a tooltip on desktop.

---

# 23. Core Component Inventory

The design system must cover at minimum:

- Button
- Icon Button
- Input
- Textarea
- Select
- Search Input
- Checkbox
- Radio
- Switch
- Card
- Badge / Status Chip
- Tooltip
- Dropdown Menu
- Modal
- Drawer
- Accordion
- Toast
- Skeleton
- Empty State
- Sidebar Item
- Timeline Item
- Quick Capture
- Project Row
- Achievement Card
- AI Suggestion Banner
- Job Readiness Gauge
- Evidence Item
- Command Palette

Reuse existing primitives before introducing new components.

---

# 24. Component State Rules

Interactive components must define relevant states.

Baseline states:

- Default
- Hover
- Active / Pressed
- Focus
- Disabled
- Loading
- Error

Not every component requires every state, but undefined interaction states are not acceptable.

---

## 24.1 Focus

Keyboard focus must be highly visible.

Recommended focus treatment:

```css
outline: 2px solid var(--color-primary-500);
outline-offset: 2px;
```

Focus behavior must support keyboard navigation throughout primary workflows.

---

# 25. Buttons

## Primary

Use solid sage.

Primary actions should be clearly visible but not visually aggressive.

Examples:

- Save Activity
- Continue
- Generate CV
- Confirm Achievement

---

## Secondary

Use neutral surfaces or subtle border treatment.

Do not place multiple equally strong primary buttons in one decision area.

---

## Destructive

Use restrained red.

Destructive actions should be explicit and must never visually resemble the primary brand action.

---

# 26. Forms

## 26.1 Philosophy

Use **progressive disclosure**.

Start with the minimum information required to complete the user's current goal.

Optional details should be accessed through patterns such as:

> Add details

---

## 26.2 Inference

Principle:

> **Never ask users for information the system can safely infer.**

Examples:

- Current date
- Current company
- Last-used project
- Existing profile information

All inferred data must remain visible and editable.

---

## 26.3 Autosave

Autosave is the default.

Where a user must explicitly commit a consequential action, use explicit confirmation.

---

# 27. Destructive Actions

Use confirmation dialogs for destructive operations.

Examples:

- Delete achievement
- Delete project
- Remove career experience
- Delete evidence

Copy should clearly state what will be lost.

Avoid playful destructive copy.

---

# 28. Feedback & Motion

Animation can be noticeable enough to make the interface feel modern, but remains functional.

Use motion for:

- Save confirmation
- Timeline insertion
- Drawer transitions
- Modal transitions
- AI processing
- State changes

Avoid decorative loops.

---

## 28.1 Save Feedback

Preferred pattern:

1. Item appears with subtle motion.
2. Confirmation toast appears.

Example:

> Activity saved

---

## 28.2 AI Processing

Use a small animated AI indicator.

Avoid blocking full-screen loading states for routine AI operations.

---

## 28.3 Page Transitions

Page transitions may be more expressive than a simple fade, but must remain fast and restrained.

Do not let transitions delay interaction.

---

## 28.4 Reduced Motion

Always respect:

```css
@media (prefers-reduced-motion: reduce)
```

Remove or substantially simplify non-essential transitions.

---

# 29. Loading

Primary loading pattern:

**Skeleton UI**

Use spinners only for actions where a skeleton would not represent the expected result.

Avoid generic full-page spinners wherever existing layout can be preserved.

---

# 30. Responsive Design

Responsive behavior should be defined by **content behavior**, not rigid device names.

Use sensible implementation breakpoints, but preserve these rules:

### Compact width
- Drawer navigation
- Single-column content
- Floating Add Activity
- Cards become full width
- Secondary detail collapses
- Touch-first actions

### Medium width
- Increased content width
- Optional split layouts where space permits
- Sidebar may remain collapsed

### Wide width
- Collapsible sidebar
- Dashboard two-column layout
- Supporting context visible simultaneously

Do not lock this design system to specific framework breakpoints.

---

# 31. Mobile UX

Mobile is equally important to desktop.

Primary mobile use cases:

1. Add activity
2. View recent activity
3. Manage projects

The fastest supported flow is:

**Open → Add Activity → Type**

The keyboard should automatically focus when capture is opened.

---

## 31.1 Touch Targets

All interactive touch targets should meet accepted mobile accessibility guidance.

Recommended minimum:

- Prefer **44×44px or larger**
- Increase further where visual density allows

---

# 32. AI UI Guidelines

## 32.1 Visual Treatment

AI features receive a **subtle differentiated treatment**.

Possible cues:

- Small sparkle/AI icon
- Very light tinted surface
- Small AI label where authorship matters

Do not use gradients.

AI should feel integrated into the product, not like a separate chatbot pasted onto it.

---

## 32.2 AI Authorship

AI may use first-person language when operating as the career assistant.

Example:

> I found a potential achievement in this activity.

This is preferable to overly robotic system copy when context is conversational.

---

## 32.3 Suggestions

AI suggestions must:

- Be editable
- Be dismissible
- Be attributable to AI
- Preserve the original source
- Require user review before becoming authoritative career data

---

## 32.4 Source Preservation

When AI creates an achievement draft from an activity:

- The activity remains unchanged.
- The achievement links back to the original activity.
- Evidence relationships remain traceable.

---

# 33. AI Insight Card

The Dashboard contains one persistent AI Insight area.

Example:

> You've made strong progress in stakeholder management this month.

AI Insight should emphasize useful interpretation rather than novelty.

Avoid creating a carousel of low-value observations.

One strong insight is preferable to several weak insights.

---

# 34. Notifications & Nudges

Use **gentle reminders**.

Streaks may exist, but must never become a central motivational mechanism.

Avoid guilt.

Do not write:

> You haven't logged anything for 12 days.

Prefer:

> Want to capture what you've been working on recently?

or:

> Add a quick update to keep your career history current.

---

# 35. Content & Microcopy

## 35.1 Voice

Default tone:

**Friendly professional**

Characteristics:

- Clear
- Warm
- Direct
- Encouraging
- Non-corporate
- Non-cutesy

---

## 35.2 Coaching

Coaching copy may be encouraging.

Preferred:

> You've made strong progress in stakeholder management.

Use factual support when available.

Avoid hollow praise.

---

## 35.3 Error Messages

Errors may be conversational, but must remain useful.

Preferred:

> We couldn't save this activity. Try again.

Avoid:

> Oopsie! Something went wrong 😢

---

## 35.4 Emoji

Emoji use is limited.

Appropriate:

- Onboarding
- Friendly empty states
- Occasional coaching context

Avoid emoji in:

- Error states
- Critical actions
- Destructive confirmation
- Dense data views

---

# 36. Privacy Treatment

Career data should feel **strongly personal and private**.

The interface should communicate this where relevant.

Examples:

- Privacy label on Evidence Library
- Clear visibility controls for future public profile features
- Explicit distinction between private workspace and exported/public outputs

Do not imply data is public by default.

---

# 37. Accessibility Requirements

Target:

**WCAG 2.2 AA**

Minimum requirements:

- Sufficient text contrast
- Keyboard-accessible primary flows
- Visible focus indicators
- Semantic HTML where applicable
- Labelled form controls
- Screen-reader labels for icon-only controls
- Tooltips for ambiguous icons
- No status communicated by color alone
- Reduced-motion support
- Accessible modals and drawers with focus management
- Meaningful error association
- Touch-friendly mobile controls

Accessibility is a design requirement, not post-launch polish.

---

# 38. Empty States

Default style:

**Text + CTA**

Example:

> **No achievements yet**
>
> Log your work and we'll help identify moments worth turning into achievements.
>
> `Add activity`

Illustrations may be used sparingly during onboarding or selected empty states.

---

# 39. Onboarding

Primary onboarding flow:

**Upload CV → extract profile information → review → enter workspace**

Required onboarding information:

1. Name
2. Current role
3. Company
4. Years of experience
5. Existing CV

Target role may be configured later.

---

## 39.1 First Dashboard

Do not show a completely empty dashboard.

Use a **guided dashboard**.

Include a setup checklist such as:

- Complete profile
- Add first activity
- Create first project
- Set target role

The checklist should disappear naturally as setup completes.

---

# 40. Information Density

When a page becomes too dense, default to:

**Collapsible sections**

Before creating another page, ask whether secondary content can safely collapse within the current context.

Navigation must not expand simply because more product capabilities exist.

---

# 41. Do / Don't

## Do

- Keep activity capture one action away.
- Keep primary navigation small.
- Use progressive disclosure.
- Preserve context when users open detail.
- Use one obvious primary action per decision area.
- Reuse design-system components.
- Make AI suggestions editable.
- Keep the original source behind AI-generated career data.
- Use semantic labels alongside color.
- Show useful data before decorative visuals.
- Keep the interface calm even when data volume grows.

## Don't

- Build an HRIS-looking interface.
- Turn every entity into a large card.
- Add navigation items for every feature.
- Require users to complete long forms before saving.
- Use AI as the primary visual identity of the product.
- Auto-publish AI-generated achievements.
- Hide AI authorship where it matters.
- Use gradients.
- Use multiple competing accent colors.
- Use streaks to pressure users.
- Use color as the only state indicator.
- Create new components when an existing pattern can solve the problem.
- Sacrifice capture speed for visual novelty.

---

# 42. Component Reuse Rule

For new features:

> **Reuse an existing component first.**

Only introduce a new component when the existing system genuinely cannot represent the interaction without creating usability problems.

New components should inherit:

- Existing tokens
- Existing interaction states
- Existing accessibility patterns
- Existing responsive behavior philosophy

---

# 43. Technology-Agnostic Implementation

The design guideline intentionally does not lock the product to a particular UI framework.

Implementations may use any component stack provided it supports:

- Accessible primitives
- Theme tokens
- Dark mode
- Responsive behavior
- Keyboard interaction
- Focus management
- Reusable components
- Predictable state handling

The design system must remain portable to:

- Responsive web
- Native mobile
- Browser extension
- Public career profile

---

# 44. MVP Experience Checklist

Before considering a core screen complete, verify:

- [ ] Can the user identify the primary action immediately?
- [ ] Can Activity be captured with minimal input?
- [ ] Is navigation limited to necessary destinations?
- [ ] Are secondary details progressively disclosed?
- [ ] Does the design remain calm at realistic data volume?
- [ ] Does the screen work in dark mode?
- [ ] Is the primary workflow keyboard accessible?
- [ ] Does mobile retain the core action?
- [ ] Are AI-generated elements identifiable?
- [ ] Can AI suggestions be edited or dismissed?
- [ ] Are original sources preserved?
- [ ] Are loading and error states defined?
- [ ] Are destructive actions explicit?
- [ ] Are component states implemented?
- [ ] Does the interface meet WCAG AA expectations?

---

# 45. Final Experience Statement

The Career Operating System should feel less like software users are required to maintain and more like a quiet professional workspace that continuously helps them remember what they have done, understand its career value, and reuse that evidence when it matters.

The interface should stay out of the way of the work.

**Capture quickly. Organize quietly. Surface value when it matters.**
