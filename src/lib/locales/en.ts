// English is the source of truth for the key set.
//
// Every other dictionary is typed against this object, so a missing
// translation is a compile error rather than a panel that speaks two
// languages at once. Keys are flat and read like paths: the thing you
// actually do with one is grep for it in a component.
//
// Write the English here as it should appear on screen — this file is not
// notes for translators, it is what an English user reads.
export const en = {
  // ── shared ──────────────────────────────────────────────────────────
  "common.loading": "Loading…",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.appDefault": "App default",

  // ── settings ────────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.languageHint": "Applies to the app itself. Bots reply in whatever language you write to them.",

  "settings.workingFolder": "Working folder",
  "settings.workingFolderHint": "Where this bot runs its shell and file tools.",
  "settings.privateWorkspace": "Private bot workspace",
  "settings.privateWorkspaceOrPath": "Private bot workspace — or an absolute path",

  "settings.purpose": "What this agent is for",
  "settings.purposePlaceholder": "Describe what your agent does",

  "settings.model": "Model",
  "settings.effort": "Effort",
  "settings.autoMode": "Auto mode",
  "settings.memory": "Memory",
  "settings.botMemory": "Bot memory",
  "settings.computer": "Computer",

  "settings.chiefOfStaff": "Chief of Staff",
  "settings.onePerWorkspace": "One per workspace",
  "settings.askBeforeContacting": "Ask me before contacting other bots",

  "settings.connectedApps": "Connected apps",
  "settings.allowConnectedApps": "Allow this bot to use connected apps",

  // ── voice ───────────────────────────────────────────────────────────
  "voice.botVoice": "Bot voice",
  "voice.currentVoice": "Current bot voice",
  "voice.loadingVoices": "Loading voices…",
  "voice.readAloud": "Read replies aloud",
  "voice.readThisBotAloud": "Read this bot's replies aloud",

  // ── usage ───────────────────────────────────────────────────────────
  "usage.title": "Usage",
  "usage.cost": "Cost",
  "usage.tokens": "Tokens",
  "usage.turns": "Turns",
  // ── mascotte ────────────────────────────────────────────────────────
  "mascot.expression": "Expression",
  "mascot.color": "Color",
  "mascot.reset": "Reset",

  // ── botprofiel ──────────────────────────────────────────────────────
  "bot.name": "Name",
  "bot.title": "Title",
  "bot.description": "Description",

  // ── geheugen ────────────────────────────────────────────────────────
  "memory.hint": "Notes this bot keeps between tasks — plain files you can edit.",
  "memory.overBudget": "Over the budget — only the top of this file loads each turn.",
  "memory.topicFiles": "Topic files",
  "memory.clear": "Clear",
  "memory.back": "Back",

  // ── model ───────────────────────────────────────────────────────────
  "model.hint": "Which provider and model this bot runs on",

  // ── meldingen ───────────────────────────────────────────────────────
  "notify.title": "Notifications",
  "notify.hint": "Get notified when this agent finishes or needs input",
  "effort.hint": "How hard this bot thinks",
  "effort.noLevel": " (Default: no level is sent)",
} as const;
