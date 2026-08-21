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

  // ── fase 2: zijbalk, gesprek, app-instellingen ──────────────────────
  "nav.newOrShare": "New or share",
  "nav.newBot": "New Bot",
  "nav.teams": "Teams",
  "nav.search": "Search",
  "nav.searchHint": "Search bots and messages",
  "nav.automations": "Automations",
  "nav.appSettings": "App settings",
  "nav.undo": "Undo",
  "room.new": "New Room",
  "room.delete": "Delete Room",
  "room.namePlaceholder": "Room name (optional)",
  "room.needsBot": "Create a bot first — rooms are made of bots.",
  "room.copyId": "Copy conversation ID",
  "archive.title": "Archived bots",
  "archive.hint": "Conversations are kept until you choose to delete a bot.",
  "archive.restoreAll": "Restore all",
  "archive.restore": "Restore",
  "archive.close": "Close archived bots",
  "chat.copyMessage": "Copy message",
  "chat.send": "Send",
  "chat.editMessage": "Edit message",
  "chat.webhookTask": "Webhook task",
  "chat.viewPayload": "View event payload",
  "chat.showFull": "Show full message",
  "chat.showLess": "Show less",
  "chat.regenerate": "Regenerate response",
  "chat.queued": "Queued — sends when this turn finishes",
  "chat.previousVersion": "Previous version",
  "chat.nextVersion": "Next version",
  "chat.botScreen": "Bot's screen",
  "chat.botSettings": "Bot settings",
  "chat.botComputer": "Bot's computer",
  "chat.stopTurn": "Stop this turn",
  "chat.stop": "Stop",
  "chat.inspector": "Inspector",
  "chat.inspectorHint": "Inspector — runtime events and raw protocol for this thread",
  "chat.computerStarting": "Setting up this bot's computer…",
  "chat.jumpToLatest": "Jump to latest messages",
  "chat.discardQueued": "Discard queued message",
  "chat.tagBot": "Tag a bot",
  "app.yourName": "Your name",
  "app.updates": "Updates",
  "app.closeSettings": "Close settings",
  "app.profile": "Profile",
  "app.profileHint": "Shown in the sidebar. Saved as you go.",
  "app.connections": "Connections",
  "app.connectorsReady": "Connected apps service is ready",
  "app.selfHost": "Self-host connected apps",
  "app.engineClis": "Engine CLIs",
  "app.engineClisHint": "Which binary each engine runs. Saved as you go.",
  "section.general": "General",
  "section.connections": "Connections",
  "section.engines": "Engines",
  "section.companion": "Companion",
  "section.computer": "Local VM",
  "section.voice": "Voice",
  "section.usage": "Usage",
  "chief.make": "Make Chief of Staff",
  "chief.remove": "Remove Chief of Staff",
  "chief.chooseAnother": "Choose another Chief of Staff first",
  "engine.chooseFirst": "Choose a Claude or ACP engine first",
  "profile.edit": "Edit Profile",
  "chat.empty": "Send a message to start the conversation.",
  "chat.sendMessage": "Send message",
  "chat.sendsAfterTurn": "Sends when the current turn finishes",
  "dictation.stop": "Stop dictation",
  "dictation.stopEsc": "Stop dictation (Esc)",
} as const;
